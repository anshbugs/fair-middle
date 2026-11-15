import type { PublicGroup, RankedVenue } from "./types";
import { venueKey } from "./types";

export const CARD_SIZE = { width: 1200, height: 630 };
const COLORS = ["#2563eb", "#db2777", "#d97706", "#7c3aed", "#059669", "#dc2626", "#0891b2", "#65a30d"];
const min = (s: number) => `${Math.round(s / 60)} min`;

/** The venue a card should talk about: the confirmed one, else the recommendation. */
export function cardVenue(g: PublicGroup): RankedVenue | undefined {
  const vs = g.result?.venues ?? [];
  return (g.confirmedVenueKey && vs.find((v) => venueKey(v) === g.confirmedVenueKey)) || vs[0];
}

/**
 * The WhatsApp / OpenGraph card. Satori rules: every box with several children is display:flex,
 * no CSS shorthand surprises, system fonts only.
 */
export function Card({ g }: { g: PublicGroup }) {
  const v = cardVenue(g);
  const score = v?.score ?? g.result?.fairScore;
  const cs = g.result?.centroidScore;
  const confirmed = g.status === "confirmed";
  const title = g.title || (confirmed ? "We're meeting at" : "Fairest spot for everyone");
  // The roster the result was computed for; the live roster may already be longer.
  const people = g.result?.participants ?? g.participants;
  const maxMin = Math.max(...(score?.col ?? [60]), ...(cs?.col ?? [60])) / 60;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0f172a", color: "#f8fafc", padding: 56, fontFamily: "system-ui, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, background: "#2dd4bf" }} />
          <div style={{ fontSize: 28, color: "#94a3b8" }}>Fair Middle · fair by time, not distance</div>
        </div>
        <div style={{ fontSize: 26, color: confirmed ? "#2dd4bf" : "#94a3b8" }}>{confirmed ? "Confirmed" : "Proposed"}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
        <div style={{ fontSize: 30, color: "#94a3b8" }}>{title}</div>
        <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, marginTop: 6 }}>{v ? v.name : "Fair spot"}</div>
        <div style={{ fontSize: 28, color: "#cbd5e1", marginTop: 8 }}>
          {[v?.kind, v?.metro && v.metro.distM <= 1200 ? `${Math.max(1, Math.round(v.metro.distM / 80))} min walk from ${v.metro.name} metro` : ""].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 32, gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12, justifyContent: "center" }}>
          {people.map((p, i) => {
            const t = score?.col[i];
            const w = t != null && maxMin > 0 ? Math.max(4, (t / 60 / maxMin) * 100) : 4;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 26 }}>
                <div style={{ width: 150, display: "flex", overflow: "hidden" }}>{p.name}</div>
                <div style={{ display: "flex", flex: 1, height: 24, background: "#1e293b", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ width: `${w}%`, height: "100%", background: COLORS[i % COLORS.length], display: "flex" }} />
                </div>
                <div style={{ width: 100, display: "flex", justifyContent: "flex-end" }}>{t != null ? min(t) : "—"}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 330, background: "#1e293b", borderRadius: 20, padding: 24, justifyContent: "center" }}>
          <div style={{ fontSize: 22, color: "#94a3b8" }}>Longest commute</div>
          <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.05 }}>{score ? min(score.worst) : "—"}</div>
          {cs && score && cs.worst - score.worst >= 60 && <div style={{ fontSize: 22, color: "#2dd4bf", marginTop: 6 }}>{`vs ${min(cs.worst)} at the map middle`}</div>}
          <div style={{ fontSize: 22, color: "#94a3b8", marginTop: 14 }}>{`Spread ${score ? min(score.spread) : "—"}`}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#64748b", marginTop: 20 }}>
        <div>{`${people.length} people · door-to-door travel times`}</div>
        <div>Nobody&apos;s home location is shared</div>
      </div>
    </div>
  );
}
