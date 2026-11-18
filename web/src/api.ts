import type {
  AppConfigResponse,
  ApplyRequest,
  DeckRequest,
  DeckResponse,
  GenerateRequest,
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
export function hasPasscode() {
  return !!passcode;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(passcode ? { "x-app-passcode": passcode } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  week: () => call<WeekResponse>("GET", "/api/week"),
  generate: (req: GenerateRequest) => call<WeekResponse>("POST", "/api/plan/generate", req),
  apply: (req: ApplyRequest) => call<{ created: number; removed: number; skipped: number }>("POST", "/api/plan/apply", req),
};

export { storageGet, storageSet };
