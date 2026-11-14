import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Planner from "@/components/Planner";
import { getPublicGroup } from "@/lib/db";


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = getPublicGroup(id);
  const top = g?.result?.venues[0];
  return {
    title: top ? `${top.name} · Fair Middle` : "Fair Middle",
    description: g?.result
      ? `Longest commute ${Math.round(g.result.fairScore.worst / 60)} min for ${g.participants.map((p) => p.name).join(", ")}.`
      : "Meet where the time is fair, not the distance.",
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = getPublicGroup(id);
  if (!g) notFound();
  return <Planner shared={g} />;
}
