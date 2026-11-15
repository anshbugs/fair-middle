import { NextResponse } from "next/server";
import { createGroup } from "@/lib/db";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";
import { parseOptions, parseParticipants, type SolveBody } from "@/lib/solver/request";
import { solve, SolveError } from "@/lib/solver/solve";

export async function POST(req: Request) {
  if (!allow(`solve:${clientKey(req)}`, 12, 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  try {
    const body = (await req.json()) as SolveBody;
    const options = parseOptions(body);
    const participants = parseParticipants(body);
    const { travel, venues } = providers();
    const result = await solve(participants, options, { travel, venues });
    const groupId = createGroup(options, participants, result);
    return NextResponse.json({ groupId, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    const status = e instanceof SolveError ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
