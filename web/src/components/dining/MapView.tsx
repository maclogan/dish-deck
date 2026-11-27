import { useEffect, useRef, useState } from "preact/hooks";
import type { LatLng, PlaceSummary } from "../../api";
import { PlaceCard, type PlaceActions } from "./PlaceCard";

// Google Maps JavaScript API, loaded once with the browser key (Places results have to be shown on a
// Google map). Typed loosely: the app doesn't ship @types/google.maps.
declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
    __dishdeckMaps?: Promise<void>;
    __dishdeckMapsReady?: () => void;
  }
}

// When Google refuses the key it calls gm_authFailure and logs the reason to the console as
// "Google Maps JavaScript API error: <Name>". Phones make the console hard to reach, so the reason is
// caught here and shown on the map with the fix.
const site = () => `${location.origin}/*`;
const MAP_ERRORS: Record<string, () => string> = {
  RefererNotAllowedMapError: () => `The map key doesn't allow this site. In Google Cloud → Credentials → the browser key → Website restrictions, add ${site()}`,
  ApiNotActivatedMapError: () => "The Maps JavaScript API isn't enabled. In Google Cloud → APIs & Services → Library, enable “Maps JavaScript API” for the key's project.",
  ApiTargetBlockedMapError: () => "The map key's API restrictions don't include the Maps JavaScript API. Add it under the key's API restrictions.",
  BillingNotEnabledMapError: () => "Billing isn't turned on for the map key's Google Cloud project. Link a billing account to the project.",
  InvalidKeyMapError: () => "Google doesn't recognize the map key. Copy GOOGLE_MAPS_BROWSER_KEY again from Google Cloud → Credentials.",
  ExpiredKeyMapError: () => "The map key has expired or was deleted. Create a new browser key and put it in GOOGLE_MAPS_BROWSER_KEY.",
  MissingKeyMapError: () => "No map key reached Google. Check GOOGLE_MAPS_BROWSER_KEY.",
  DeletedApiProjectMapError: () => "The map key's Google Cloud project was deleted. Create a key in an active project.",
  OverQuotaMapError: () => "The map key is over its quota for today.",
};
const GENERIC_HELP =
  "Google rejected the map key. In Google Cloud, check that the Maps JavaScript API is enabled for it, that its website restriction includes this site, and that billing is on.";
let mapProblem: string | undefined;
let authFailed = false;
const authListeners = new Set<() => void>();
const notify = () => authListeners.forEach((f) => f());

function watchConsole() {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    const name = /Google Maps JavaScript API (?:error|warning): (\w+)/.exec(text)?.[1];
    if (name && MAP_ERRORS[name]) {
      mapProblem = `${MAP_ERRORS[name]!()} (${name})`;
      notify();
    }
    original(...args);
  };
}

function authHelp() {
  return mapProblem ?? GENERIC_HELP;
}

/** Load the Maps JavaScript API once, with the browser key. */
function loadMaps(key: string): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (!window.__dishdeckMaps) watchConsole();
  window.gm_authFailure = () => {
    authFailed = true;
    // The console message with the reason usually comes a moment later.
    notify();
    window.setTimeout(notify, 300);
  };
  window.__dishdeckMaps ??= new Promise<void>((resolve, reject) => {
    window.__dishdeckMapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__dishdeckMapsReady`;
    s.async = true;
    s.onerror = () => {
      window.__dishdeckMaps = undefined;
      s.remove();
      reject(new Error("Couldn't reach Google Maps. Check the connection, or whether an ad or content blocker is stopping maps.googleapis.com."));
    };
    document.head.appendChild(s);
  });
  return window.__dishdeckMaps;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function MapView(props: { apiKey: string; center: LatLng; places: PlaceSummary[]; actions: PlaceActions }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onAuth = () => (authFailed || mapProblem) && setError(authHelp());
    authListeners.add(onAuth);
    onAuth();
    return () => void authListeners.delete(onAuth);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      await loadMaps(props.apiKey);
      const g = window.google.maps;
      const [{ Map }, { Marker }, core] = await Promise.all([g.importLibrary("maps"), g.importLibrary("marker"), g.importLibrary("core")]);
      if (!live || !el.current) return;
      map.current ??= new Map(el.current, {
        center: props.center,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "DARK" : "LIGHT",
      });
      markers.current.forEach((m) => m.setMap(null));
      const bounds = new core.LatLngBounds();
      bounds.extend(props.center);
      const you = new Marker({
        map: map.current,
        position: props.center,
        icon: { path: core.SymbolPath.CIRCLE, scale: 7, fillColor: "#3b82f6", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        title: "You",
      });
      markers.current = [
        you,
        ...props.places.map((p, i) => {
          const m = new Marker({
            map: map.current,
            position: p.location,
            label: { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
            icon: { path: core.SymbolPath.CIRCLE, scale: 13, fillColor: css("--tomato") || "#e4572e", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
            title: p.name,
          });
          m.addListener("click", () => {
            setFocus(p.id);
            listRef.current?.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
          bounds.extend(p.location);
          return m;
        }),
      ];
      if (props.places.length) map.current.fitBounds(bounds, 40);
      else map.current.setCenter(props.center);
    })().catch((e) => live && !authFailed && setError(`Couldn't load the map: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
  }, [props.apiKey, props.places, props.center.lat, props.center.lng]);

  return (
    <div class="map-view">
      {error ? (
        <div class="map-canvas map-error" role="alert">
          <p>{error}</p>
        </div>
      ) : (
        <div ref={el} class="map-canvas" role="region" aria-label="Map of results" />
      )}
      <div ref={listRef} class="map-list">
        {props.places.map((p, i) => (
          <div key={p.id} data-id={p.id} class={focus === p.id ? "focused" : ""}>
            <PlaceCard p={p} index={i} actions={props.actions} />
          </div>
        ))}
      </div>
    </div>
  );
}
