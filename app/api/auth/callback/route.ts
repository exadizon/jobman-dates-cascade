import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const TOKEN_URL = "https://identity.jobmanapp.com/oauth/token";
const REDIS_KEY = "jobman:tokens";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  const redirectUri = `${origin}/api/auth/callback`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.JOBMAN_CLIENT_ID,
      client_secret: process.env.JOBMAN_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return new NextResponse(`Token exchange failed: ${body}`, { status: 500 });
  }

  const data = await response.json();

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };

  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });

  await redis.set(REDIS_KEY, tokens);

  return new NextResponse(
    `<html><body style="font-family:monospace;padding:2rem;background:#111;color:#0f0">
      <h2 style="color:#fff">OAuth tokens saved to Redis</h2>
      <p>The app is now authorized. You can close this tab.</p>
      <p><a href="/" style="color:#0f0">Go to app</a></p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
