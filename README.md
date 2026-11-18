# Dish Deck

**Swipe through meal ideas, cook with what's on hand, and plan the week in [Mealie](https://mealie.io).**

Dish Deck is a small, mobile-first web app you install on your phone (it's a PWA). It sits in front of your self-hosted Mealie server: everything you save goes straight into Mealie, and Dish Deck keeps no database of its own.

![Dish Deck screens: swipe deck, drag to plan, recipe details, proposed week](docs/screenshots.png)
<sub>Screens from the development mock server, which uses placeholder food images.</sub>

## Features

- **Swipe deck**
  - Drag a card **top-right** to save it to Mealie, **bottom-right** to save it *and* put it on a day's lunch or dinner, **left** to skip. Tap a card for ingredients and steps.
  - **New ideas** come from [TheMealDB](https://www.themealdb.com) (free), or from Claude when you type a craving and add an API key.
  - **Our recipes** deals from the recipes already in your Mealie.
- **"What sounds good?"**: type a mood ("cozy soup", "something with salmon") or pick a cuisine or dish type.
- **Use what's on hand**: only show dishes you can mostly make with the foods marked *on hand* in Mealie, allowing up to *N* missing ingredients. For saved recipes it uses Mealie's own recipe finder.
- **Randomize this week**: fills open lunch and dinner slots for the next 7 days from your saved recipes, then lets you reroll any slot before saving. It's rules-based, so it's free and predictable:
  - dinners that make leftovers become the next day's lunch
  - recently eaten meals are avoided
  - proteins rotate, and proteins you have on hand get a boost
  - busy days get quick dinners
- Light and dark mode, works offline for the app shell, optional household passcode.

## How it fits together

```
 phone (PWA) ──► Dish Deck server ──► Mealie API        (recipes, meal plans, on-hand foods)
                                  ├──► TheMealDB API     (free recipe ideas)
                                  └──► Claude API        (optional AI ideas)
```

The browser only ever talks to the Dish Deck server. Your Mealie token and AI key stay on the server.

## What you need

- A running **Mealie** server, v3.x. The API calls were checked against Mealie v3.31.0.
- Somewhere to run a container: Docker, Docker Compose or Kubernetes. Or Node.js 22+ directly.
- **HTTPS** if you want to install it on phones. Browsers only allow installing web apps over HTTPS; see [Exposing it](#exposing-it-and-keeping-it-safe).

## Keys and secrets

All configuration lives in a single **`.env`** file. Copy [`example.env`](example.env) to `.env` and fill it in. `.env` is git-ignored and excluded from Docker builds, so secrets never end up in the repo or the image.

| Variable | Required? | Secret? | What it's for | Where to get it |
|---|---|---|---|---|
| `MEALIE_URL` | **Yes** | No | How the server reaches Mealie | Your Mealie address, e.g. `http://mealie:9000` |
| `MEALIE_TOKEN` | **Yes** | **Yes** | Read recipes and foods, create recipes and meal plans | Mealie → your profile → **API Tokens** → Create. Recipes and plans are created as this user, in their household. |
| `APP_PASSCODE` | Strongly recommended | **Yes** | Shared passcode each device enters once | Make one up, or run `openssl rand -base64 12` |
| `ANTHROPIC_API_KEY` | Optional | **Yes** | AI recipe ideas when you type a craving | [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys. Pay-as-you-go billing must be set up. |
| `MEALDB_API_KEY` | Optional | Treat as secret if premium | TheMealDB access | Default `1` is the free test key (personal/development use). A premium key comes with supporting TheMealDB: [themealdb.com/api.php](https://www.themealdb.com/api.php) |

Everything else is a plain setting with a sensible default (see [Configuration](#configuration)).

## Quick start (Docker Compose)

```bash
git clone https://github.com/maclogan/dish-deck.git
cd dish-deck
cp example.env .env
# edit .env: set MEALIE_URL, MEALIE_TOKEN, APP_PASSCODE, TZ (and optionally ANTHROPIC_API_KEY)
docker compose up -d
```

Open `http://<your-server>:8080` and enter your passcode.

**If Mealie also runs in Docker Compose,** the containers need a shared network so `MEALIE_URL=http://mealie:9000` resolves. Either add the `dish-deck` service to Mealie's compose file, or attach it to Mealie's network:

```yaml
# docker-compose.override.yml
services:
  dish-deck:
    networks: [mealie]
networks:
  mealie:
    external: true
    name: mealie_default   # check with: docker network ls
```

**Image:** `docker-compose.yml` pulls `ghcr.io/maclogan/dish-deck:latest`, which GitHub Actions publishes for amd64 and arm64. To build from source instead, replace `image:` with `build: .`.

## Other ways to run it

### Plain Docker

```bash
docker run -d --name dish-deck --env-file .env -p 8080:8080 --restart unless-stopped ghcr.io/maclogan/dish-deck:latest
```

### Kubernetes (MicroK8s, k3s, …)

Your `.env` becomes a Secret, and the Deployment loads every variable from it:

```bash
kubectl create namespace dish-deck
kubectl -n dish-deck create secret generic dish-deck-env --from-env-file=.env
kubectl apply -f deploy/kubernetes.yaml
kubectl -n dish-deck get pods -w
```

- In `.env`, use Mealie's in-cluster address, e.g. `MEALIE_URL=http://mealie.mealie.svc.cluster.local:9000` (service `mealie` in namespace `mealie`).
- After editing `.env`, update the Secret and restart:
  ```bash
  kubectl -n dish-deck create secret generic dish-deck-env --from-env-file=.env --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n dish-deck rollout restart deploy/dish-deck
  ```
- **Using a locally built image instead of GHCR** (e.g. MicroK8s with no registry):
  ```bash
  docker build -t dish-deck:local .
  docker save dish-deck:local | microk8s images import      # or: | ssh you@server microk8s images import
  ```
  Then set `image: dish-deck:local` and `imagePullPolicy: Never` in `deploy/kubernetes.yaml`. On an Apple Silicon Mac building for an x86 server, add `--platform linux/amd64`.

### Node.js directly

```bash
npm ci
npm run build
cp example.env .env   # fill it in
npm start             # reads ./.env (or set ENV_FILE=/path/to/file)
```

## Configuration

Every setting is documented in [`example.env`](example.env). Variables set in the real environment override the file.

| Variable | Default | Description |
|---|---|---|
| `MEALIE_URL` | (required) | URL the server uses to reach Mealie |
| `MEALIE_TOKEN` | (required) | Mealie API token |
| `APP_PASSCODE` | (none) | Household passcode. If unset, the app is open to anyone who can reach it. |
| `MEALIE_PUBLIC_URL` | (none) | Public Mealie URL, for "Open in Mealie" links |
| `TZ` | system timezone | IANA timezone that decides what "today" is, e.g. `America/Chicago` |
| `ANTHROPIC_API_KEY` | (none) | Turns on AI ideas |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Claude model for AI ideas |
| `HOUSEHOLD_CONTEXT` | `a busy family` | A few words about who you cook for, used in AI prompts |
| `MEALDB_API_KEY` | `1` | TheMealDB key |
| `BUSY_DAYS` | (none) | Days needing quick dinners, e.g. `tue,thu` |
| `PLAN_START` | `today` | First day of the 7-day plan: `today`, `tomorrow`, `monday`, `sunday` |
| `LEFTOVERS` | `true` | Turn leftover-friendly dinners into next-day lunches |
| `STAPLES` | salt, pepper, water, oils, sugar, flour, butter | Ingredients never counted as missing |
| `PORT` | `8080` | Port to listen on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` |
| `ENV_FILE` | `.env` | Path of the env file to load (Node only) |

If something is missing or invalid, the server refuses to start and lists every problem at once.

## Exposing it and keeping it safe

Dish Deck can write to your Mealie and spend AI credit, so treat it like Mealie itself:

1. **Set `APP_PASSCODE`.**
2. **Serve it over HTTPS.** Phones need HTTPS to install it. Common options:
   - **Cloudflare Tunnel:** add a public hostname, e.g. `dishes.example.com` → `http://<dish-deck address>:8080`. Then add a Cloudflare Access policy limited to your household's emails.
   - **A reverse proxy** you already run (Caddy, Traefik, nginx, Nginx Proxy Manager) with a certificate.
   - **Tailscale:** reach it privately from your phones with `tailscale serve`.
3. **Optionally put a login in front of it** (Cloudflare Access, Authelia, Authentik). The app works behind them unchanged.

## Install on your phone

Open your Dish Deck URL, then:
- **Android (Chrome):** menu → **Install app** (or **Add to Home screen**)
- **iPhone (Safari):** Share → **Add to Home Screen**

## Getting the most out of it

Dish Deck reads what's already in Mealie, so a little tidying there pays off:

- **Mark foods on hand:** Mealie → Data Management → Foods. This powers "Use what's on hand" and the planner's protein boost.
- **Parse ingredients:** recipes saved from Dish Deck arrive with plain-text ingredients. Open one in Mealie and use the ingredient parser to link foods, so Mealie's recipe finder can match it.
- **Categories and tags the planner understands:**
  - Category **Lunch**, or tags `lunch`, `sandwich`, `salad`, `soup`, `wrap`, `bowl`: lunch options. Other recipes count as dinners, unless they're breakfast, dessert, side, snack or drink.
  - `quick`, `weeknight`, `30 min`, or a total time of 30 minutes or less: picked on busy days.
  - `leftovers`, `freezer friendly`, `meal prep`, or 4+ servings: becomes next-day lunch. `no leftovers` opts out.
  - `go-to`, `favorite`: picked more often.
  - `new to try`: added automatically to recipes saved from Dish Deck, and gets a small boost.
  - `not again`: never picked.
  - Star ratings: higher-rated recipes come up more often.

## Costs and limits

- **TheMealDB's free key** covers a limited catalog (a few hundred meals), so new ideas without AI start repeating eventually.
- **AI ideas** cost one Claude API request per deal of cards. Haiku is the cheapest model, and you pay per use on your own key.
- **Planner and saved-recipe features** run entirely against Mealie and cost nothing.

## Development

```bash
npm install
npm run dev:mock          # fake Mealie + TheMealDB on :9100 (no real data touched)
npm run dev:server:mock   # API server on :8080 using dev/mock.env
npm run dev:web           # UI with hot reload on http://localhost:5173
npm test                  # unit + integration tests
npm run typecheck
```

- **Layout:** `server/src` (Fastify + TypeScript), `web/src` (Preact + Vite), `deploy/` (Kubernetes), `dev/` (mock server).
- **Planner logic:** in `server/src/planner.ts`, a pure function with its own tests.

### Releases

GitHub Actions runs the tests on every push. Container images publish to GHCR: every push to `main` updates `:latest` (and `:main`), and version tags publish fixed versions you can pin:

```bash
git tag v0.2.0 && git push origin v0.2.0   # publishes :0.2.0 and :0.2
```

On a private repo, the GHCR package is private too. Make it public in the package settings, or log in with `docker login ghcr.io` before pulling.

## License

[MIT](LICENSE)
