import { useEffect, useRef, useState } from "preact/hooks";
import { api, type LatLng, type LocationSuggestion } from "../../api";
import { IconClock, IconLocate, IconPin, IconSearch } from "../../icons";
import { Sheet } from "../Sheet";
import { addRecent, clockText, loadRecents, loadSpots, saveSpots, type SavedLocation, type Spots } from "./state";

/** Ask the browser for the phone's position. */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share its location"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? "Location access is off for this site" : "Couldn't find your location")),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  });
}

const WHEN_PRESETS: { label: string; value?: string }[] = [
  { label: "Now" },
  { label: "Breakfast · 8 AM", value: "08:00" },
  { label: "Lunch · noon", value: "12:00" },
  { label: "Dinner · 6:30 PM", value: "18:30" },
  { label: "Late · 9 PM", value: "21:00" },
];

export function LocationBar(props: {
  location: (SavedLocation & { gps?: boolean }) | null;
  when?: string;
  locating: boolean;
  onLocation: (l: SavedLocation & { gps?: boolean }) => void;
  onUseGps: () => void;
  onWhen: (when?: string) => void;
}) {
  const [whereOpen, setWhereOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<SavedLocation[]>(loadRecents);
  const [spots, setSpots] = useState<Spots>(loadSpots);
  const [custom, setCustom] = useState(props.when ?? "19:00");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 3) return setSuggestions([]);
    timer.current = window.setTimeout(() => {
      api.dining
        .autocomplete(q.trim(), props.location ?? undefined)
        .then((r) => {
          setSuggestions(r.suggestions);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't search"));
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const choose = (l: SavedLocation) => {
    setRecents(addRecent(l));
    props.onLocation(l);
    setWhereOpen(false);
    setQ("");
  };
  const pick = async (s: LocationSuggestion) => {
    try {
      const loc = await api.dining.locate(s.id);
      choose({ ...loc, label: s.label });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find that place");
    }
  };
  const setSpot = (which: keyof Spots) => {
    if (!props.location) return;
    const next = { ...spots, [which]: { label: which === "home" ? "Home" : "Work", lat: props.location.lat, lng: props.location.lng } };
    setSpots(next);
    saveSpots(next);
  };

  return (
    <div class="loc-bar">
      <button type="button" class="loc-chip" onClick={() => setWhereOpen(true)} aria-label="Change location">
        <IconPin size={16} />
        <span class="loc-label">{props.locating ? "Finding you…" : props.location?.label ?? "Set a location"}</span>
      </button>
      <button type="button" class={`loc-chip when ${props.when ? "set" : ""}`} onClick={() => setWhenOpen(true)} aria-label="Change time">
        <IconClock size={16} />
        <span>{clockText(props.when)}</span>
      </button>

      <Sheet open={whereOpen} title="Where are you eating?" onClose={() => setWhereOpen(false)}>
        <div class="loc-sheet">
          <button type="button" class="btn wide" onClick={() => { props.onUseGps(); setWhereOpen(false); }}>
            <IconLocate size={18} /> Use my current location
          </button>
          <div class="mood">
            <IconSearch size={18} />
            <input
              value={q}
              placeholder="Address, neighborhood or place"
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              aria-label="Search for a location"
              autoComplete="off"
            />
          </div>
          {error && <p class="note">{error}</p>}
          {suggestions.length > 0 && (
            <ul class="loc-list">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => pick(s)}>
                    <strong>{s.label}</strong>
                    {s.secondary && <span>{s.secondary}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(spots.home || spots.work) && (
            <>
              <div class="filter-label">Saved</div>
              <ul class="loc-list">
                {(["home", "work"] as const).map((k) => spots[k] && (
                  <li key={k}>
                    <button type="button" onClick={() => choose(spots[k]!)}>
                      <strong>{spots[k]!.label}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {recents.length > 0 && (
            <>
              <div class="filter-label">Recent</div>
              <ul class="loc-list">
                {recents.map((r) => (
                  <li key={r.label}>
                    <button type="button" onClick={() => choose(r)}>
                      <strong>{r.label}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {props.location && (
            <div class="loc-save">
              <span class="muted">Save “{props.location.label}” as</span>
              <button type="button" class="pill" onClick={() => setSpot("home")}>Home</button>
              <button type="button" class="pill" onClick={() => setSpot("work")}>Work</button>
            </div>
          )}
        </div>
      </Sheet>

      <Sheet open={whenOpen} title="When are you eating?" onClose={() => setWhenOpen(false)}>
        <div class="loc-sheet">
          <div class="chip-wrap">
            {WHEN_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                class={`pill ${props.when === p.value ? "on" : ""}`}
                onClick={() => { props.onWhen(p.value); setWhenOpen(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div class="when-custom">
            <label class="muted" for="when-time">Another time today</label>
            <input id="when-time" type="time" value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} />
            <button type="button" class="btn primary" onClick={() => { if (custom) props.onWhen(custom); setWhenOpen(false); }}>Set</button>
          </div>
          <p class="note">Opening hours are checked for this time.</p>
        </div>
      </Sheet>
    </div>
  );
}
