import { useState } from "preact/hooks";
import type { Card } from "../api";
import { IconClock, IconSparkle } from "../icons";

/**
 * Shown only while a photo loads or if it fails to (the server makes sure every card has one): a quiet
 * plate on a soft background rather than a stand-in "picture".
 */
export function Placeholder() {
  return (
    <div class="placeholder" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="32" cy="34" r="17" />
        <circle cx="32" cy="34" r="10" opacity=".5" />
        <path d="M9 14v10a4 4 0 0 0 8 0V14M13 14v34" />
        <path d="M55 14c-4 2-6 7-6 13h6v21" />
      </svg>
    </div>
  );
}

/** Recipe photo, with the plate placeholder while it's missing or if it fails to load. */
export function RecipeImage({ card, lazy = true }: { card: Pick<Card, "image" | "title">; lazy?: boolean }) {
  const [failed, setFailed] = useState<string | undefined>();
  if (!card.image || failed === card.image) return <Placeholder />;
  return (
    <img
      src={card.image}
      alt=""
      loading={lazy ? "lazy" : undefined}
      draggable={false}
      // Some recipe sites refuse images requested from other sites; sending no referrer avoids that.
      referrerpolicy="no-referrer"
      onError={() => setFailed(card.image)}
    />
  );
}

export function OnHandBadge({ card }: { card: Card }) {
  if (!card.onHand || card.onHand.total === 0) return null;
  const n = card.onHand.missing.length;
  return (
    <span class={`chip ${n === 0 ? "chip-good" : "chip-warn"}`}>
      {n === 0 ? "Have everything" : `Need ${n} item${n === 1 ? "" : "s"}`}
    </span>
  );
}

export function CardFace({ card }: { card: Card }) {
  return (
    <div class="card-face">
      <div class="card-image">
        <RecipeImage card={card} />
        {card.source === "ai" && (
          <span class="ai-badge">
            <IconSparkle size={14} /> AI recipe
          </span>
        )}
        {card.source === "web" && card.site && <span class="ai-badge site-badge">{card.site}</span>}
        {card.source === "mealie" && <span class="ai-badge saved-badge">Saved</span>}
      </div>
      <div class="card-text">
        <h3>{card.title}</h3>
        {card.nativeName && <p class="native-name" lang="und">{card.nativeName}</p>}
        <div class="chips">
          {card.cuisine && <span class="chip">{card.cuisine}</span>}
          {card.region && card.region !== card.cuisine && <span class="chip">{card.region}</span>}
          {card.category && card.category !== card.cuisine && <span class="chip">{card.category}</span>}
          {card.totalMinutes ? (
            <span class="chip">
              <IconClock size={13} /> {card.totalMinutes} min
            </span>
          ) : null}
          <OnHandBadge card={card} />
        </div>
        {card.description && <p class="card-desc">{card.description}</p>}
        {!card.description && card.ingredients.length > 0 && (
          <p class="card-desc">
            {card.ingredients
              .slice(0, 5)
              .map((i) => i.replace(/^[\d\s/.½¼¾⅓⅔-]+(cups?|tbsp|tsp|oz|lbs?|g|ml|teaspoons?|tablespoons?)?\s*/i, ""))
              .join(" · ")}
            {card.ingredients.length > 5 ? " …" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
