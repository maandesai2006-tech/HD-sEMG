import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, passwordDigest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!authEnabled()) {
    return NextResponse.json({ ok: true });
  }
  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await passwordDigest(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
