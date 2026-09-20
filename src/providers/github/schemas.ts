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
