import { NextResponse } from "next/server";
import { publicView } from "@/lib/group";
import { viewerCookies } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await publicView(id, await viewerCookies(id));
  if (!g) return NextResponse.json({ error: "This plan has expired or does not exist." }, { status: 404 });
  return NextResponse.json(g, { headers: { "cache-control": "no-store" } });
}
