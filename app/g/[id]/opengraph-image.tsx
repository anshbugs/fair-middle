import { ImageResponse } from "next/og";
import { Card, CARD_SIZE } from "@/lib/card";
import { publicView } from "@/lib/group";

export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "Fair Middle plan";

/** Link previews in WhatsApp, iMessage, Slack: the same card as /g/[id]/card.png. */
export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await publicView(id, {});
  if (!g) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#f8fafc", fontSize: 56 }}>Fair Middle</div>,
      size,
    );
  }
  return new ImageResponse(<Card g={g} />, size);
}
