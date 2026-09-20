import { describe, expect, it } from 'vitest';
import type { SyncPlan } from '@/src/plan';
import { runSync } from '@/src/runner';
import type { WritableProvider } from '@/src/providers/types';

describe('runSync', () => {
  it.each(['git-clone'] as const)('says %s is not available yet instead of running it', async (engine) => {
    const res = await runSync(
      {} as WritableProvider,
      { engine, blockers: [] } as unknown as SyncPlan,
      {} as never,
      () => {},
      new AbortController().signal,
    );
    expect(res).toEqual({ ok: false, error: { code: 'not_supported', engine } });
  });
});
