"use client";

import * as maplibregl from "maplibre-gl";
import { Map as MLMap, Marker, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { LatLng, SolveResult } from "@/lib/types";

export const COLORS = ["#2563eb", "#db2777", "#d97706", "#7c3aed", "#059669", "#dc2626", "#0891b2", "#65a30d"];

type Props = {
  people: { name: string; lat: number | null; lon: number | null }[];
  result: SolveResult | null;
  showHeat: boolean;
  onPick?: (p: LatLng) => void;
  picking: boolean;
  focus?: LatLng | null;
};

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function el(className: string, text = "", style = "") {
  const d = document.createElement("div");
  d.className = className; d.textContent = text; d.setAttribute("style", style);
  return d;
}

export default function MapView({ people, result, showHeat, onPick, picking, focus }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const ready = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!box.current || map.current) return;
    // Bundlers rewrite the worker URL; serve the worker statically instead.
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [77.21, 28.61], zoom: 10, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.on("load", () => {
      m.addSource("heat", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "heat", type: "circle", source: "heat", paint: {
        "circle-radius": ["case", ["==", ["get", "pass"], 2], 5, 9],
        "circle-color": ["get", "color"],
        "circle-opacity": ["case", ["==", ["get", "pass"], 2], 0.6, 0.4],
      } });
      m.addSource("lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "lines", type: "line", source: "lines", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.6, "line-dasharray": [2, 3] } });
      ready.current = true;
      box.current?.setAttribute("data-loaded", "1");
    });
    m.on("error", (e) => console.error("[map]", e.error?.message ?? e));
    m.on("click", (e: MapMouseEvent) => pickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  useEffect(() => {
    const m = map.current; if (!m) return;
    m.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  // Markers, heat and lines
  useEffect(() => {
    const m = map.current; if (!m) return;
    const draw = () => {
      markers.current.forEach((mk) => mk.remove()); markers.current = [];
      const bounds = new maplibregl.LngLatBounds();
      people.forEach((p, i) => {
        if (p.lat == null || p.lon == null) return;
        const mk = new Marker({ element: el("mk-person", p.name.slice(0, 1).toUpperCase(), `background:${COLORS[i % COLORS.length]}`) }).setLngLat([p.lon, p.lat]).addTo(m);
        markers.current.push(mk); bounds.extend([p.lon, p.lat]);
      });
      const heatFeatures: GeoJSON.Feature[] = [];
      const lineFeatures: GeoJSON.Feature[] = [];
      if (result) {
        const vals = result.heat.map((h) => h.key);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        if (showHeat) result.heat.forEach((h) => {
          const t = hi === lo ? 0 : (h.key - lo) / (hi - lo);
          heatFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [h.lon, h.lat] }, properties: { pass: h.pass, color: `hsl(${120 * (1 - t)} 65% 48%)` } });
        });
        markers.current.push(new Marker({ element: el("mk-ghost") }).setLngLat([result.centroid.lon, result.centroid.lat]).setPopup(new maplibregl.Popup({ closeButton: false }).setText("Geographic middle (the obvious spot)")).addTo(m));
        markers.current.push(new Marker({ element: el("mk-star", "⭐") }).setLngLat([result.fairPoint.lon, result.fairPoint.lat]).setPopup(new maplibregl.Popup({ closeButton: false }).setText("Fair spot by travel time")).addTo(m));
        bounds.extend([result.centroid.lon, result.centroid.lat]); bounds.extend([result.fairPoint.lon, result.fairPoint.lat]);
        people.forEach((p, i) => { if (p.lat != null && p.lon != null) lineFeatures.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[p.lon, p.lat], [result.fairPoint.lon, result.fairPoint.lat]] }, properties: { color: COLORS[i % COLORS.length] } }); });
        result.venues.forEach((v, k) => {
          markers.current.push(new Marker({ element: el(`mk-venue${k === 0 ? " top" : ""}`) }).setLngLat([v.lon, v.lat]).setPopup(new maplibregl.Popup({ closeButton: false }).setText(`${v.name} · longest ${Math.round(v.score.worst / 60)} min`)).addTo(m));
        });
      }
      (m.getSource("heat") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: heatFeatures });
      (m.getSource("lines") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: lineFeatures });
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 600 });
    };
    const safeDraw = () => { try { draw(); } catch (err) { console.error("[map draw]", err); } };
    if (ready.current) safeDraw(); else m.once("load", safeDraw);
  }, [people, result, showHeat]);

  useEffect(() => {
    if (focus && map.current) map.current.flyTo({ center: [focus.lon, focus.lat], zoom: 15 });
  }, [focus]);

  return <div ref={box} className="map" />;
}
