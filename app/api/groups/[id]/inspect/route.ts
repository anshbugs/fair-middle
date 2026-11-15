import { NextResponse } from "next/server";
import { groupOptions, store } from "@/lib/db";
import { providers } from "@/lib/providers";
import { allow, clientKey } from "@/lib/rateLimit";
import { inspect } from "@/lib/solver/solve";

/**
 * "Why not here?" Scores one map point for a stored group. Coordinates come from the server-side
 * store, so a viewer of a shared plan can inspect without ever seeing anyone's start.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allow(`inspect:${clientKey(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const s = await store();
  const g = await s.liveGroup(id);
  const participants = g ? await s.privateParticipants(id) : [];
  if (!g || participants.length < 2) return NextResponse.json({ error: "This plan has expired, does not exist, or has fewer than two people." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { lat?: number; lon?: number };
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "Point needs lat and lon." }, { status: 400 });
  try {
    const r = await inspect(participants, { lat, lon }, groupOptions(g), { travel: providers().travel });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Routing failed." }, { status: 502 });
  }
}
