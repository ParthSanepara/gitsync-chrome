import { describe, expect, it } from 'vitest';
import { branchNameProblem } from '@/src/gitRefs';

describe('branchNameProblem', () => {
  it.each(['main', 'feature/login', 'release-1.2', 'fix_bug', 'a/b/c', 'v1.0.0', 'ünïcode'])('accepts %s', (n) => {
    expect(branchNameProblem(n)).toBeUndefined();
  });

  it.each([
    '',
    'has space',
    'a..b',
    'a@{b',
    '/lead',
    'trail/',
    'dou//ble',
    '.hidden',
    'a/.hidden',
    'x.lock',
    'a/x.lock/b',
    'end.',
    'we~ird',
    'q?',
    'st*r',
    'br[ack',
    'back\\slash',
    '@',
    '-dash',
  ])('rejects %j', (n) => {
    expect(branchNameProblem(n)).toBeDefined();
  });
});
