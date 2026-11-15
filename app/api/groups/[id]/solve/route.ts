import { NextResponse } from "next/server";
import { publicView, scheduleRecompute } from "@/lib/group";
import { errorResponse, viewerCookies } from "@/lib/http";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";

/** Re-run the solve for a plan (for example after the organiser changed rules). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allow(`resolve:${clientKey(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  try {
    const cookies = await viewerCookies(id);
    const view = publicView(id, cookies);
    if (!view) return NextResponse.json({ error: "This plan has expired or does not exist." }, { status: 404 });
    const { travel, venues } = providers();
    const started = scheduleRecompute(id, { travel, venues });
    return NextResponse.json({ ...publicView(id, cookies), started });
  } catch (e) {
    return errorResponse(e);
  }
}
