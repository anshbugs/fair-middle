import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { Card, CARD_SIZE } from "@/lib/card";
import { publicView } from "@/lib/group";

/** The shareable PNG for WhatsApp and friends. Same renderer as the OpenGraph preview. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await publicView(id, {});
  if (!g) return NextResponse.json({ error: "This plan has expired or does not exist." }, { status: 404 });
  return new ImageResponse(<Card g={g} />, { ...CARD_SIZE, headers: { "cache-control": "no-store" } });
}
