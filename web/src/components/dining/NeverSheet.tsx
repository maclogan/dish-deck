import { useEffect, useState } from "preact/hooks";
import { api, type NeverEntry } from "../../api";
import { Sheet } from "../Sheet";

/** The household's never-again list, with a way to bring a place back. */
export function NeverSheet(props: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<NeverEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) return;
    setList(null);
    api.dining
      .never()
      .then((r) => setList(r.places))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the list"));
  }, [props.open]);

  const restore = async (e: NeverEntry) => {
    await api.dining.removeNever(e.id);
    setList((l) => l?.filter((x) => x.id !== e.id) ?? null);
    props.onChanged();
  };

  return (
    <Sheet open={props.open} title="Never show again" onClose={props.onClose}>
      <p class="muted small">Places here never come up in a search, on any of the household's phones.</p>
      {error && <p class="note">{error}</p>}
      {!list && !error && <div class="spinner small" />}
      {list && list.length === 0 && <p class="muted">Nothing here yet.</p>}
      {list && list.length > 0 && (
        <ul class="never-list">
          {list.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{e.name}</strong>
                {e.address && <span class="muted small">{e.address}</span>}
              </div>
              <button type="button" class="btn" onClick={() => restore(e)}>Bring back</button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
