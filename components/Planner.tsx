"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VENUE_KINDS, type InspectResult, type LatLng, type Mode, type Objective, type PublicGroup, type SolveResult, type VenueKind } from "@/lib/types";
import { COLORS } from "./MapView";
import Receipt, { fmt } from "./Receipt";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type Person = { name: string; query: string; lat: number | null; lon: number | null; where: string; mode: Mode };

const DEMO: Person[] = [
  { name: "Priya", query: "Dwarka Sector 10, Delhi", lat: 28.5823, lon: 77.05, where: "Dwarka Sector 10, Delhi", mode: "drive" },
  { name: "Rahul", query: "Indirapuram, Ghaziabad", lat: 28.642, lon: 77.37, where: "Indirapuram, Ghaziabad", mode: "drive" },
  { name: "Aman", query: "Saket, Delhi", lat: 28.5245, lon: 77.2066, where: "Saket, Delhi", mode: "drive" },
];

const MODE_LABEL: Record<Mode, string> = { drive: "Car", two_wheeler: "Two-wheeler", transit: "Metro / bus", walk: "Walk" };
const KIND_LABEL: Record<VenueKind, string> = { cafe: "Cafés", restaurant: "Restaurants", bar: "Bars", pub: "Pubs", food_court: "Food courts" };
const DAY_HOURS = [8, 11, 14, 17, 20, 23];
const blank = (i: number): Person => ({ name: `Person ${i}`, query: "", lat: null, lon: null, where: "", mode: "drive" });

