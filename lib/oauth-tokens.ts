import "server-only";

import { Redis } from "@upstash/redis";

const TOKEN_URL = "https://identity.jobmanapp.com/oauth/token";
const REDIS_KEY = "jobman:tokens";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

async function readTokens(): Promise<TokenStore> {
  // Try Redis first (most up-to-date after refreshes)
  const redis = getRedis();
  const stored = await redis.get<TokenStore>(REDIS_KEY);

  if (stored) {
    return stored;
  }

  // Fall back to env vars (initial bootstrap)
  const envAccess = process.env.JOBMAN_ACCESS_TOKEN;
  const envRefresh = process.env.JOBMAN_REFRESH_TOKEN;

  if (!envAccess || !envRefresh) {
    throw new Error("No OAuth tokens found. Run the OAuth setup flow first.");
  }

  // Bootstrap from env vars — force refresh on first use
  return {
    access_token: envAccess,
    refresh_token: envRefresh,
    expires_at: Date.now() - 1,
  };
}

async function writeTokens(tokens: TokenStore): Promise<void> {
  const redis = getRedis();
  await redis.set(REDIS_KEY, tokens);
}

async function refreshTokens(refreshToken: string): Promise<TokenStore> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.JOBMAN_CLIENT_ID,
      client_secret: process.env.JOBMAN_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed: ${response.status} — ${body}`);
  }

  const data = await response.json();

  const tokens: TokenStore = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000, // 1 min buffer
  };

  await writeTokens(tokens);
  return tokens;
}

export async function getAccessToken(): Promise<string> {
  const tokens = await readTokens();

  if (Date.now() < tokens.expires_at) {
    return tokens.access_token;
  }

  console.log("[OAuth] Access token expired, refreshing...");
  const refreshed = await refreshTokens(tokens.refresh_token);
  return refreshed.access_token;
}
