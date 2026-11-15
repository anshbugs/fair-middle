"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { venueKey, type InspectResult, type LatLng, type Mode, type PublicGroup, type RankedVenue } from "@/lib/types";
import { COLORS } from "./MapView";
import Receipt, { fmt } from "./Receipt";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const MODE_LABEL: Record<Mode, string> = { drive: "Car", two_wheeler: "Two-wheeler", transit: "Metro / bus", walk: "Walk" };

/** Who loses most if the group picks `v` instead of the recommendation `best`. */
export function voteCost(v: RankedVenue, best: RankedVenue, names: string[]): string {
  if (v === best) return "The fairest option";
  let worstI = -1, worstD = 0;
  v.score.col.forEach((t, i) => { const d = t - best.score.col[i]; if (d > worstD) { worstD = d; worstI = i; } });
  if (worstD < 60) return "Costs nobody more than a minute";
  return `Costs ${names[worstI]} +${Math.round(worstD / 60)} min`;
}

export default function GroupPage({ initial }: { initial: PublicGroup }) {
  const [g, setG] = useState<PublicGroup>(initial);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [loc, setLoc] = useState<(LatLng & { label: string }) | null>(null);
  const [mode, setMode] = useState<Mode>("drive");
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [showHeat, setShowHeat] = useState(true);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const me = g.viewer.participantId ? g.participants.find((p) => p.id === g.viewer.participantId) : undefined;
  const joined = !!me;
  const open = g.status === "open";
  const result = g.result;
  const best = result?.venues[0];
  const names = (result?.participants ?? g.participants).map((p) => p.name); // roster the result was computed for
  const confirmedVenue = g.confirmedVenueKey ? result?.venues.find((v) => venueKey(v) === g.confirmedVenueKey) : undefined;
  const shareUrl = origin ? `${origin}/g/${g.id}` : "";

  // Poll while the plan is open so joins, re-solves and votes show up for everyone.
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/groups/${g.id}`, { cache: "no-store" });
    if (r.ok) setG(await r.json());
  }, [g.id]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(refresh, g.computing ? 2500 : 6000);
    return () => clearInterval(t);
  }, [open, g.computing, refresh]);

  const geocode = async () => {
    if (!query.trim()) return;
    setStatus({ text: `Looking up “${query}”…` });
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const j = await r.json();
    if (!r.ok) return setStatus({ text: j.error, err: true });
    setLoc(j); setStatus({ text: "" });
  };

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/groups/${g.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setG(j); setStatus({ text: "" });
      return true;
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Something went wrong.", err: true });
      return false;
    } finally { setBusy(false); }
  };

  const joinNow = async () => {
    if (!loc) return setStatus({ text: "Find your start or pin it on the map.", err: true });
    if (await post("join", { name: name.trim() || "Me", lat: loc.lat, lon: loc.lon, mode, query })) { setEditing(false); setStatus({ text: g.participants.length + 1 >= 2 ? "You're in. Updating the fair spot…" : "You're in. Share the link so others can join." }); }
  };

  const inspectAt = useCallback(async (p: LatLng) => {
    setStatus({ text: "Checking that spot…" });
    const r = await fetch(`/api/groups/${g.id}/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json();
    if (!r.ok) return setStatus({ text: j.error, err: true });
    setInspect(j); setStatus({ text: "" });
  }, [g.id]);

  const pickingRef = useRef(picking); useEffect(() => { pickingRef.current = picking; }, [picking]);
  const onMapClick = useCallback((p: LatLng) => {
    if (pickingRef.current) { setLoc({ ...p, label: `Pinned at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` }); setPicking(false); return; }
    if (g.participants.length >= 2) void inspectAt(p);
  }, [inspectAt, g.participants.length]);

  const mapPeople = useMemo(() => g.participants.map((p) => ({ name: p.name, lat: null, lon: null })), [g.participants]);
  const waText = encodeURIComponent(
    confirmedVenue
      ? `We're meeting at ${confirmedVenue.name}. Longest commute ${fmt(confirmedVenue.score.worst)} for anyone, fair by travel time. ${shareUrl}`
      : best
        ? `Fairest spot for all of us: ${best.name} (longest commute ${fmt(best.score.worst)}). Vote or add yourself: ${shareUrl}`
        : `${g.title || "Where should we meet?"} Drop your start here and it finds the spot that's fair by travel time: ${shareUrl}`,
  );

  const showJoin = open && (!joined || editing);

  return (
    <div className="app">
      <aside className="side">
        <h1>{g.title || "Fair Middle"}</h1>
        <p className="tag">{g.title ? "Fair Middle · " : ""}Meet where the <b>time</b> is fair, not the distance.</p>

        {g.status === "confirmed" && confirmedVenue && (
          <div className="card confirmed">
            <div className="sub">Confirmed</div>
            <h3>We&apos;re meeting at {confirmedVenue.name}</h3>
            <div className="sub">{confirmedVenue.kind} · longest commute {fmt(confirmedVenue.score.worst)}</div>
          </div>
        )}

        <h2>Who is coming ({g.participants.length})</h2>
        {g.participants.length === 0 && <p className="sub">Nobody yet. Add yourself below, then share the link.</p>}
        {g.participants.map((p, i) => (
          <div className="person compact" key={p.id}>
            <div className="dot" style={{ background: COLORS[i % COLORS.length] }}>{p.name.slice(0, 1).toUpperCase()}</div>
            <div><b>{p.name}</b>{p.id === me?.id ? " (you)" : ""}<div className="where">{MODE_LABEL[p.mode]}{g.votes && g.myVote && p.id === me?.id ? " · voted" : ""}</div></div>
            {p.id === me?.id && open && <button className="icon" title="Change my start" onClick={() => setEditing((e) => !e)}>✎</button>}
          </div>
        ))}

        {showJoin && (
          <div className="card">
            <h3>{joined ? "Update your start" : "Add yourself"}</h3>
            <div className="sub">Only your travel time is shown to the others, never your location.</div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="row">
              <input value={query} placeholder="Start, e.g. Saket, Delhi" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && geocode()} />
              <button onClick={geocode}>Find</button>
              <button onClick={() => setPicking(true)}>Pin</button>
            </div>
            <div className="row">
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </div>
            <div className={`where ${loc ? "" : "warn"}`}>{loc ? `📍 ${loc.label}` : "No location yet"}</div>
            <button className="primary" onClick={joinNow} disabled={busy}>{joined ? "Save" : "Join the plan"}</button>
          </div>
        )}

        {open && g.participants.length < 2 && (
          <div className="card">
            <h3>Share the link</h3>
            <div className="sub">The fair spot appears as soon as two people are in.</div>
            <div className="share"><input readOnly value={shareUrl} onFocus={(e) => e.target.select()} /><button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button></div>
            <a className="wa" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          </div>
        )}

        <div className={`status ${status.err ? "err" : ""}`}>{g.computing ? "Updating the fair spot…" : status.text}</div>

        {result && open && result.venues.length > 0 && (
          <div className="card">
            <h3>Where do we go?</h3>
            <div className="sub">Top places by the longest commute. Each vote shows who pays for it.</div>
            {result.venues.slice(0, 3).map((v, k) => {
              const key = venueKey(v);
              const n = g.votes[key] ?? 0;
              return (
                <div key={key} className={`venue vote ${g.myVote === key ? "mine" : ""}`} onClick={() => setFocus(v)}>
                  <div>
                    <div className="n">{v.name} <span className="sub">{v.kind}</span></div>
                    <div className="k">{voteCost(v, best!, names)} · longest {fmt(v.score.worst)}</div>
                  </div>
                  <div className="t">
                    <div className="count">{n} {n === 1 ? "vote" : "votes"}</div>
                    {joined && <button disabled={busy} onClick={(e) => { e.stopPropagation(); void post("vote", { key }); }}>{g.myVote === key ? "Voted" : "Vote"}</button>}
                    {g.viewer.isOrganiser && <button className="confirm" disabled={busy} onClick={(e) => { e.stopPropagation(); void post("confirm", { key }); }}>Confirm</button>}
                  </div>
                </div>
              );
            })}
            {!joined && <p className="sub">Add yourself to vote.</p>}
          </div>
        )}

        {result && <label className="opt"><input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> Show fairness heatmap</label>}
        {result && <Receipt result={result} inspect={inspect} onFocus={setFocus} />}

        {(result || g.status === "confirmed") && (
          <div className="card">
            <h3>Share</h3>
            <div className="share"><input readOnly value={shareUrl} onFocus={(e) => e.target.select()} /><button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button></div>
            <div className="row" style={{ marginTop: 8 }}>
              <a className="wa" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              <a className="wa alt" href={`/g/${g.id}/card.png`} target="_blank" rel="noreferrer">Card image</a>
            </div>
          </div>
        )}

        <p className="foot"><a href="/">Start a new plan</a> · Travel times from {result?.provider ?? "OSRM"}. Friends see travel times, never each other&apos;s locations. Plans expire after 7 days.</p>
      </aside>
      <div className="mapwrap">
        {picking && <div className="pinhint">Click the map to place your start</div>}
        <MapView people={mapPeople} result={result} inspect={inspect} showHeat={showHeat} onClick={onMapClick} cursor={picking ? "pin" : g.participants.length >= 2 ? "inspect" : "default"} focus={focus} />
      </div>
    </div>
  );
}
