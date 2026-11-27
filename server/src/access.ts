// Cloudflare Access: who is signed in. When the app sits behind Cloudflare Access, Cloudflare attaches
// a signed token (JWT) to every request in the Cf-Access-Jwt-Assertion header. The token is checked
// against Cloudflare's published keys before its email is trusted; a bare email header could be faked
// by anything that reaches the server without going through Cloudflare.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//
// Nothing needs configuring: AccessTrust learns which Cloudflare team and application to trust from the
// household's own requests (ones that also carry the household passcode), and from then on accepts tokens
// only from that team and application.

import { createPublicKey, verify, type KeyObject } from "node:crypto";

const KEYS_TTL = 3600_000;
const REFETCH_GAP = 60_000;

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Only Cloudflare Access team addresses are ever trusted as token issuers. */
export const isAccessIssuer = (iss: unknown): iss is string => typeof iss === "string" && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(iss);

/** A token's issuer and audience, read WITHOUT checking anything. Only for deciding what to verify against. */
export function peek(token: string | undefined): { iss: string; aud: string } | undefined {
  const body = token?.split(".")[1];
  if (!body) return undefined;
  try {
    const claims = JSON.parse(b64url(body).toString("utf8")) as { iss?: unknown; aud?: unknown };
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    return isAccessIssuer(claims.iss) && typeof aud === "string" && aud ? { iss: claims.iss, aud } : undefined;
  } catch {
    return undefined;
  }
}

export class AccessVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastTry = 0;
  private loading?: Promise<void>;
  readonly issuer: string;

  /** teamDomain: "yourteam.cloudflareaccess.com" or its https:// address. */
  constructor(
    teamDomain: string,
    private audience: string,
    private fetchImpl: typeof fetch = fetch,
    private warn: (msg: string) => void = () => undefined,
  ) {
    this.issuer = `https://${teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  private async load(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && this.keys.size && now - this.fetchedAt < KEYS_TTL) return;
    if (now - this.lastTry < REFETCH_GAP && this.keys.size) return;
    this.loading ??= (async () => {
      this.lastTry = Date.now();
      try {
        const res = await this.fetchImpl(`${this.issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { keys?: Jwk[] };
        const next = new Map<string, KeyObject>();
        for (const k of data.keys ?? []) {
          if (k.kty === "RSA" && k.kid) next.set(k.kid, createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e }, format: "jwk" }));
        }
        if (next.size) {
          this.keys = next;
          this.fetchedAt = Date.now();
        }
      } catch (err) {
        this.warn(`Couldn't fetch Cloudflare Access keys from ${this.issuer}: ${err instanceof Error ? err.message : err}`);
      } finally {
        this.loading = undefined;
      }
    })();
    await this.loading;
  }

  /** The signed-in email (lowercased) if the token is genuine, current and for this app; otherwise undefined. */
  async email(token: string | undefined): Promise<string | undefined> {
    if (!token) return undefined;
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    try {
      header = JSON.parse(b64url(h).toString("utf8"));
      claims = JSON.parse(b64url(p).toString("utf8"));
    } catch {
      return undefined;
    }
    if (header.alg !== "RS256" || !header.kid) return undefined;
    await this.load(false);
    if (!this.keys.has(header.kid)) await this.load(true);
    const key = this.keys.get(header.kid);
    if (!key) return undefined;
    if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, b64url(s))) return undefined;
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.audience)) return undefined;
    if (claims.iss !== this.issuer) return undefined;
    if (typeof claims.exp !== "number" || claims.exp < now - 30) return undefined;
    if (typeof claims.nbf === "number" && claims.nbf > now + 30) return undefined;
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim().toLowerCase() : undefined;
  }
}

/** Settings storage AccessTrust needs (the app's Store). */
export interface SettingsStore {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}

/**
 * Which Cloudflare team and Access application this app trusts, learned from the household's requests.
 * learn() is only called for requests that already proved they're the household (the passcode), so only
 * the household can decide which Cloudflare team's sign-ins count.
 */
export class AccessTrust {
  private verifiers = new Map<string, AccessVerifier>();

  constructor(
    private store: SettingsStore,
    private fetchImpl: typeof fetch = fetch,
    private warn: (msg: string) => void = () => undefined,
  ) {}

  private verifier(iss: string, aud: string): AccessVerifier {
    const key = `${iss} ${aud}`;
    let v = this.verifiers.get(key);
    if (!v) {
      v = new AccessVerifier(iss, aud, this.fetchImpl, this.warn);
      this.verifiers.set(key, v);
    }
    return v;
  }

  /** The team and application currently trusted, if learned. */
  trusted(): { iss: string; aud: string } | undefined {
    const iss = this.store.getSetting("access.issuer");
    const aud = this.store.getSetting("access.aud");
    return iss && aud ? { iss, aud } : undefined;
  }

  /** From a household request: remember the team and application its genuine token came from. */
  async learn(token: string | undefined): Promise<void> {
    const seen = peek(token);
    if (!seen) return;
    const now = this.trusted();
    if (now && now.iss === seen.iss && now.aud === seen.aud) return;
    if (!(await this.verifier(seen.iss, seen.aud).email(token))) return;
    this.store.setSetting("access.issuer", seen.iss);
    this.store.setSetting("access.aud", seen.aud);
  }

  /** The signed-in email, if the token is genuine and from the trusted team and application. */
  async email(token: string | undefined): Promise<string | undefined> {
    const t = this.trusted();
    return t && token ? this.verifier(t.iss, t.aud).email(token) : undefined;
  }
}
