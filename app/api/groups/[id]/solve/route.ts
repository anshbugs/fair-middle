import { after, NextResponse } from "next/server";
import { publicView, recompute } from "@/lib/group";
import { errorResponse, viewerCookies } from "@/lib/http";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";

export const maxDuration = 60;

/** Re-run the solve for a plan (for example after the organiser changed rules). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allow(`resolve:${clientKey(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  try {
    const cookies = await viewerCookies(id);
    const view = await publicView(id, cookies);
    if (!view) return NextResponse.json({ error: "This plan has expired or does not exist." }, { status: 404 });
    const { travel, venues } = providers();
    after(recompute(id, { travel, venues }));
    return NextResponse.json({ ...view, computing: view.participants.length >= 2 });
  } catch (e) {
    return errorResponse(e);
  }
}
