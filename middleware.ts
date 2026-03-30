export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const PASSWORD = "InspireKitchens";
const COOKIE_NAME = "site_auth_token";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  
  // Allow access to the login page itself and static assets/Next.js internal paths
  if (
    url.pathname === "/login" ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/api/login") ||
    url.pathname.startsWith("/api/cron/") ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;

  if (token !== PASSWORD) {
    const loginUrl = new URL("/login", req.url);
    // Optional: add the original URL to return after login
    // loginUrl.searchParams.set("from", url.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Apply middleware to all routes except Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
