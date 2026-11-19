import type { Card } from "../api";
import { canonicalWords } from "../text";
import { IconBook, IconCalendar, IconExternal, IconX } from "../icons";
import { OnHandBadge, RecipeImage } from "./CardFace";
import { Sheet } from "./Sheet";
import type { Action } from "./Deck";

export function DetailSheet(props: {
  card: Card | null;
  onClose: () => void;
  onAction: (card: Card, action: Action) => void;
  /** Browsing the recipe book: there's nothing to skip, so hide that button. */
  hideSkip?: boolean;
}) {
  const { card } = props;
  const missing = new Set((card?.onHand?.missing ?? []).map(canonicalWords));
  const isMissing = (line: string) => [...missing].some((m) => m && canonicalWords(line).includes(m));

  return (
    <Sheet open={!!card} title={card?.title} onClose={props.onClose}>
      {card && (
        <div class="detail">
          <div class="detail-image">
            <RecipeImage card={card} lazy={false} />
            {card.imageCredit && (
              <a class="photo-credit" href={card.imageCredit.url} target="_blank" rel="noreferrer">
                {card.imageCredit.text}
              </a>
            )}
          </div>
          {card.nativeName && <p class="native-name" lang="und">{card.nativeName}</p>}
          <div class="chips">
            {card.cuisine && <span class="chip">{card.cuisine}</span>}
            {card.region && card.region !== card.cuisine && <span class="chip">{card.region}</span>}
            {card.category && <span class="chip">{card.category}</span>}
            {card.totalMinutes ? <span class="chip">{card.totalMinutes} min</span> : null}
            {card.servings ? <span class="chip">Serves {card.servings}</span> : null}
            <OnHandBadge card={card} />
          </div>
          {card.description && <p>{card.description}</p>}
          {card.nutrition && (
            <p class="nutrition">
              {[
                card.nutrition.calories !== undefined && `${card.nutrition.calories} kcal`,
                card.nutrition.protein !== undefined && `${card.nutrition.protein}g protein`,
                card.nutrition.carbs !== undefined && `${card.nutrition.carbs}g carbs`,
                card.nutrition.fat !== undefined && `${card.nutrition.fat}g fat`,
                card.nutrition.fiber !== undefined && `${card.nutrition.fiber}g fiber`,
              ]
                .filter(Boolean)
                .join(" · ")}
              <span> per serving{card.source === "ai" ? " (estimated)" : ""}</span>
            </p>
          )}

          <h4>Ingredients</h4>
          <ul class="ingredients">
            {card.ingredients.map((i) => (
              <li class={isMissing(i) ? "missing" : ""}>{i}</li>
            ))}
          </ul>
          {card.onHand && card.onHand.missing.length > 0 && (
            <p class="tiny">Highlighted items aren't marked on hand in Mealie.</p>
          )}

          <h4>Steps</h4>
          <ol class="steps">
            {card.instructions.map((s) => (
              <li>{s}</li>
            ))}
          </ol>

          {(card.mealie?.url || card.sourceUrl) && (
            <a class="link" href={card.mealie?.url ?? card.sourceUrl} target="_blank" rel="noreferrer">
              {card.mealie?.url ? "Open in Mealie" : card.site ? `View on ${card.site}` : "Original recipe"} <IconExternal size={14} />
            </a>
          )}

          <div class="detail-actions">
            {!props.hideSkip && (
              <button class="btn ghost" onClick={() => props.onAction(card, "skip")}>
                <IconX size={18} /> Skip
              </button>
            )}
            {card.source !== "mealie" && (
              <button class="btn sage" onClick={() => props.onAction(card, "book")}>
                <IconBook size={18} /> Save
              </button>
            )}
            <button class="btn amber" onClick={() => props.onAction(card, "plan")}>
              <IconCalendar size={18} /> This week
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
