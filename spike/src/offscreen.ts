import './buffer-shim';
import git, { type GitAuth } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { Buffer } from 'buffer';

type Params = {
  srcUrl: string;
  srcRef: string;
  tgtRepo: string;
  tgtBranch: string;
  force: boolean;
  blobSizes: string;
  upstream: string;
  upstreamBranch: string;
  fork: string;
  control: string;
  authForm: 'username' | 'x-access-token';
};

type RunMessage = { to: 'offscreen'; type: 'run'; exp: string; params: Params; token: string };

// ---------- reporting (never includes the token) ----------

let currentToken = '';

function redact(text: string): string {
  return currentToken ? text.split(currentToken).join('«redacted»') : text;
}

function send(msg: Record<string, unknown>) {
  const safe = JSON.parse(redact(JSON.stringify(msg)));
  chrome.runtime.sendMessage({ to: 'ui', ...safe }).catch(() => {
    // No UI open. Results are still in this document's console.
  });
}

function log(text: string) {
  console.log('[offscreen]', redact(text));
  send({ type: 'log', text });
}

let lastProgress = 0;
function progress(text: string) {
  if (Date.now() - lastProgress < 250) return;
  lastProgress = Date.now();
  send({ type: 'progress', text });
}

function describeError(e: unknown) {
  if (e && typeof e === 'object') {
    const err = e as { name?: string; code?: string; message?: string; data?: unknown };
    return { name: err.name, code: err.code, message: err.message, data: err.data };
  }
  return { message: String(e) };
}

// ---------- metrics ----------

type Metrics = { stop(): Promise<Record<string, unknown>> };

function startMetrics(): Metrics {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const t0 = performance.now();
  let peakHeap = perf.memory?.usedJSHeapSize ?? 0;
  const timer = setInterval(() => {
    peakHeap = Math.max(peakHeap, perf.memory?.usedJSHeapSize ?? 0);
  }, 250);
  return {
    async stop() {
      clearInterval(timer);
      const est = await navigator.storage.estimate();
      return {
        wallSeconds: +((performance.now() - t0) / 1000).toFixed(1),
        peakJsHeapMB: perf.memory ? +(peakHeap / 1e6).toFixed(1) : 'unavailable',
        storageUsageMB: est.usage != null ? +(est.usage / 1e6).toFixed(1) : 'unavailable',
        storageQuotaMB: est.quota != null ? +(est.quota / 1e6).toFixed(0) : 'unavailable',
      };
    },
  };
}

// ---------- helpers ----------

function onAuthFor(token: string, form: Params['authForm']) {
  return (): GitAuth =>
    form === 'x-access-token' ? { username: 'x-access-token', password: token } : { username: token };
}

