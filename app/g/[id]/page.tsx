import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GroupPage from "@/components/GroupPage";
import { cardVenue } from "@/lib/card";
import { publicView } from "@/lib/group";
import { viewerCookies } from "@/lib/http";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = publicView(id, {});
  const v = g ? cardVenue(g) : undefined;
  const names = g?.participants.map((p) => p.name).join(", ");
  return {
    title: v ? `${g!.status === "confirmed" ? "Meeting at" : "Fair spot:"} ${v.name} · Fair Middle` : g?.title ? `${g.title} · Fair Middle` : "Fair Middle",
    description: v && g?.result
      ? `Longest commute ${Math.round(v.score.worst / 60)} min for ${names}. Fair by travel time, not distance.`
      : "Drop your start location and we'll find the spot that's fair by travel time for everyone.",
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = publicView(id, await viewerCookies(id));
  if (!g) notFound();
  return <GroupPage initial={g} />;
}
