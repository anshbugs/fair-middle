import { NextResponse } from "next/server";
import { getPublicGroup } from "@/lib/db";


export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = getPublicGroup(id);
  if (!g) return NextResponse.json({ error: "This plan has expired or does not exist." }, { status: 404 });
  return NextResponse.json(g);
}
