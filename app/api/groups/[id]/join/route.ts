import { after, NextResponse } from "next/server";
import { join, publicView } from "@/lib/group";
import { errorResponse, setParticipant, viewerCookies } from "@/lib/http";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";
import { parseParticipants } from "@/lib/solver/request";

/** Join (or update yourself in) a plan with your own start. Triggers a background re-solve. */
export const maxDuration = 60;
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allow(`join:${clientKey(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as { name?: string; lat?: number; lon?: number; mode?: string; query?: string };
    const [person] = parseParticipants({ participants: [body as never] });
    const cookies = await viewerCookies(id);
    const { travel, venues } = providers();
    const { participantId, token, recompute } = await join(id, person, cookies, { travel, venues });
    after(recompute); // keep the background re-solve alive after the response is sent
    const view = await publicView(id, { ...cookies, participant: `${participantId}.${token}` });
    const res = NextResponse.json(view);
    setParticipant(res, id, participantId, token);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
