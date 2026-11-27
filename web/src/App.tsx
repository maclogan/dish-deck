import { useEffect, useState } from "preact/hooks";
import { ApiError, api, setPasscode, storageGet, storageSet, type AppConfigResponse, type PlanDay } from "./api";
import { Discover } from "./components/Discover";
import { EatOut } from "./components/dining/EatOut";
import { Week } from "./components/Week";
import { IconCalendar, IconExternal, IconFork, IconLock, IconSparkle } from "./icons";
import { todayIso } from "./text";

interface Toast {
  id: number;
  message: string;
  link?: string;
  error?: boolean;
}

export function App() {
  const [config, setConfig] = useState<AppConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [needPasscode, setNeedPasscode] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState<string | null>(null);
  const [tab, setTab] = useState<"discover" | "week" | "eat">(() => (storageGet("dishdeck.tab") === "eat" ? "eat" : "discover"));
  /** Discover is showing the "Our recipes" grid, which gets a wider page. */
  const [bookOpen, setBookOpen] = useState(false);
  const [days, setDays] = useState<PlanDay[] | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const today = todayIso();
  const [aiOn, setAiOn] = useState(() => storageGet("dishdeck.ai") !== "off");
  const toggleAi = () => {
    const next = !aiOn;
    setAiOn(next);
    storageSet("dishdeck.ai", next ? "on" : "off");
  };

  const pickTab = (t: "discover" | "week" | "eat") => {
    setTab(t);
    storageSet("dishdeck.tab", t);
  };

  const notify = (message: string, link?: string, error?: boolean) => {
    const id = Date.now();
    setToast({ id, message, link, error });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), error ? 6000 : 4000);
  };

  const refreshWeek = () => {
    api
      .week()
      .then((w) => setDays(w.days))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedPasscode(true);
        else notify(e instanceof Error ? e.message : "Couldn't load this week", undefined, true);
      });
  };

  /** Ask the server who we are (Cloudflare sign-in or the saved passcode) and show the right app. */
  const loadConfig = () =>
    api.config().then((c) => {
      setConfig(c);
      setNeedPasscode(c.role === "none" && c.passcodeRequired);
      if (c.role === "household") refreshWeek();
      return c;
    });

  useEffect(() => {
    loadConfig().catch((e) => setConfigError(e instanceof Error ? e.message : "Can't reach the server"));
  }, []);

  const submitPass = (e: Event) => {
    e.preventDefault();
    setPasscode(passInput.trim());
    loadConfig()
      .then((c) => {
        if (c.role === "household") return setPassError(null);
        // Wrong code. (A guest stays signed in as a guest underneath, so keep the form open to say so.)
        setPasscode("");
        setNeedPasscode(true);
        setPassError("That passcode didn't work.");
      })
      .catch((err) => setPassError(err instanceof Error ? err.message : "Can't reach the server"));
  };

  if (configError) {
    return (
      <div class="center">
        <p>{configError}</p>
        <button class="btn" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }
  if (!config) return <div class="center"><div class="spinner" /></div>;

  if (needPasscode) {
    return (
      <form class="center passcode" onSubmit={submitPass}>
        <IconLock size={32} />
        <h1>Dish Deck</h1>
        <p class="muted">Enter the household passcode.</p>
        {passError && <p class="pass-error" role="alert">{passError}</p>}
        <input
          type="password"
          autoComplete="current-password"
          value={passInput}
          onInput={(e) => setPassInput((e.target as HTMLInputElement).value)}
          aria-label="Passcode"
        />
        <button class="btn primary" type="submit">Unlock</button>
        {config.role === "guest" && (
          <button type="button" class="btn ghost" onClick={() => { setNeedPasscode(false); setPassError(null); }}>
            Back
          </button>
        )}
      </form>
    );
  }

  // Guests (signed in through Cloudflare with an email outside the household) get the Eat out tab only.
  const guest = config.role === "guest";
  if (guest && !config.dining?.enabled) {
    return (
      <div class="center">
        <h1>Dish Deck</h1>
        <p class="muted">There's nothing here for guests yet.</p>
      </div>
    );
  }
  const shown = guest ? "eat" : tab;

  return (
    <div class="app">
      <header class={`topbar ${shown === "discover" && bookOpen ? "wide" : ""}`}>
        <div class="topbar-title">
          <h1>Dish Deck</h1>
          {guest && (
            <span class="signed-in">
              Guest · {config.email} ·{" "}
              <button type="button" class="link-btn" onClick={() => setNeedPasscode(true)}>Household? Enter passcode</button>
            </span>
          )}
        </div>
        <div class="topbar-actions">
          {config.aiEnabled && (
            <button
              type="button"
              class={`ai-on ${aiOn ? "" : "off"}`}
              aria-pressed={aiOn}
              title={
                shown === "eat"
                  ? aiOn
                    ? "AI is on: Claude reads searches and reviews for tags, size and reservation advice. Tap to turn off."
                    : "AI is off: plain Google search and Google's own details. Tap to turn on."
                  : aiOn
                    ? "AI is on: Claude picks dishes and understands moods. Tap to turn off."
                    : "AI is off: free recipes from your trusted sites. Tap to turn on."
              }
              onClick={toggleAi}
            >
              <IconSparkle size={14} /> AI
            </button>
          )}
          {config.mealieUrl && (
            <a class="mealie-link" href={config.mealieUrl} target="_blank" rel="noopener noreferrer" title="Open Mealie">
              Mealie <IconExternal size={14} />
            </a>
          )}
        </div>
      </header>

      <main class={`${shown === "discover" && bookOpen ? "wide" : ""} ${guest ? "no-tabbar" : ""}`}>
        {shown === "discover" ? (
          <Discover
            config={config}
            aiOn={config.aiEnabled && aiOn}
            days={days}
            today={today}
            refreshWeek={refreshWeek}
            notify={notify}
            onWide={setBookOpen}
          />
        ) : shown === "eat" && config.dining?.enabled ? (
          <EatOut config={config} aiOn={config.aiEnabled && aiOn} notify={notify} />
        ) : (
          <Week days={days} today={today} refreshWeek={refreshWeek} notify={notify} />
        )}
      </main>

      {!guest && <nav class="tabbar">
        <button class={tab === "discover" ? "on" : ""} onClick={() => pickTab("discover")}>
          <IconSparkle size={22} />
          <span>Discover</span>
        </button>
        <button class={tab === "week" ? "on" : ""} onClick={() => { pickTab("week"); refreshWeek(); }}>
          <IconCalendar size={22} />
          <span>This week</span>
        </button>
        {config.dining?.enabled && (
          <button class={tab === "eat" ? "on" : ""} onClick={() => pickTab("eat")}>
            <IconFork size={22} />
            <span>Eat out</span>
          </button>
        )}
      </nav>}

      {toast && (
        <div class={`toast ${toast.error ? "error" : ""}`} role="status">
          <span>{toast.message}</span>
          {toast.link && (
            <a href={toast.link} target="_blank" rel="noreferrer">
              Open <IconExternal size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
