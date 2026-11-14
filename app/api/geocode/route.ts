import { NextResponse } from "next/server";
import { providers } from "@/lib/providers";
import { geocode } from "@/lib/providers/geocode";
import { allow, clientKey } from "@/lib/rateLimit";


export async function GET(req: Request) {
  if (!allow(`geo:${clientKey(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ error: "Type a place name." }, { status: 400 });
  try {
    const hit = await geocode(q, providers().cache);
    if (!hit) return NextResponse.json({ error: `Could not find “${q}”. Add the city, or pin it on the map.` }, { status: 404 });
    return NextResponse.json(hit);
  } catch {
    return NextResponse.json({ error: "Geocoder unavailable. Pin the location on the map instead." }, { status: 502 });
  }
}
