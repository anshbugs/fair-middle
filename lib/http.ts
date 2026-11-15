import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GroupError, type Cookies } from "./group";
import { SolveError } from "./solver/solve";
import { COOKIE_OPTS, organiserCookie, participantCookie } from "./tokens";

/** Read this browser's organiser / participant tokens for a group. */
export async function viewerCookies(groupId: string): Promise<Cookies> {
  const c = await cookies();
  return { organiser: c.get(organiserCookie(groupId))?.value, participant: c.get(participantCookie(groupId))?.value };
}

export function setOrganiser(res: NextResponse, groupId: string, token: string) {
  res.cookies.set(organiserCookie(groupId), token, COOKIE_OPTS);
}
export function setParticipant(res: NextResponse, groupId: string, participantId: string, token: string) {
  res.cookies.set(participantCookie(groupId), `${participantId}.${token}`, COOKIE_OPTS);
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof GroupError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof SolveError) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 502 });
}
