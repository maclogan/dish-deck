import { useEffect, useState } from "preact/hooks";
import { api, type ChatterResponse, type Moment, type PlaceDetails, type PlaceSummary } from "../../api";
import { IconBan, IconDirections, IconExternal, IconGlobe, IconPhone, IconSparkle, IconStar } from "../../icons";
import { Sheet } from "../Sheet";
import { MetaLine, PlacePhoto, StatusChips } from "./PlaceCard";

export function PlaceSheet(props: {
  place: PlaceSummary | null;
  moment: Moment;
  chatterEnabled: boolean;
  shortlisted: boolean;
  onShortlist: (p: PlaceSummary) => void;
  onNever: (p: PlaceSummary) => void;
  onClose: () => void;
}) {
  const { place } = props;
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatter, setChatter] = useState<ChatterResponse | null>(null);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    setDetails(null);
    setChatter(null);
    setError(null);
    setPhoto(0);
    if (!place) return;
    let live = true;
    api.dining
      .place(place.id, props.moment)
      .then((d) => live && setDetails(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load this place"));
    if (props.chatterEnabled) {
      api.dining
        .chatter(place.id, props.moment.ai)
        .then((c) => live && setChatter(c))
        .catch(() => live && setChatter({ enabled: true, items: [] }));
    }
    return () => {
      live = false;
    };
  }, [place?.id, props.moment.ai]);

  const p: PlaceSummary | null = details ?? place;
  const directions = p
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.name)}&destination_place_id=${encodeURIComponent(p.id)}`
    : "";

  return (
    <Sheet open={!!place} title={place?.name} onClose={props.onClose}>
      {p && (
        <div class="detail place-detail">
          <div class="detail-image">
            <PlacePhoto place={{ photo: details?.photos[photo] ?? p.photo }} lazy={false} />
            {details && details.photos.length > 1 && (
              <div class="photo-dots">
                {details.photos.map((_, i) => (
                  <button key={i} type="button" class={i === photo ? "on" : ""} aria-label={`Photo ${i + 1}`} onClick={() => setPhoto(i)} />
                ))}
              </div>
            )}
          </div>
          <MetaLine p={p} />
          {p.address && <p class="muted small">{p.address}</p>}
          {p.hoursToday && <p class="small">Today: {p.hoursToday}</p>}
          <StatusChips p={p} />

          <div class="place-actions">
            <a class="btn" href={p.mapsUrl} target="_blank" rel="noopener noreferrer">
              Google listing <IconExternal size={14} />
            </a>
            {p.website ? (
              <a class="btn" href={p.website} target="_blank" rel="noopener noreferrer">
                <IconGlobe size={16} /> Website
              </a>
            ) : (
              <span class="btn disabled" aria-disabled="true">No website</span>
            )}
            <a class="btn" href={directions} target="_blank" rel="noopener noreferrer">
              <IconDirections size={16} /> Directions
            </a>
            {details?.phone && (
              <a class="btn" href={`tel:${details.phone.replace(/[^\d+]/g, "")}`}>
                <IconPhone size={16} /> Call
              </a>
            )}
          </div>

          {p.why && <p class="place-why">{p.why}</p>}

          {p.tags.length > 0 && (
            <>
              <h4>
                At a glance {p.tagsSource === "ai" && <span class="ai-mark"><IconSparkle size={12} /> AI from reviews</span>}
              </h4>
              <div class="chips tags">
                {p.tags.map((t) => (
                  <span key={t} class="chip">{t}</span>
                ))}
              </div>
            </>
          )}
          {p.reservation.reason && <p class="small muted">Reservations: {p.reservation.reason}</p>}

          <p class="small muted">
            How busy it gets: see Google’s popular times on the{" "}
            <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Google listing</a>.
          </p>

          {error && <p class="note">{error}</p>}
          {!details && !error && (
            <p class="note loading-note">
              <span class="spinner small" /> Loading reviews…
            </p>
          )}

          {details?.aiSummary && (
            <>
              <h4>
                What reviewers say <span class="ai-mark"><IconSparkle size={12} /> AI summary</span>
              </h4>
              <p>{details.aiSummary.overview}</p>
              <div class="pros-cons">
                {details.aiSummary.pros.length > 0 && (
                  <ul class="pros">{details.aiSummary.pros.map((x) => <li key={x}>{x}</li>)}</ul>
                )}
                {details.aiSummary.cons.length > 0 && (
                  <ul class="cons">{details.aiSummary.cons.map((x) => <li key={x}>{x}</li>)}</ul>
                )}
              </div>
            </>
          )}
          {!details?.aiSummary && (details?.googleSummary || details?.editorialSummary) && (
            <p class="muted">{details.googleSummary ?? details.editorialSummary}</p>
          )}

          {props.chatterEnabled && (
            <>
              <h4>What locals say</h4>
              {!chatter ? (
                <p class="note loading-note"><span class="spinner small" /> Looking for local posts…</p>
              ) : chatter.items.length === 0 ? (
                <p class="small muted">No local posts found.</p>
              ) : (
                <>
                  {chatter.summary && (
                    <ul class="local-take">
                      {chatter.summary.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  )}
                  <ul class="chatter">
                    {chatter.items.slice(0, chatter.summary ? 4 : 8).map((c) => (
                      <li key={c.url}>
                        <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title || c.source}</a>
                        <span class="muted"> · {c.source}</span>
                        {!chatter.summary && c.snippet && <p class="small muted">{c.snippet}</p>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {details && details.reviews.length > 0 && (
            <>
              <h4>Google reviews</h4>
              <ul class="reviews">
                {details.reviews.map((r, i) => (
                  <li key={i}>
                    <div class="review-head">
                      {r.authorUrl ? <a href={r.authorUrl} target="_blank" rel="noopener noreferrer">{r.author}</a> : <strong>{r.author}</strong>}
                      {r.rating ? <span class="rating">{"★".repeat(Math.round(r.rating))}</span> : null}
                      <span class="muted small">{r.when}</span>
                    </div>
                    <p class="small">{r.text}</p>
                  </li>
                ))}
              </ul>
              <p class="small muted">
                Reviews from Google. <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">See all on Google Maps</a>
              </p>
            </>
          )}

          <div class="detail-actions">
            <button type="button" class={`btn ${props.shortlisted ? "amber" : ""}`} onClick={() => props.onShortlist(p)}>
              <IconStar size={18} filled={props.shortlisted} /> {props.shortlisted ? "Shortlisted" : "Shortlist"}
            </button>
            <button type="button" class="btn ghost danger" onClick={() => props.onNever(p)}>
              <IconBan size={18} /> Never again
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
