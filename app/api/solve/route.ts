import { NextResponse } from "next/server";
import { createSolvedGroup } from "@/lib/group";
import { errorResponse, setOrganiser } from "@/lib/http";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";
import { parseOptions, parseParticipants, type SolveBody } from "@/lib/solver/request";

/** Quick mode: one person enters everyone; the solve runs inline and the caller becomes organiser. */
export async function POST(req: Request) {
  if (!allow(`solve:${clientKey(req)}`, 12, 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  try {
    const body = (await req.json()) as SolveBody;
    const { travel, venues } = providers();
    const { id, organiserToken, result } = await createSolvedGroup(parseOptions(body), parseParticipants(body), { travel, venues });
    const res = NextResponse.json({ groupId: id, result });
    setOrganiser(res, id, organiserToken);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
