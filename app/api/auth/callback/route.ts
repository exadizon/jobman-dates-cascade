import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL = "https://identity.jobmanapp.com/oauth/token";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:3000/api/auth/callback",
      client_id: process.env.JOBMAN_CLIENT_ID,
      client_secret: process.env.JOBMAN_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return new NextResponse(`Token exchange failed: ${body}`, { status: 500 });
  }

  const tokens = await response.json();

  // Display tokens so you can copy them into .env.local
  return new NextResponse(
    `<html><body style="font-family:monospace;padding:2rem;background:#111;color:#0f0">
      <h2 style="color:#fff">OAuth tokens received — copy these into .env.local</h2>
      <p><strong style="color:#fff">JOBMAN_ACCESS_TOKEN=</strong>${tokens.access_token}</p>
      <p><strong style="color:#fff">JOBMAN_REFRESH_TOKEN=</strong>${tokens.refresh_token}</p>
      <p><strong style="color:#fff">Expires in:</strong> ${tokens.expires_in} seconds</p>
      <p style="color:#888;margin-top:2rem">You can now delete the /api/auth/callback route.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
