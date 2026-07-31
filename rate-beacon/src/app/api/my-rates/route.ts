import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { checkIn, price } = (await req.json()) as {
    checkIn?: string;
    price?: number | null;
  };
  if (!checkIn || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    return NextResponse.json({ error: "checkIn (YYYY-MM-DD) required" }, { status: 400 });
  }
  const supa = db();
  if (price == null) {
    const { error } = await supa.from("my_rates").delete().eq("check_in", checkIn);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supa.from("my_rates").upsert({
      check_in: checkIn,
      price,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
