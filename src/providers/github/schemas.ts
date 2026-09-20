import { z } from 'zod';

// GitHub device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export const deviceCodeResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

const tokenSuccess = z.object({
  access_token: z.string(),
  token_type: z.string(),
  // Comma-separated. May be empty.
  scope: z.string().default(''),
});

const tokenFailure = z.object({
  error: z.string(),
  interval: z.number().optional(),
});

export const tokenResponse = z.union([tokenSuccess, tokenFailure]);

export const userResponse = z.object({
  login: z.string(),
  id: z.number(),
  avatar_url: z.string().optional(),
});

// Shapes below were checked against recorded public responses in tests/fixtures.

export const repoResponse = z.object({
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean(),
  default_branch: z.string(),
  // Size in KB.
  size: z.number().optional(),
  // VERIFY: present on authenticated responses, absent on the unauthenticated fixture.
  permissions: z.object({ admin: z.boolean(), push: z.boolean(), pull: z.boolean() }).optional(),
});

export const refListItem = z.object({
  name: z.string(),
  commit: z.object({ sha: z.string() }),
});

export const commitResponse = z.object({
  sha: z.string(),
  commit: z.object({ message: z.string(), tree: z.object({ sha: z.string() }) }),
  parents: z.array(z.object({ sha: z.string() })),
});

export const refResponse = z.object({ object: z.object({ sha: z.string() }) });

export const treeResponse = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.enum(['blob', 'tree', 'commit']),
      sha: z.string(),
      size: z.number().optional(),
    }),
  ),
});

export const blobResponse = z.object({ content: z.string(), encoding: z.string(), size: z.number() });

// Write responses. VERIFY each against a real call; they follow GitHub's documented Git Database API.
export const shaResponse = z.object({ sha: z.string() });
export const refWriteResponse = z.object({ ref: z.string(), object: z.object({ sha: z.string() }) });
export const contentsPutResponse = z.object({
  commit: z.object({ sha: z.string(), tree: z.object({ sha: z.string() }) }),
});
