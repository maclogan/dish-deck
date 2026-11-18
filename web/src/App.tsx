import { useEffect, useState } from "preact/hooks";
import { ApiError, api, hasPasscode, setPasscode, storageGet, storageSet, type AppConfigResponse, type PlanDay } from "./api";
import { Discover } from "./components/Discover";
import { Week } from "./components/Week";
import { IconCalendar, IconExternal, IconLock, IconSparkle } from "./icons";
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
  const [tab, setTab] = useState<"discover" | "week">("discover");
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

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        if (c.passcodeRequired && !hasPasscode()) setNeedPasscode(true);
        else refreshWeek();
      })
      .catch((e) => setConfigError(e instanceof Error ? e.message : "Can't reach the server"));
  }, []);

  const submitPass = (e: Event) => {
    e.preventDefault();
    setPasscode(passInput.trim());
    setNeedPasscode(false);
    refreshWeek();
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
        <input
          type="password"
          autoComplete="current-password"
          value={passInput}
          onInput={(e) => setPassInput((e.target as HTMLInputElement).value)}
          aria-label="Passcode"
        />
        <button class="btn primary" type="submit">Unlock</button>
      </form>
    );
  }

  return (
    <div class="app">
      <header class={`topbar ${tab === "discover" && bookOpen ? "wide" : ""}`}>
        <h1>Dish Deck</h1>
        <div class="topbar-actions">
          {config.aiEnabled && (
            <button
              type="button"
              class={`ai-on ${aiOn ? "" : "off"}`}
              aria-pressed={aiOn}
              title={aiOn ? "AI ideas are on (searches use Claude). Tap to turn off." : "AI ideas are off (searches use TheMealDB). Tap to turn on."}
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

      <main class={tab === "discover" && bookOpen ? "wide" : ""}>
        {tab === "discover" ? (
          <Discover
            config={config}
            aiOn={config.aiEnabled && aiOn}
            days={days}
            today={today}
            refreshWeek={refreshWeek}
            notify={notify}
            onWide={setBookOpen}
          />
        ) : (
          <Week days={days} today={today} refreshWeek={refreshWeek} notify={notify} />
        )}
      </main>

      <nav class="tabbar">
        <button class={tab === "discover" ? "on" : ""} onClick={() => setTab("discover")}>
          <IconSparkle size={22} />
          <span>Discover</span>
        </button>
        <button class={tab === "week" ? "on" : ""} onClick={() => { setTab("week"); refreshWeek(); }}>
          <IconCalendar size={22} />
          <span>This week</span>
        </button>
      </nav>

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
