import { NextResponse } from "next/server";
import { createGroup, newId } from "@/lib/db";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";
import { solve, SolveError } from "@/lib/solver/solve";
import { MODES, OBJECTIVES, type Mode, type Objective, type Participant } from "@/lib/types";


type Body = { objective?: Objective; participants?: { name?: string; lat?: number; lon?: number; mode?: Mode; query?: string }[] };

function parse(body: Body): { objective: Objective; participants: Participant[] } {
  const objective = OBJECTIVES.includes(body.objective as Objective) ? (body.objective as Objective) : "minimax";
  const raw = Array.isArray(body.participants) ? body.participants : [];
  const participants: Participant[] = raw.map((p, i) => {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new SolveError(`Person ${i + 1} has no valid location.`);
    return {
      id: newId(6),
      name: String(p.name ?? `Person ${i + 1}`).slice(0, 40) || `Person ${i + 1}`,
      lat, lon,
      mode: MODES.includes(p.mode as Mode) ? (p.mode as Mode) : "drive",
      query: p.query ? String(p.query).slice(0, 200) : undefined,
    };
  });
  return { objective, participants };
}

export async function POST(req: Request) {
  if (!allow(`solve:${clientKey(req)}`, 12, 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  try {
    const { objective, participants } = parse((await req.json()) as Body);
    const { travel, venues } = providers();
    const result = await solve(participants, objective, { travel, venues });
    const groupId = createGroup(objective, participants, result);
    return NextResponse.json({ groupId, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    const status = e instanceof SolveError ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
