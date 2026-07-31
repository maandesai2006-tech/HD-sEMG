import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isAuthorized } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The cron route authenticates itself with CRON_SECRET; login must stay open.
  if (pathname.startsWith("/api/cron") || pathname === "/login" || pathname === "/api/auth") {
    return NextResponse.next();
  }
  if (await isAuthorized(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
