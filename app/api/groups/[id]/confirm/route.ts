import { NextResponse } from "next/server";
import { confirm, publicView } from "@/lib/group";
import { errorResponse, viewerCookies } from "@/lib/http";

/** Organiser only: lock the plan to one venue. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { key } = (await req.json()) as { key?: string };
    if (!key) return NextResponse.json({ error: "Pick a place." }, { status: 400 });
    const cookies = await viewerCookies(id);
    await confirm(id, key, cookies);
    return NextResponse.json(await publicView(id, cookies));
  } catch (e) {
    return errorResponse(e);
  }
}