// VERIFY: header set for REST calls; confirm in M0 that no extra headers are needed.
function restHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function rest(token: string, method: string, path: string, body?: unknown) {
  const t0 = performance.now();
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { ...restHeaders(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return {
    status: res.status,
    ms: Math.round(performance.now() - t0),
    rateRemaining: res.headers.get('x-ratelimit-remaining'),
    json,
    snippet: text.slice(0, 500),
  };
}

function freshFs() {
  // wipe: true clears the IndexedDB-backed store so runs don't contaminate each other.
  return new LightningFS('gitsync-spike', { wipe: true });
}

// ---------- experiments ----------

async function expClone(p: Params, token: string, withPush: boolean) {
  const fs = freshFs();
  const dir = '/repo';
  const onAuth = onAuthFor(token, p.authForm);
  const metrics = startMetrics();
  const result: Record<string, unknown> = { srcUrl: p.srcUrl, withPush };

  try {
    log(`clone ${p.srcUrl} ref=${p.srcRef || '(default)'} (no corsProxy, full depth)`);
    const tClone = performance.now();
    await git.clone({
      fs,
      http,
      dir,
      url: p.srcUrl,
      ref: p.srcRef || undefined,
      singleBranch: true,
      noCheckout: true, // pushing does not need a working tree
      onAuth: token ? onAuth : undefined,
      onProgress: (e) => progress(`clone ${e.phase} ${e.loaded}${e.total ? `/${e.total}` : ''}`),
      onMessage: (m) => progress(`remote: ${m.trim()}`),
    });
    result.cloneSeconds = +((performance.now() - tClone) / 1000).toFixed(1);
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const branch = await git.currentBranch({ fs, dir });
    result.head = head;
    result.branch = branch;
    log(`clone ok: ${branch}@${head} in ${result.cloneSeconds}s`);

    if (withPush) {
      if (!p.tgtRepo) throw new Error('target repo not set');
      const url = `https://github.com/${p.tgtRepo}.git`;
      await git.addRemote({ fs, dir, remote: 'target', url });
      log(`push ${branch} → ${p.tgtRepo}:${p.tgtBranch} force=${p.force}`);
      const tPush = performance.now();
      const pushRes = await git.push({
        fs,
        http,
        dir,
        remote: 'target',
        ref: branch ?? head,
        remoteRef: `refs/heads/${p.tgtBranch}`,
        force: p.force,
        onAuth,
        onAuthFailure: () => {
          log('push auth failure: try the other onAuth form');
          return { cancel: true };
        },
        onProgress: (e) => progress(`push ${e.phase} ${e.loaded}${e.total ? `/${e.total}` : ''}`),
        onMessage: (m) => progress(`remote: ${m.trim()}`),
      });
      result.pushSeconds = +((performance.now() - tPush) / 1000).toFixed(1);
      result.push = { ok: pushRes.ok, error: pushRes.error, refs: pushRes.refs };
      log(`push ok=${pushRes.ok} in ${result.pushSeconds}s`);
    }
    result.pass = true;
  } catch (e) {
    result.pass = false;
    result.error = describeError(e);
  }
  result.metrics = await metrics.stop();
  return result;
}

function randomBase64(bytes: number): string {
  const buf = new Uint8Array(bytes);
  const CHUNK = 65536; // getRandomValues limit per call
  for (let i = 0; i < bytes; i += CHUNK) crypto.getRandomValues(buf.subarray(i, Math.min(i + CHUNK, bytes)));
  return Buffer.from(buf).toString('base64');
}

async function expBlobCeiling(p: Params, token: string) {
  const sizes = p.blobSizes
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  const rows: Record<string, unknown>[] = [];
  for (const mb of sizes) {
    log(`POST git/blobs ${mb} MB (random, incompressible)`);
    progress(`blob ${mb} MB: generating`);
    try {
      const content = randomBase64(Math.round(mb * 1024 * 1024));
      progress(`blob ${mb} MB: uploading ${(content.length / 1e6).toFixed(1)} MB base64`);
      // Serialized on purpose: one write at a time.
      const r = await rest(token, 'POST', `/repos/${p.tgtRepo}/git/blobs`, { content, encoding: 'base64' });
      rows.push({ mb, status: r.status, ms: r.ms, rateRemaining: r.rateRemaining, body: r.status < 300 ? r.json : r.snippet });
      log(`  → ${r.status} in ${r.ms}ms`);
    } catch (e) {
      rows.push({ mb, thrown: describeError(e) });
      log(`  → threw ${String(e)}`);
    }
  }
  return { tgtRepo: p.tgtRepo, rows };
}

async function expRefCopy(p: Params, token: string) {
  const out: Record<string, unknown> = {};
  const forkMeta = await rest(token, 'GET', `/repos/${p.fork}`);
  const fm = forkMeta.json as { fork?: boolean; parent?: { full_name: string }; source?: { full_name: string } } | undefined;
  out.forkMeta = { status: forkMeta.status, fork: fm?.fork, parent: fm?.parent?.full_name, source: fm?.source?.full_name };

  const upRef = await rest(token, 'GET', `/repos/${p.upstream}/git/ref/heads/${p.upstreamBranch}`);
  const sha = (upRef.json as { object?: { sha: string } } | undefined)?.object?.sha;
  out.upstreamRef = { status: upRef.status, sha };
  if (!sha) return { ...out, pass: false, note: 'could not resolve upstream ref' };

  const forkHasRef = await rest(token, 'GET', `/repos/${p.fork}/git/ref/heads/${p.upstreamBranch}`);
  out.forkBranchSha = (forkHasRef.json as { object?: { sha: string } } | undefined)?.object?.sha ?? null;
  out.upstreamShaDiffersFromFork = out.forkBranchSha !== sha;

  const probe = await rest(token, 'GET', `/repos/${p.fork}/git/commits/${sha}`);
  out.probeFork = { status: probe.status, ms: probe.ms };

  const controlRepo = p.control || p.tgtRepo;
  if (controlRepo) {
    const ctl = await rest(token, 'GET', `/repos/${controlRepo}/git/commits/${sha}`);
    out.probeControl = { repo: controlRepo, status: ctl.status };
  }

  if (probe.status !== 200) return { ...out, pass: false, note: 'fork probe did not return 200' };

  const branch = `gitsync-spike-${Date.now()}`;
  const create = await rest(token, 'POST', `/repos/${p.fork}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  out.createRef = { branch, status: create.status, body: create.status < 300 ? create.json : create.snippet };

  const verify = await rest(token, 'GET', `/repos/${p.fork}/git/ref/heads/${branch}`);
  const verifiedSha = (verify.json as { object?: { sha: string } } | undefined)?.object?.sha;
  out.verify = { status: verify.status, sha: verifiedSha };
  return { ...out, pass: verifiedSha === sha };
}

// ---------- dispatch ----------

let busy = false;

chrome.runtime.onMessage.addListener((msg: RunMessage) => {
  if (msg?.to !== 'offscreen' || msg.type !== 'run') return;
  if (busy) {
    log(`busy; ignoring ${msg.exp}`);
    return;
  }
  busy = true;
  currentToken = msg.token;
  const { exp, params, token } = msg;
  (async () => {
    let result: unknown;
    try {
      if (!token && exp !== 'clone') throw new Error('no PAT set');
      if (exp === 'clone') result = await expClone(params, token, false);
      else if (exp === 'clonePush') result = await expClone(params, token, true);
      else if (exp === 'blobCeiling') result = await expBlobCeiling(params, token);
      else if (exp === 'refCopy') result = await expRefCopy(params, token);
      else throw new Error(`unknown experiment ${exp}`);
    } catch (e) {
      result = { pass: false, error: describeError(e) };
    } finally {
      busy = false;
    }
    console.log('[offscreen] result', exp, JSON.parse(redact(JSON.stringify(result))));
    send({ type: 'result', exp, result });
  })();
});

log('offscreen document ready');
