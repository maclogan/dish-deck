import type {
  AppConfigResponse,
  ApplyRequest,
  BookResponse,
  ChatterResponse,
  DeckRequest,
  DiningSearchRequest,
  DiningSearchResponse,
  EnrichResponse,
  LatLng,
  LocationSuggestion,
  NeverEntry,
  PlaceDetails,
  DeckResponse,
  GenerateRequest,
  HistoryRequest,
  SaveRequest,
  SaveResponse,
  WeekResponse,
} from "../../server/src/types";

export type * from "../../server/src/types";

const PASSCODE_KEY = "dishdeck.passcode";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: keep it in memory only */
  }
}

let passcode = storageGet(PASSCODE_KEY) ?? "";

export function setPasscode(value: string) {
  passcode = value;
  storageSet(PASSCODE_KEY, value || null);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The server answers new-ideas decks within 55 s; give up a little after that instead of spinning. */
const REQUEST_TIMEOUT_MS = 70_000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(passcode ? { "x-app-passcode": passcode } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    if (abort.signal.aborted) throw new Error("That took too long. Check your connection and try again.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  config: () => call<AppConfigResponse>("GET", "/api/config"),
  deck: (req: DeckRequest) => call<DeckResponse>("POST", "/api/deck", req),
  save: (req: SaveRequest) => call<SaveResponse>("POST", "/api/save", req),
  history: (req: HistoryRequest) => call<{ ok: boolean }>("POST", "/api/history", req),
  recipes: () => call<BookResponse>("GET", "/api/recipes"),
  week: () => call<WeekResponse>("GET", "/api/week"),
  generate: (req: GenerateRequest) => call<WeekResponse>("POST", "/api/plan/generate", req),
  apply: (req: ApplyRequest) => call<{ created: number; removed: number; skipped: number }>("POST", "/api/plan/apply", req),
  dining: {
    search: (req: DiningSearchRequest) => call<DiningSearchResponse>("POST", "/api/dining/search", req),
    enrich: (ids: string[], m: Moment) => call<EnrichResponse>("POST", "/api/dining/enrich", { ids, ...m }),
    place: (id: string, m: Moment) => call<PlaceDetails>("POST", `/api/dining/place/${encodeURIComponent(id)}`, m),
    chatter: (id: string, ai: boolean) => call<ChatterResponse>("GET", `/api/dining/place/${encodeURIComponent(id)}/chatter?ai=${ai}`),
    never: () => call<{ places: NeverEntry[] }>("GET", "/api/dining/never"),
    addNever: (id: string, name: string, address?: string) => call<{ ok: boolean }>("POST", "/api/dining/never", { id, name, address }),
    removeNever: (id: string) => call<{ ok: boolean }>("DELETE", `/api/dining/never/${encodeURIComponent(id)}`),
    autocomplete: (q: string, near?: LatLng) =>
      call<{ suggestions: LocationSuggestion[] }>(
        "GET",
        `/api/dining/autocomplete?${new URLSearchParams({ q, ...(near ? { lat: String(near.lat), lng: String(near.lng) } : {}) })}`,
      ),
    locate: (id: string) => call<{ label: string } & LatLng>("GET", `/api/dining/locate/${encodeURIComponent(id)}`),
  },
};

/** Where and when a place is being looked at (distance, hours, busyness), and the AI switch. */
export interface Moment {
  location: LatLng;
  when?: string;
  ai: boolean;
}

export { storageGet, storageSet };
