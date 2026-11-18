import type { Card } from "../api";
import { IconClock, IconSparkle } from "../icons";

const GRADIENTS = [
  ["#E4572E", "#F2A65A"],
  ["#5E8C61", "#A3C4A0"],
  ["#3D5A80", "#98C1D9"],
  ["#8E5572", "#D7A9C3"],
  ["#B5651D", "#E8A33D"],
  ["#2A9D8F", "#8AD1C2"],
];

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function Placeholder({ title }: { title: string }) {
  const [a, b] = GRADIENTS[hash(title) % GRADIENTS.length]!;
  return (
    <div class="placeholder" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      <span>{title.trim().charAt(0).toUpperCase()}</span>
    </div>
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
        {card.image ? <img src={card.image} alt="" loading="lazy" draggable={false} /> : <Placeholder title={card.title} />}
        {card.source === "ai" && (
          <span class="ai-badge">
            <IconSparkle size={14} /> AI idea
          </span>
        )}
        {card.source === "mealie" && <span class="ai-badge saved-badge">Saved</span>}
      </div>
      <div class="card-text">
        <h3>{card.title}</h3>
        <div class="chips">
          {card.cuisine && <span class="chip">{card.cuisine}</span>}
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
