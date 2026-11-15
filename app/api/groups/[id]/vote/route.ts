import { NextResponse } from "next/server";
import { publicView, vote } from "@/lib/group";
import { errorResponse, viewerCookies } from "@/lib/http";
import { allow, clientKey } from "@/lib/rateLimit";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allow(`vote:${clientKey(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  try {
    const { key } = (await req.json()) as { key?: string };
    if (!key) return NextResponse.json({ error: "Pick a place." }, { status: 400 });
    const cookies = await viewerCookies(id);
    await vote(id, key, cookies);
    return NextResponse.json(await publicView(id, cookies));
  } catch (e) {
    return errorResponse(e);
  }
}
