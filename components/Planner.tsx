"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LatLng, Mode, Objective, PublicGroup, SolveResult } from "@/lib/types";
import { COLORS } from "./MapView";
import Receipt from "./Receipt";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type Person = { name: string; query: string; lat: number | null; lon: number | null; where: string; mode: Mode };

const DEMO: Person[] = [
  { name: "Priya", query: "Dwarka Sector 10, Delhi", lat: 28.5823, lon: 77.05, where: "Dwarka Sector 10, Delhi", mode: "drive" },
  { name: "Rahul", query: "Indirapuram, Ghaziabad", lat: 28.642, lon: 77.37, where: "Indirapuram, Ghaziabad", mode: "drive" },
  { name: "Aman", query: "Saket, Delhi", lat: 28.5245, lon: 77.2066, where: "Saket, Delhi", mode: "drive" },
];

const MODE_LABEL: Record<Mode, string> = { drive: "Car", two_wheeler: "Two-wheeler", transit: "Metro / bus", walk: "Walk" };
const blank = (i: number): Person => ({ name: `Person ${i}`, query: "", lat: null, lon: null, where: "", mode: "drive" });

export default function Planner({ shared }: { shared?: PublicGroup }) {
  const [people, setPeople] = useState<Person[]>(() =>
    shared ? shared.participants.map((p) => ({ name: p.name, query: "", lat: null, lon: null, where: "shared plan", mode: p.mode })) : [blank(1), blank(2)],
  );
  const [objective, setObjective] = useState<Objective>(shared?.objective ?? "minimax");
  const [showHeat, setShowHeat] = useState(true);
  const [result, setResult] = useState<SolveResult | null>(shared?.result ?? null);
  const [groupId, setGroupId] = useState<string | null>(shared?.id ?? null);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: shared ? "Shared plan. Start your own below." : "" });
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const readOnly = !!shared;

  const update = (i: number, patch: Partial<Person>) => setPeople((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const geocode = async (i: number) => {
    const q = people[i].query.trim();
    if (!q) return;
    setStatus({ text: `Looking up “${q}”…` });
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!r.ok) return setStatus({ text: j.error, err: true });
    update(i, { lat: j.lat, lon: j.lon, where: j.label });
    setStatus({ text: "" });
  };

  const onPick = useCallback((p: LatLng) => {
    setPicking((i) => {
      if (i == null) return null;
      setPeople((ps) => ps.map((x, k) => (k === i ? { ...x, lat: p.lat, lon: p.lon, where: `Pinned at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` } : x)));
      return null;
    });
  }, []);

  const run = async () => {
    const ready = people.filter((p) => p.lat != null);
    if (ready.length < 2) return setStatus({ text: "Add at least two people with locations.", err: true });
    setBusy(true); setResult(null); setGroupId(null); setPicking(null);
    setStatus({ text: "Measuring travel times across the city, then finding places at the fair spot…" });
    try {
      const r = await fetch("/api/solve", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective, participants: ready.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, mode: p.mode, query: p.query })) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setResult(j.result); setGroupId(j.groupId); setStatus({ text: "" });
      window.history.replaceState(null, "", `/g/${j.groupId}`);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Something went wrong.", err: true });
    } finally { setBusy(false); }
  };

  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => { setShareUrl(groupId ? `${window.location.origin}/g/${groupId}` : ""); }, [groupId]);
  const mapPeople = useMemo(() => people.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })), [people]);

  return (
    <div className="app">
      <aside className="side">
        <h1>Fair Middle</h1>
        <p className="tag">Meet where the <b>time</b> is fair, not the distance.</p>

        <h2>Who is coming</h2>
        {people.map((p, i) => (
          <div className="person" key={i}>
            <div className="dot" style={{ background: COLORS[i % COLORS.length] }}>{p.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <input value={p.name} disabled={readOnly} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" />
              {!readOnly && (
                <>
                  <div className="row">
                    <input value={p.query} placeholder="Start, e.g. Saket, Delhi" onChange={(e) => update(i, { query: e.target.value })} onKeyDown={(e) => e.key === "Enter" && geocode(i)} />
                    <button onClick={() => geocode(i)} title="Look up this address">Find</button>
                    <button onClick={() => setPicking(i)} title="Click on the map instead">Pin</button>
                  </div>
                  <div className="row">
                    <select value={p.mode} onChange={(e) => update(i, { mode: e.target.value as Mode })}>
                      {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className={`where ${p.lat == null && !readOnly ? "warn" : ""}`}>{readOnly ? MODE_LABEL[p.mode] : p.lat != null ? `📍 ${p.where}` : "No location yet"}</div>
            </div>
            {!readOnly && <button className="icon" title="Remove" onClick={() => setPeople((ps) => ps.filter((_, k) => k !== i))}>✕</button>}
          </div>
        ))}

        {!readOnly && (
          <>
            <div className="actions">
              <button disabled={people.length >= 8} onClick={() => setPeople((ps) => [...ps, blank(ps.length + 1)])}>+ Add person</button>
              <button onClick={() => { setPeople(DEMO); setResult(null); setGroupId(null); setStatus({ text: "Three friends across Delhi. Hit “Find the fair spot”." }); }}>Load Delhi demo</button>
            </div>
            <label className="opt">Fairness rule
              <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
                <option value="minimax">Minimize the worst commute</option>
                <option value="total">Minimize total travel time</option>
              </select>
            </label>
          </>
        )}
        <label className="opt"><input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> Show fairness heatmap</label>
        {!readOnly && <button className="primary" onClick={run} disabled={busy}>{busy ? "Working…" : "Find the fair spot"}</button>}
        {readOnly && <a href="/"><button className="primary">Plan your own</button></a>}
        <div className={`status ${status.err ? "err" : ""}`}>{status.text}</div>

        {result && <Receipt result={result} onFocus={setFocus} />}
        {shareUrl && (
          <div className="share">
            <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy link</button>
          </div>
        )}
        {result && <p className="foot">Times from {result.provider}. Rule: {result.objective === "total" ? "minimise total" : "minimise the worst commute"}. Modes other than car are estimates until the Google Routes provider lands.</p>}
        <p className="foot">Travel times from OSRM on OpenStreetMap data. Venues from OpenStreetMap. Friends in a shared plan see travel times, never each other&apos;s locations.</p>
      </aside>
      <div className="mapwrap">
        {picking != null && <div className="pinhint">Click the map to place {people[picking]?.name}</div>}
        <MapView people={mapPeople} result={result} showHeat={showHeat} onPick={onPick} picking={picking != null} focus={focus} />
      </div>
    </div>
  );
}
