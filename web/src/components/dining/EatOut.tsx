import { useEffect, useRef, useState } from "preact/hooks";
import { api, storageGet, storageSet, type AppConfigResponse, type DiningFilters, type DiningSort, type Moment, type PlaceSummary } from "../../api";
import { IconBan, IconCards, IconList, IconMap, IconRefresh, IconSearch, IconSliders, IconSparkle, IconStar } from "../../icons";
import { Compare } from "./Compare";
import { DiningDeck } from "./DiningDeck";
import { FilterSheet, SORTS } from "./FilterSheet";
import { LocationBar, currentPosition } from "./LocationBar";
import { MapView } from "./MapView";
import { NeverSheet } from "./NeverSheet";
import { PlaceCard, type PlaceActions } from "./PlaceCard";
import { PlaceSheet } from "./PlaceSheet";
import {
  countFilters, loadDisplay, loadFilters, loadLocation, loadSort, loadToday, saveDisplay, saveFilters, saveLocation, saveSort, saveToday,
  type Display, type SavedLocation, type Today,
} from "./state";

interface Undo {
  id: number;
  message: string;
  run: () => void;
}

export function EatOut(props: { config: AppConfigResponse; aiOn: boolean; notify: (m: string, link?: string, error?: boolean) => void }) {
  const dc = props.config.dining;
  const [location, setLocation] = useState<(SavedLocation & { gps?: boolean }) | null>(loadLocation);
  const [locating, setLocating] = useState(false);
  const [when, setWhen] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filters, setFilters] = useState<DiningFilters>(loadFilters);
  const [sort, setSort] = useState<DiningSort>(loadSort);
  const [radius, setRadius] = useState(() => Number(storageGet("dishdeck.dining.radius")) || dc.radiusMiles);
  const [display, setDisplay] = useState<Display>(() => {
    const d = loadDisplay();
    return d === "map" && !dc.mapsBrowserKey ? "list" : d;
  });
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setTodayState] = useState<Today>(loadToday);
  const [open, setOpen] = useState<PlaceSummary | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [neverOpen, setNeverOpen] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  const moment: Moment = { location: location ?? { lat: 0, lng: 0 }, when, ai: props.aiOn };

  const setToday = (fn: (t: Today) => Today) =>
    setTodayState((t) => {
      // A new day starts a fresh shortlist.
      const base = t.date === loadToday().date ? t : loadToday();
      const next = fn(base);
      saveToday(next);
      return next;
    });

  const showUndo = (message: string, run: () => void) => {
    const id = Date.now();
    setUndo({ id, message, run });
    window.setTimeout(() => setUndo((u) => (u?.id === id ? null : u)), 6000);
  };

  // ---- location
  const useGps = (quiet = false) => {
    setLocating(true);
    currentPosition()
      .then((ll) => {
        const l = { label: "Current location", ...ll, gps: true };
        setLocation(l);
        saveLocation(l);
      })
      .catch(async (err: Error) => {
        if (quiet && location) return;
        const d = await api.dining.defaultLocation().catch(() => ({ location: null }));
        if (d.location && !location) {
          setLocation(d.location);
          props.notify(`${err.message}: showing places near ${d.location.label}`);
        } else if (!location) setError(`${err.message}. Set a location above.`);
        else if (!quiet) props.notify(err.message, undefined, true);
      })
      .finally(() => setLocating(false));
  };
  useEffect(() => {
    // Refresh a GPS location each time the tab opens; keep a chosen address as it is.
    if (!location || location.gps) useGps(!!location);
  }, []);

  // ---- search
  useEffect(() => {
    if (!location) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    api.dining
      .search({ location: { lat: location.lat, lng: location.lng }, radiusMiles: radius, when, query: submitted || undefined, filters, sort, ai: props.aiOn })
      .then(async (r) => {
        if (my !== seq.current) return;
        setPlaces(r.places);
        setNote(r.note);
        setLoading(false);
        if (!r.aiUsed) return;
        // AI reads each place's reviews for tags, size and reservation advice, ten at a time.
        const todo = r.places.filter((p) => p.tagsSource === "google").map((p) => p.id);
        for (let i = 0; i < todo.length && my === seq.current; i += 10) {
          const res = await api.dining.enrich(todo.slice(i, i + 10), { ...moment, location: { lat: location.lat, lng: location.lng } }).catch(() => undefined);
          if (!res || my !== seq.current) return;
          setPlaces((list) => list.map((p) => (res.places[p.id] ? { ...p, ...res.places[p.id] } : p)));
        }
      })
      .catch((e) => {
        if (my !== seq.current) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : "Search failed");
      });
  }, [location?.lat, location?.lng, when, submitted, filters, sort, radius, props.aiOn, nonce]);

  // ---- actions
  const isShortlisted = (id: string) => today.shortlist.some((p) => p.id === id);
  const actions: PlaceActions = {
    onOpen: setOpen,
    isShortlisted,
    onShortlist: (p) =>
      setToday((t) => ({
        ...t,
        shortlist: t.shortlist.some((x) => x.id === p.id) ? t.shortlist.filter((x) => x.id !== p.id) : [...t.shortlist, p].slice(-6),
      })),
    onHide: (p) => {
      setToday((t) => ({ ...t, hidden: [...new Set([...t.hidden, p.id])] }));
      showUndo(`${p.name} hidden for today`, () => setToday((t) => ({ ...t, hidden: t.hidden.filter((h) => h !== p.id) })));
    },
    onNever: (p) => {
      api.dining
        .addNever(p.id, p.name, p.address)
        .then(() => {
          setPlaces((list) => list.filter((x) => x.id !== p.id));
          setToday((t) => ({ ...t, shortlist: t.shortlist.filter((x) => x.id !== p.id) }));
          setOpen((o) => (o?.id === p.id ? null : o));
          showUndo(`${p.name} won't be suggested again`, () => {
            api.dining.removeNever(p.id).then(() => setNonce((n) => n + 1)).catch(() => undefined);
          });
        })
        .catch((e) => props.notify(e instanceof Error ? e.message : "Couldn't save that", undefined, true));
    },
  };

  const visible = places.filter((p) => !today.hidden.includes(p.id));
  const filterCount = countFilters(filters) + (sort !== "best" ? 1 : 0);
  const pickDisplay = (d: Display) => {
    setDisplay(d);
    saveDisplay(d);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const q = query.trim();
    if (q === submitted) setNonce((n) => n + 1);
    else setSubmitted(q);
  };

  return (
    <div class="eat-out">
      <LocationBar
        location={location}
        when={when}
        locating={locating}
        onLocation={(l) => {
          setLocation(l);
          saveLocation(l);
        }}
        onUseGps={() => useGps(false)}
        onWhen={setWhen}
      />

      <form class="mood" onSubmit={submit}>
        <IconSearch size={18} />
        <input
          value={query}
          placeholder={props.aiOn ? "cozy hole-in-the-wall, date night…" : "tacos, ramen, pizza…"}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          aria-label="What are you in the mood for?"
          enterKeyHint="search"
        />
        <button type="submit" class={`go ${props.aiOn ? "ai" : ""}`} aria-label="Search">
          {props.aiOn ? <IconSparkle size={18} /> : <IconRefresh size={18} />}
        </button>
        <button type="button" class={`filters-btn ${filterCount ? "on" : ""}`} aria-label="Filters" onClick={() => setShowFilters(true)}>
          <IconSliders size={18} />
          {filterCount > 0 && <span class="count">{filterCount}</span>}
        </button>
      </form>

      <div class="eat-bar">
        <div class="view-toggle" role="radiogroup" aria-label="Display">
          {([
            ["list", "List", IconList],
            ["deck", "Deck", IconCards],
            ...(dc.mapsBrowserKey ? [["map", "Map", IconMap] as const] : []),
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={display === id} class={display === id ? "on" : ""} onClick={() => pickDisplay(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {display === "deck" && today.shortlist.length > 0 && (
          <button type="button" class="shortlist-bar inline" onClick={() => setCompareOpen(true)}>
            <IconStar size={14} filled /> {today.shortlist.length} · Compare
          </button>
        )}
        <span class="eat-count">
          {loading ? "Searching…" : `${visible.length} place${visible.length === 1 ? "" : "s"}`} · {SORTS.find((s) => s.id === sort)?.label}
        </span>
      </div>
      {submitted && (
        <p class="note">
          {note ?? `Results for “${submitted}”`}{" "}
          <button type="button" class="filter-clear inline" onClick={() => { setQuery(""); setSubmitted(""); }}>Clear search</button>
        </p>
      )}

      {error && (
        <div class="empty">
          <p>{error}</p>
          {location && <button class="btn" onClick={() => setNonce((n) => n + 1)}>Try again</button>}
        </div>
      )}

      {!error && loading && places.length === 0 && (
        <div class="empty">
          <div class="spinner" />
          <p>{locating ? "Finding you…" : "Looking for places to eat…"}</p>
        </div>
      )}

      {!error && !location && !locating && !loading && (
        <div class="empty">
          <p>Set a location to find places nearby.</p>
        </div>
      )}

      {!error && location && places.length > 0 && (
        <div class={`results ${loading ? "refreshing" : ""}`} aria-busy={loading}>
          {visible.length === 0 ? (
            <div class="empty">
              <p>You've hidden everything in this search for today.</p>
              <button class="btn" onClick={() => setToday((t) => ({ ...t, hidden: [] }))}>Show them again</button>
            </div>
          ) : display === "deck" ? (
            <DiningDeck places={visible} units={dc.units} actions={actions} />
          ) : display === "map" && dc.mapsBrowserKey ? (
            <MapView apiKey={dc.mapsBrowserKey} center={location} places={visible} units={dc.units} actions={actions} />
          ) : (
            <div class="place-list">
              {visible.map((p) => (
                <PlaceCard key={p.id} p={p} units={dc.units} actions={actions} />
              ))}
              <p class="hint">Swipe a place left to hide it for today.</p>
            </div>
          )}
        </div>
      )}

      {!error && location && !loading && places.length === 0 && (
        <div class="empty">
          <p>Nothing matches. Try a wider distance or fewer filters.</p>
        </div>
      )}

      <div class="eat-footer">
        <button type="button" class="filter-clear inline" onClick={() => setNeverOpen(true)}>
          <IconBan size={14} /> Never-again list
        </button>
        {today.hidden.length > 0 && (
          <button type="button" class="filter-clear inline" onClick={() => setToday((t) => ({ ...t, hidden: [] }))}>
            Unhide {today.hidden.length} for today
          </button>
        )}
      </div>

      {display !== "deck" && today.shortlist.length > 0 && (
        <button type="button" class="shortlist-bar" onClick={() => setCompareOpen(true)}>
          <IconStar size={18} filled /> Shortlist ({today.shortlist.length}) · Compare
        </button>
      )}

      <FilterSheet
        open={showFilters}
        filters={filters}
        sort={sort}
        radius={radius}
        units={dc.units}
        cuisines={dc.cuisines}
        aiOn={props.aiOn}
        onClose={() => setShowFilters(false)}
        onApply={(f, s, r) => {
          setFilters(f);
          saveFilters(f);
          setSort(s);
          saveSort(s);
          setRadius(r);
          storageSet("dishdeck.dining.radius", String(r));
          setShowFilters(false);
        }}
      />
      <PlaceSheet
        place={open}
        moment={moment}
        units={dc.units}
        chatterEnabled={dc.chatter}
        shortlisted={!!open && isShortlisted(open.id)}
        onShortlist={actions.onShortlist}
        onNever={actions.onNever}
        onClose={() => setOpen(null)}
      />
      <Compare
        open={compareOpen}
        places={today.shortlist}
        units={dc.units}
        onOpen={(p) => { setCompareOpen(false); setOpen(p); }}
        onRemove={actions.onShortlist}
        onClose={() => setCompareOpen(false)}
      />
      <NeverSheet open={neverOpen} onClose={() => setNeverOpen(false)} onChanged={() => setNonce((n) => n + 1)} />

      {undo && (
        <div class="toast" role="status">
          <span>{undo.message}</span>
          <button type="button" class="toast-btn" onClick={() => { undo.run(); setUndo(null); }}>Undo</button>
        </div>
      )}
    </div>
  );
}
