import { describe, expect, it } from 'vitest';
import type { SyncPlan } from '@/src/plan';
import { runSync } from '@/src/runner';
import type { WritableProvider } from '@/src/providers/types';

describe('runSync', () => {
  it('dispatches git-clone plans to the git-clone engine', async () => {
    // mode !== 'full' makes gitClone.execute reject the plan before it touches the provider or the
    // offscreen document, so this exercises the dispatch itself without mocking chrome APIs.
    const res = await runSync(
      {} as WritableProvider,
      { engine: 'git-clone', mode: 'lastN', blockers: [] } as unknown as SyncPlan,
      {} as never,
      () => {},
      new AbortController().signal,
    );
    expect(res).toEqual({ ok: false, error: { code: 'not_supported', engine: 'git-clone' } });
  });
});
