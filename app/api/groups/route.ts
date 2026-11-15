import { NextResponse } from "next/server";
import { createGroup } from "@/lib/group";
import { errorResponse, setOrganiser } from "@/lib/http";
import { allow, clientKey } from "@/lib/rateLimit";
import { parseOptions, type SolveBody } from "@/lib/solver/request";

/** Create an empty plan. The caller becomes organiser; friends join through the link. */
export async function POST(req: Request) {
  if (!allow(`create:${clientKey(req)}`, 20, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const body = (await req.json().catch(() => ({}))) as SolveBody & { title?: string };
    const title = String(body.title ?? "").slice(0, 60).trim() || undefined;
    const { id, organiserToken } = await createGroup(parseOptions(body), title);
    const res = NextResponse.json({ groupId: id });
    setOrganiser(res, id, organiserToken);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
