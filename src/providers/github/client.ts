import type { z } from 'zod';
import { err, ok, type ApiError, type Result } from '@/src/errors';
import type { Credential, RateLimit } from '@/src/providers/types';

const API = 'https://api.github.com';
const MAX_CONCURRENT_READS = 4; // SPEC §8.2
const WRITE_DELAY_MS = 500; // VERIFY: gap between writes that stays under the secondary rate limit
const ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export interface ClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultClientDeps: ClientDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

interface Raw {
  data: unknown;
  headers: Headers;
}

type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * The only place that talks to api.github.com. It takes the credential explicitly on every call,
 * never logs a request, and never puts a token in an error.
 */
export class GitHubClient {
  /** Last rate-limit headers seen. The planner reads this to budget API calls. */
  rateLimit: RateLimit | undefined;

  private activeReads = 0;
  private readWaiters: Array<() => void> = [];
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ClientDeps = defaultClientDeps) {}

  async get<S extends z.ZodType>(
    cred: Credential,
    path: string,
    schema: S,
    signal?: AbortSignal,
  ): Promise<Result<z.infer<S>, ApiError>> {
    const raw = await this.read(cred, `${API}${path}`, signal);
    return raw.ok ? parse(schema, raw.value.data) : raw;
  }

  /** Follows `Link: rel="next"` until `maxPages`. Only ever sends the token to api.github.com. */
  async getAll<S extends z.ZodType>(
    cred: Credential,
    path: string,
    itemSchema: S,
    maxPages = 5,
    signal?: AbortSignal,
  ): Promise<Result<Array<z.infer<S>>, ApiError>> {
    const items: Array<z.infer<S>> = [];
    let url: string | undefined = `${API}${path}`;
    for (let page = 0; url && page < maxPages; page++) {
      const raw = await this.read(cred, url, signal);
      if (!raw.ok) return raw;
      if (!Array.isArray(raw.value.data)) return err({ code: 'unexpected_response', detail: 'expected a list' });
      for (const item of raw.value.data) {
        const parsed = parse(itemSchema, item);
        if (!parsed.ok) return parsed;
        items.push(parsed.value);
      }
      url = nextLink(raw.value.headers);
    }
    return ok(items);
  }

  /** Writes run one at a time with a gap between them (SPEC §14 rule 5). */
  write<S extends z.ZodType>(
    cred: Credential,
    method: WriteMethod,
    path: string,
    body: unknown,
    schema: S,
    signal?: AbortSignal,
  ): Promise<Result<z.infer<S>, ApiError>> {
    const run = async (): Promise<Result<z.infer<S>, ApiError>> => {
      const raw = await this.send(cred, method, `${API}${path}`, body, signal);
      await this.deps.sleep(WRITE_DELAY_MS);
      return raw.ok ? parse(schema, raw.value.data) : raw;
    };
    const result = this.writeChain.then(run, run);
    this.writeChain = result;
    return result;
  }

  private async read(cred: Credential, url: string, signal?: AbortSignal): Promise<Result<Raw, ApiError>> {
    if (!url.startsWith(`${API}/`))
      return err({ code: 'unexpected_response', detail: 'refusing to follow a non-GitHub URL' });
    await this.acquireRead();
    try {
      return await this.send(cred, 'GET', url, undefined, signal);
    } finally {
      this.releaseRead();
    }
  }

  private acquireRead(): Promise<void> {
    if (this.activeReads < MAX_CONCURRENT_READS) {
      this.activeReads++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.readWaiters.push(resolve));
  }

  private releaseRead(): void {
    const next = this.readWaiters.shift();
    if (next) next();
    else this.activeReads--;
  }

  private async send(
    cred: Credential,
    method: 'GET' | WriteMethod,
    url: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Result<Raw, ApiError>> {
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= ATTEMPTS;
      let res: Response;
      try {
        res = await this.deps.fetch(url, {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${cred.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        if (signal?.aborted) return err({ code: 'cancelled' });
        // Only reads are retried: a write may have reached GitHub before the connection failed.
        if (method === 'GET' && !last) {
          await this.deps.sleep(backoffMs(attempt));
          continue;
        }
        return err({ code: 'network', message: e instanceof Error ? e.message : 'request failed' });
      }

      this.trackRateLimit(res.headers);
      if (res.ok) return readBody(res);

      const failure = await this.classify(res);
      if (failure.code === 'rate_limited') {
        const wait = failure.resetAt - this.deps.now();
        // A rate-limited request was not processed, so any method is safe to retry after a short wait.
        if (!last && wait > 0 && wait <= MAX_RETRY_AFTER_MS) {
          await this.deps.sleep(wait);
          continue;
        }
      } else if (failure.code === 'http' && failure.status >= 500 && method === 'GET' && !last) {
        await this.deps.sleep(backoffMs(attempt));
        continue;
      }
      return err(failure);
    }
  }

  private trackRateLimit(headers: Headers): void {
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (headers.get('x-ratelimit-remaining') !== null && Number.isFinite(remaining) && Number.isFinite(reset)) {
      this.rateLimit = { remaining, resetAt: reset * 1000 };
    }
  }

  private async classify(res: Response): Promise<ApiError> {
    const message = await errorMessage(res);
    switch (res.status) {
      case 401:
        return { code: 'unauthorized' };
      case 404:
        return { code: 'not_found' };
      case 409:
        return { code: 'conflict', message };
      case 422:
        return { code: 'validation', message };
      case 403:
      case 429: {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && res.headers.get('retry-after') !== null) {
          return { code: 'rate_limited', resetAt: this.deps.now() + retryAfter * 1000 };
        }
        if (res.headers.get('x-ratelimit-remaining') === '0') {
          return { code: 'rate_limited', resetAt: Number(res.headers.get('x-ratelimit-reset')) * 1000 };
        }
        return res.status === 429
          ? { code: 'rate_limited', resetAt: this.deps.now() + 60_000 }
          : { code: 'forbidden', message };
      }
      default:
        return { code: 'http', status: res.status, message };
    }
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown): Result<z.infer<S>, ApiError> {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: 'unexpected_response', detail: 'response did not match the expected shape' });
}

async function readBody(res: Response): Promise<Result<Raw, ApiError>> {
  if (res.status === 204) return ok({ data: undefined, headers: res.headers });
  try {
    return ok({ data: await res.json(), headers: res.headers });
  } catch {
    return err({ code: 'unexpected_response', detail: 'response was not JSON' });
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : res.statusText;
  } catch {
    return res.statusText;
  }
}

function nextLink(headers: Headers): string | undefined {
  return headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

const backoffMs = (attempt: number) => 500 * 2 ** (attempt - 1);
