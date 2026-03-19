import "server-only";

import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "tokens.json");
const TOKEN_URL = "https://identity.jobmanapp.com/oauth/token";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

function readTokens(): TokenStore {
  // Prefer env vars (set during initial setup or by Vercel later)
  const envAccess = process.env.JOBMAN_ACCESS_TOKEN;
  const envRefresh = process.env.JOBMAN_REFRESH_TOKEN;

  // If tokens.json exists, it has the most up-to-date tokens (post-refresh)
  if (fs.existsSync(TOKEN_FILE)) {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as TokenStore;
  }

  if (!envAccess || !envRefresh) {
    throw new Error("No OAuth tokens found. Run the OAuth setup flow first.");
  }

  // Bootstrap from env vars — assume token expires soon so we refresh on first use
  return {
    access_token: envAccess,
    refresh_token: envRefresh,
    expires_at: Date.now() - 1, // force refresh immediately
  };
}

function writeTokens(tokens: TokenStore): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
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

  writeTokens(tokens);
  return tokens;
}

export async function getAccessToken(): Promise<string> {
  const tokens = readTokens();

  if (Date.now() < tokens.expires_at) {
    return tokens.access_token;
  }

  console.log("[OAuth] Access token expired, refreshing...");
  const refreshed = await refreshTokens(tokens.refresh_token);
  return refreshed.access_token;
}
