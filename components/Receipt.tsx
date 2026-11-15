"use client";

import type { InspectResult, LatLng, MetroInfo, SolveResult } from "@/lib/types";
import { COLORS } from "./MapView";

export const fmt = (s?: number | null) => (s == null ? "—" : `${Math.round(s / 60)} min`);
export const walk = (m?: MetroInfo) => (m ? `${Math.max(1, Math.round(m.distM / 80))} min walk from ${m.name} metro` : "");

const RELAX_LABEL: Record<string, string> = {
  maxMinutes: "the travel-time cap",
  nearMetroM: "the near-a-metro rule",
  kinds: "the venue type filter",
};

export default function Receipt({ result, inspect, onFocus }: { result: SolveResult; inspect: InspectResult | null; onFocus: (p: LatLng) => void }) {
  const { participants: pts, venues, centroidScore: cs, fairPoint, objective } = result;
  const top = venues[0];
  const target = top ? top.score : result.fairScore;
  const worstIdx = cs ? cs.col.indexOf(cs.worst) : -1;
  const saved = cs ? cs.worst - target.worst : 0;
  const whoWorst = worstIdx >= 0 ? pts[worstIdx].name : "";
  const metro = top?.metro ?? fairPoint.metro;
  const nearMetro = metro && metro.distM <= 1200;

  return (
    <>
      {result.relaxed.length > 0 && (
        <div className="card notice">
          Nothing satisfied every rule, so {result.relaxed.map((r) => RELAX_LABEL[r] ?? r).join(" and ")} {result.relaxed.length > 1 ? "were" : "was"} dropped.
        </div>
      )}

      <div className="card">
        <div className="sub">Recommended{result.departAt ? ` · leaving ${new Date(result.departAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</div>
        <h3>{top ? top.name : "Fair spot"}</h3>
        <div className="sub">{[top?.kind, fairPoint.name && `near ${fairPoint.name}`].filter(Boolean).join(" · ")}</div>
        {nearMetro && <div className="sub">🚇 {walk(metro)}</div>}
        <div className="big">{fmt(target.worst)}<small>longest commute</small></div>
        <div className="sub">Spread between fastest and slowest: {fmt(target.spread)} · Total: {fmt(target.total)}</div>
      </div>

      <div className="card">
        <h3>Fairness receipt</h3>
        <div className="sub">Each person&apos;s travel time to the recommended spot vs the geographic middle</div>
        <table>
          <thead><tr><th>Person</th><th className="num">Fair spot</th><th className="num">Geo middle</th>{inspect?.score && <th className="num">Your pin</th>}</tr></thead>
          <tbody>
            {pts.map((p, i) => {
              const a = target.col[i], g = cs?.col[i];
              const d = g != null ? a - g : null;
              return (
                <tr key={p.id}>
                  <td><span style={{ color: COLORS[i % COLORS.length] }}>●</span> {p.name} <span className="sub">{p.mode !== "drive" ? p.mode.replace("_", " ") : ""}</span></td>
                  <td className="num">{fmt(a)}{d != null && Math.abs(d) >= 60 && <span className={`delta ${d < 0 ? "good" : "bad"}`}>{d < 0 ? "−" : "+"}{Math.round(Math.abs(d) / 60)}</span>}</td>
                  <td className="num">{fmt(g)}</td>
                  {inspect?.score && <td className="num">{fmt(inspect.score.col[i])}</td>}
                </tr>
              );
            })}
            <tr><th>Worst commute</th><th className="num">{fmt(target.worst)}</th><th className="num">{fmt(cs?.worst)}</th>{inspect?.score && <th className="num">{fmt(inspect.score.worst)}</th>}</tr>
            <tr><th>Spread</th><th className="num">{fmt(target.spread)}</th><th className="num">{fmt(cs?.spread)}</th>{inspect?.score && <th className="num">{fmt(inspect.score.spread)}</th>}</tr>
          </tbody>
        </table>
        {cs && (
          <p className="why">
            {saved >= 60 ? (
              <>The geographic middle looks fair on a map but makes <b>{whoWorst}</b> travel <b>{fmt(cs.worst)}</b>. Moving to the fair spot saves them <b>{fmt(saved)}</b>{objective === "minimax" && <> while keeping everyone&apos;s longest trip under {fmt(target.worst)}</>}.</>
            ) : (
              <>Here the geographic middle is already close to fair: the road network treats everyone about equally.</>
            )}
          </p>
        )}
        {inspect && (
          <p className="why">
            {inspect.score
              ? <>Your pin{inspect.point.name ? <> near <b>{inspect.point.name}</b></> : null}: longest commute <b>{fmt(inspect.score.worst)}</b>, {inspect.score.worst > target.worst + 59 ? <>{fmt(inspect.score.worst - target.worst)} worse than the fair spot for <b>{pts[inspect.score.col.indexOf(inspect.score.worst)]?.name}</b>.</> : <>about as fair as the recommendation.</>}</>
              : <>Your pin is unreachable for at least one person.</>}
          </p>
        )}
        <p className="sub">Click anywhere on the map to ask &ldquo;why not here?&rdquo;</p>
      </div>

      {venues.length ? (
        <div className="card">
          <h3>Places near the fair spot</h3>
          <div className="sub">Ranked by {objective === "total" ? "total travel time" : "the longest commute"}, measured door to door</div>
          {venues.map((v, k) => (
            <div key={`${v.name}-${k}`} className={`venue ${k === 0 ? "top" : ""}`} onClick={() => onFocus(v)}>
              <div>
                <div className="n">{v.name}</div>
                <div className="k">{v.kind}{v.metro && v.metro.distM <= 800 ? ` · 🚇 ${Math.max(1, Math.round(v.metro.distM / 80))} min` : ""} · {v.score.col.map((t, i) => `${pts[i].name} ${Math.round(t / 60)}`).join(" · ")} min</div>
              </div>
              <div className="t">{fmt(v.score.worst)}<small>longest</small></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><h3>No places found nearby</h3><div className="sub">OpenStreetMap has no matching venues near this spot. Widen the venue types or relax a rule.</div></div>
      )}
      <div className="legend"><span>Shorter worst commute</span><div className="bar" /><span>Longer</span></div>
    </>
  );
}