/** Next occurrence of each hour, as ISO strings, starting from now. */
function departureOptions(): { label: string; iso: string }[] {
  const now = new Date();
  return DAY_HOURS.map((h) => {
    const d = new Date(now); d.setHours(h, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return { label: `${d.toLocaleDateString([], { weekday: "short" })} ${h % 12 || 12}${h < 12 ? "am" : "pm"}`, iso: d.toISOString() };
  }).sort((a, b) => a.iso.localeCompare(b.iso));
}

export default function Planner({ shared }: { shared?: PublicGroup }) {
  const [people, setPeople] = useState<Person[]>(() =>
    shared ? shared.participants.map((p) => ({ name: p.name, query: "", lat: null, lon: null, where: "shared plan", mode: p.mode })) : [blank(1), blank(2)],
  );
  const [objective, setObjective] = useState<Objective>(shared?.result?.objective ?? shared?.objective ?? "minimax");
  const [maxMinutes, setMaxMinutes] = useState<string>(shared?.result?.constraints.maxMinutes?.toString() ?? "");
  const [nearMetro, setNearMetro] = useState<boolean>(shared?.result?.constraints.nearMetroM != null);
  const [kinds, setKinds] = useState<VenueKind[]>(shared?.result?.constraints.kinds ?? [...VENUE_KINDS]);
  const [departOpts] = useState(departureOptions);
  const [departAt, setDepartAt] = useState<string>("");
  const [showHeat, setShowHeat] = useState(true);
  const [result, setResult] = useState<SolveResult | null>(shared?.result ?? null);
  const [dayResults, setDayResults] = useState<{ label: string; result: SolveResult }[] | null>(null);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [groupId, setGroupId] = useState<string | null>(shared?.id ?? null);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: shared ? "Shared plan. Click the map to ask “why not here?”, or start your own." : "" });
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const readOnly = !!shared;
  const router = useRouter();
  const [flow, setFlow] = useState<"group" | "quick">("group");
  const [title, setTitle] = useState("");

  /** Account-free flow: create an empty plan, become organiser, go to the link. */
  const createLink = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/groups", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, objective, constraints: { maxMinutes: maxMinutes ? Number(maxMinutes) : undefined, nearMetroM: nearMetro ? 600 : undefined, kinds: kinds.length < VENUE_KINDS.length ? kinds : undefined } }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      router.push(`/g/${j.groupId}`);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Something went wrong.", err: true });
      setBusy(false);
    }
  };

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

  const inspectAt = useCallback(async (p: LatLng, gid: string) => {
    setStatus({ text: "Checking that spot…" });
    const r = await fetch(`/api/groups/${gid}/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json();
    if (!r.ok) return setStatus({ text: j.error, err: true });
    setInspect(j); setStatus({ text: "" });
  }, []);

  // Refs mirror the two pieces of state the map click needs, so the handler never goes stale.
  const pickingRef = useRef<number | null>(null);
  const groupIdRef = useRef<string | null>(groupId);
  useEffect(() => { pickingRef.current = picking; }, [picking]);
  useEffect(() => { groupIdRef.current = groupId; }, [groupId]);
  const onMapClick = useCallback((p: LatLng) => {
    const i = pickingRef.current;
    if (i != null) {
      setPeople((ps) => ps.map((x, k) => (k === i ? { ...x, lat: p.lat, lon: p.lon, where: `Pinned at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` } : x)));
      setPicking(null);
      return;
    }
    if (groupIdRef.current) void inspectAt(p, groupIdRef.current);
  }, [inspectAt]);

  const body = (depart?: string) => ({
    objective,
    departAt: depart || undefined,
    constraints: { maxMinutes: maxMinutes ? Number(maxMinutes) : undefined, nearMetroM: nearMetro ? 600 : undefined, kinds: kinds.length < VENUE_KINDS.length ? kinds : undefined },
    participants: people.filter((p) => p.lat != null).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, mode: p.mode, query: p.query })),
  });

  const run = async () => {
    if (people.filter((p) => p.lat != null).length < 2) return setStatus({ text: "Add at least two people with locations.", err: true });
    setBusy(true); setResult(null); setDayResults(null); setInspect(null); setGroupId(null); setPicking(null);
    setStatus({ text: "Measuring travel times across the city, then finding places at the fair spot…" });
    try {
      const r = await fetch("/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(departAt)) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setResult(j.result); setGroupId(j.groupId); setStatus({ text: "" });
      window.history.replaceState(null, "", `/g/${j.groupId}`);
      // The share page has votes and the WhatsApp card; the quick result stays visible here too.
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Something went wrong.", err: true });
    } finally { setBusy(false); }
  };

  /** Solve once per departure bucket so the fair spot can be stepped through the day. */
  const compareDay = async () => {
    setBusy(true); setDayResults(null);
    const out: { label: string; result: SolveResult }[] = [];
    try {
      for (const o of departOpts) {
        setStatus({ text: `Solving for ${o.label}…` });
        const r = await fetch("/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(o.iso)) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        out.push({ label: o.label, result: j.result });
        setDayResults([...out]);
      }
      setStatus({ text: "" });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Something went wrong.", err: true });
    } finally { setBusy(false); }
  };

  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => { setShareUrl(groupId ? `${window.location.origin}/g/${groupId}` : ""); }, [groupId]);
  const mapPeople = useMemo(() => people.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })), [people]);
  const toggleKind = (k: VenueKind) => setKinds((ks) => (ks.includes(k) ? (ks.length > 1 ? ks.filter((x) => x !== k) : ks) : [...ks, k]));

  return (
    <div className="app">
      <aside className="side">
        <h1>Fair Middle</h1>
        <p className="tag">Meet where the <b>time</b> is fair, not the distance.</p>

        {!readOnly && (
          <div className="modes">
            <button className={flow === "group" ? "on" : ""} onClick={() => setFlow("group")}>Send a link</button>
            <button className={flow === "quick" ? "on" : ""} onClick={() => setFlow("quick")}>I know everyone&apos;s start</button>
          </div>
        )}
        {!readOnly && flow === "group" && (
          <div className="card">
            <h3>One link for the group</h3>
            <div className="sub">Everyone drops their own start privately. The fair spot updates as people join, then you vote and confirm.</div>
            <div className="row"><input value={title} placeholder="Plan name, e.g. Friday dinner" onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
        )}
        {(readOnly || flow === "quick") && <h2>Who is coming</h2>}
        {(readOnly || flow === "quick") && people.map((p, i) => (
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
            {flow === "quick" && <div className="actions">
              <button disabled={people.length >= 8} onClick={() => setPeople((ps) => [...ps, blank(ps.length + 1)])}>+ Add person</button>
              <button onClick={() => { setPeople(DEMO); setResult(null); setDayResults(null); setInspect(null); setGroupId(null); setStatus({ text: "Three friends across Delhi. Hit “Find the fair spot”." }); }}>Load Delhi demo</button>
            </div>}

            <h2>Rules</h2>
            <label className="opt">Fairness
              <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
                <option value="minimax">Minimize the worst commute</option>
                <option value="total">Minimize total travel time</option>
              </select>
            </label>
            <label className="opt">Leave at
              <select value={departAt} onChange={(e) => setDepartAt(e.target.value)}>
                <option value="">Now</option>
                {departOpts.map((o) => <option key={o.iso} value={o.iso}>{o.label}</option>)}
              </select>
            </label>
            <label className="opt">Nobody over
              <input className="num" type="number" min={5} max={240} step={5} placeholder="—" value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} /> min
            </label>
            <label className="opt"><input type="checkbox" checked={nearMetro} onChange={(e) => setNearMetro(e.target.checked)} /> Within a short walk of a metro station</label>
            <div className="chips">
              {VENUE_KINDS.map((k) => (
                <button key={k} className={`chip ${kinds.includes(k) ? "on" : ""}`} onClick={() => toggleKind(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
          </>
        )}
        {(readOnly || flow === "quick") && <label className="opt"><input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> Show fairness heatmap</label>}
        {!readOnly && flow === "quick" && <button className="primary" onClick={run} disabled={busy}>{busy ? "Working…" : "Find the fair spot"}</button>}
        {!readOnly && flow === "group" && <button className="primary" onClick={createLink} disabled={busy}>{busy ? "Creating…" : "Create the link"}</button>}
        {readOnly && <a href="/"><button className="primary">Plan your own</button></a>}
        <div className={`status ${status.err ? "err" : ""}`}>{status.text}</div>

        {result && !readOnly && result.departureAware && (
          <div className="card">
            <h3>Does the fair spot move during the day?</h3>
            <div className="sub">Re-solve for six departure times with live traffic and transit schedules.</div>
            {!dayResults && <button onClick={compareDay} disabled={busy}>Compare across the day</button>}
            {dayResults && (
              <div className="chips">
                {dayResults.map((d) => (
                  <button key={d.label} className={`chip ${result === d.result ? "on" : ""}`} onClick={() => { setResult(d.result); setInspect(null); }}>
                    {d.label} · {fmt(d.result.fairScore.worst)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {result && <Receipt result={result} inspect={inspect} onFocus={setFocus} />}
        {shareUrl && (
          <div className="share">
            <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy link</button>
          </div>
        )}
        {result && (
          <p className="foot">
            Times from {result.provider}. Rule: {result.objective === "total" ? "minimise total" : "minimise the worst commute"}.
            {result.departureAware ? " Traffic and transit schedules for the chosen departure time." : " Free-flow road times; non-car modes are estimates until the Google Routes provider is enabled."}
          </p>
        )}
        <p className="foot">Travel times from OSRM on OpenStreetMap data. Venues and metro stations from OpenStreetMap. Friends in a shared plan see travel times, never each other&apos;s locations.</p>
      </aside>
      <div className="mapwrap">
        {picking != null && <div className="pinhint">Click the map to place {people[picking]?.name}</div>}
        <MapView people={mapPeople} result={result} inspect={inspect} showHeat={showHeat} onClick={onMapClick} cursor={picking != null ? "pin" : groupId ? "inspect" : "default"} focus={focus} />
      </div>
    </div>
  );
}
