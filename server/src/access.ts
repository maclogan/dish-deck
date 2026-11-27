// Cloudflare Access: who is signed in. When the app sits behind Cloudflare Access, Cloudflare attaches
// a signed token (JWT) to every request in the Cf-Access-Jwt-Assertion header. The token is checked
// against Cloudflare's published keys before its email is trusted; a bare email header could be faked
// by anything that reaches the server without going through Cloudflare.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

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

export class AccessVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastTry = 0;
  private loading?: Promise<void>;
  readonly issuer: string;

  /** teamDomain: "yourteam.cloudflareaccess.com" (a scheme is accepted and ignored). */
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
