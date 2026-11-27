import { useEffect, useRef, useState } from "preact/hooks";
import type { LatLng, PlaceSummary } from "../../api";
import { PlaceCard, type PlaceActions } from "./PlaceCard";

// Google Maps JavaScript API, loaded once with the browser key (Places results have to be shown on a
// Google map). Typed loosely: the app doesn't ship @types/google.maps.
declare global {
  interface Window {
    google?: any;
    __dishdeckMaps?: Promise<any>;
  }
}

function loadMaps(key: string): Promise<any> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  window.__dishdeckMaps ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__dishdeckMapsReady`;
    s.async = true;
    (window as any).__dishdeckMapsReady = () => resolve(window.google.maps);
    s.onerror = () => {
      window.__dishdeckMaps = undefined;
      reject(new Error("Couldn't load Google Maps"));
    };
    document.head.appendChild(s);
  });
  return window.__dishdeckMaps;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function MapView(props: { apiKey: string; center: LatLng; places: PlaceSummary[]; units: "mi" | "km"; actions: PlaceActions }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadMaps(props.apiKey)
      .then((maps) => {
        if (!live || !el.current) return;
        map.current ??= new maps.Map(el.current, {
          center: props.center,
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "DARK" : "LIGHT",
        });
        markers.current.forEach((m) => m.setMap(null));
        const bounds = new maps.LatLngBounds();
        bounds.extend(props.center);
        new maps.Marker({
          map: map.current,
          position: props.center,
          icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#3b82f6", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
          title: "You",
        });
        markers.current = props.places.map((p, i) => {
          const m = new maps.Marker({
            map: map.current,
            position: p.location,
            label: { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
            icon: { path: maps.SymbolPath.CIRCLE, scale: 13, fillColor: css("--tomato") || "#e4572e", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
            title: p.name,
          });
          m.addListener("click", () => {
            setFocus(p.id);
            listRef.current?.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
          bounds.extend(p.location);
          return m;
        });
        if (props.places.length) map.current.fitBounds(bounds, 40);
        else map.current.setCenter(props.center);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the map"));
    return () => {
      live = false;
    };
  }, [props.apiKey, props.places, props.center.lat, props.center.lng]);

  return (
    <div class="map-view">
      <div ref={el} class="map-canvas" role="region" aria-label="Map of results">
        {error && <p class="note">{error}</p>}
      </div>
      <div ref={listRef} class="map-list">
        {props.places.map((p, i) => (
          <div key={p.id} data-id={p.id} class={focus === p.id ? "focused" : ""}>
            <PlaceCard p={p} index={i} units={props.units} actions={props.actions} />
          </div>
        ))}
      </div>
    </div>
  );
}
