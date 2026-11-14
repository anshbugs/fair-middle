"use client";

import type { LatLng, SolveResult } from "@/lib/types";
import { COLORS } from "./MapView";

const fmt = (s?: number | null) => (s == null ? "—" : `${Math.round(s / 60)} min`);

export default function Receipt({ result, onFocus }: { result: SolveResult; onFocus: (p: LatLng) => void }) {
  const { participants: pts, venues, centroidScore: cs, fairPoint, objective } = result;
  const top = venues[0];
  const target = top ? top.score : result.fairScore;
  const worstIdx = cs ? cs.col.indexOf(cs.worst) : -1;
  const saved = cs ? cs.worst - target.worst : 0;
  const whoWorst = worstIdx >= 0 ? pts[worstIdx].name : "";

  return (
    <>
      <div className="card">
        <div className="sub">Recommended</div>
        <h3>{top ? top.name : "Fair spot"}</h3>
        <div className="sub">{[top?.kind, fairPoint.name && `near ${fairPoint.name}`].filter(Boolean).join(" · ")}</div>
        <div className="big">{fmt(target.worst)}<small>longest commute</small></div>
        <div className="sub">Spread between fastest and slowest: {fmt(target.spread)} · Total: {fmt(target.total)}</div>
      </div>

      <div className="card">
        <h3>Fairness receipt</h3>
        <div className="sub">Each person&apos;s travel time to the recommended spot vs the geographic middle</div>
        <table>
          <thead><tr><th>Person</th><th className="num">Fair spot</th><th className="num">Geo middle</th></tr></thead>
          <tbody>
            {pts.map((p, i) => {
              const a = target.col[i], g = cs?.col[i];
              const d = g != null ? a - g : null;
              return (
                <tr key={p.id}>
                  <td><span style={{ color: COLORS[i % COLORS.length] }}>●</span> {p.name} <span className="sub">{p.mode !== "drive" ? p.mode.replace("_", " ") : ""}</span></td>
                  <td className="num">{fmt(a)}{d != null && Math.abs(d) >= 60 && <span className={`delta ${d < 0 ? "good" : "bad"}`}>{d < 0 ? "−" : "+"}{Math.round(Math.abs(d) / 60)}</span>}</td>
                  <td className="num">{fmt(g)}</td>
                </tr>
              );
            })}
            <tr><th>Worst commute</th><th className="num">{fmt(target.worst)}</th><th className="num">{fmt(cs?.worst)}</th></tr>
            <tr><th>Spread</th><th className="num">{fmt(target.spread)}</th><th className="num">{fmt(cs?.spread)}</th></tr>
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
      </div>

      {venues.length ? (
        <div className="card">
          <h3>Places near the fair spot</h3>
          <div className="sub">Ranked by {objective === "total" ? "total travel time" : "the longest commute"}, measured door to door</div>
          {venues.map((v, k) => (
            <div key={`${v.name}-${k}`} className={`venue ${k === 0 ? "top" : ""}`} onClick={() => onFocus(v)}>
              <div>
                <div className="n">{v.name}</div>
                <div className="k">{v.kind} · {v.score.col.map((t, i) => `${pts[i].name} ${Math.round(t / 60)}`).join(" · ")} min</div>
              </div>
              <div className="t">{fmt(v.score.worst)}<small>longest</small></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><h3>No cafés found nearby</h3><div className="sub">OpenStreetMap has no named cafés or restaurants near this spot. Try the other fairness rule or add a person.</div></div>
      )}
      <div className="legend"><span>Shorter worst commute</span><div className="bar" /><span>Longer</span></div>
    </>
  );
}
