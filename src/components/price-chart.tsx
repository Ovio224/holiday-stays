"use client";

// PriceChart — the per-accommodation price comparison. Each member records the
// real price THEY see (Genius level, loyalty, coupons…); this renders them as a
// compact sorted bar list in each member's color, cheapest-first, with the
// cheapest highlighted and a clear "X has the best price → X books" callout so
// the group instantly knows who should do the booking.
//
// The current member can enter/update/clear their own price inline. Saves are
// optimistic (the entered value shows immediately) and reconcile via the same
// realtime subscription that streams votes — so everyone's bars update live.

import * as React from "react";
import { Pencil, Tag, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import { setPrice } from "@/actions/prices";
import { formatMoney, nightlyTotal, parsePriceAmount } from "@/lib/format";
import { priceComparison, type MemberPriceEntry } from "@/lib/prices";
import type { AccommodationPrice, Member } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PriceChartProps {
  accommodationId: string;
  members: Member[];
  prices: AccommodationPrice[];
  currentMemberId: string | null;
  /** Parsed standard price per night, shown as a faint reference. */
  referenceAmount: number | null;
  currency: string | null;
  /** Nights in this leg — used to show the cheapest pick's leg total. */
  stayNights: number | null;
}

/** Optimistic edit applied to my own price while a save is in flight. */
type PriceEdit =
  | { type: "set"; amount: number }
  | { type: "clear" };

/** A synthetic id for an optimistic, not-yet-persisted price row of my own. */
const OPTIMISTIC_ID = "optimistic-self";

/** Apply my in-flight edit on top of the realtime prices, keyed by member. */
function applyEdit(
  prices: AccommodationPrice[],
  edit: PriceEdit,
  accommodationId: string,
  memberId: string,
): AccommodationPrice[] {
  if (edit.type === "clear") {
    return prices.filter((p) => p.member_id !== memberId);
  }
  const existing = prices.find((p) => p.member_id === memberId);
  const row: AccommodationPrice = {
    id: existing?.id ?? OPTIMISTIC_ID,
    accommodation_id: accommodationId,
    member_id: memberId,
    amount: edit.amount,
    currency: existing?.currency ?? null,
    note: existing?.note ?? null,
    updated_at: existing?.updated_at ?? "",
  };
  return existing
    ? prices.map((p) => (p.member_id === memberId ? row : p))
    : [...prices, row];
}

/** "Ana", "Ana & Bob", or "Ana, Bob & Cara". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function PriceChart({
  accommodationId,
  members,
  prices,
  currentMemberId,
  referenceAmount,
  currency,
  stayNights,
}: PriceChartProps) {
  const [isPending, startTransition] = React.useTransition();

  // Optimistic layer: realtime `prices` is the base truth; my pending edit shows
  // on top until the action settles and realtime echoes the new base.
  const [optimisticPrices, applyOptimistic] = React.useOptimistic(
    prices,
    (state, edit: PriceEdit) =>
      currentMemberId
        ? applyEdit(state, edit, accommodationId, currentMemberId)
        : state,
  );

  const comparison = React.useMemo(
    () => priceComparison(optimisticPrices, members),
    [optimisticPrices, members],
  );

  // My own current price (optimistic), for seeding/labelling the editor.
  const mine = currentMemberId
    ? (optimisticPrices.find((p) => p.member_id === currentMemberId) ?? null)
    : null;

  // The input is a plain string so members can type freely; seeded from my price.
  const [draft, setDraft] = React.useState(() =>
    mine ? String(mine.amount) : "",
  );
  // Show the editor field when I'm adding/changing; collapsed to a chip otherwise.
  const [editing, setEditing] = React.useState(false);

  // Keep an open editor honest: if realtime moves my own price (e.g. I set it on
  // another device) while I'm editing, follow it — but only when I haven't typed
  // over the field, so an in-progress edit is never clobbered. `syncedRef` tracks
  // the last price value the field was in step with.
  const mineValue = mine ? String(mine.amount) : "";
  const syncedRef = React.useRef(mineValue);
  React.useEffect(() => {
    if (editing && draft === syncedRef.current && mineValue !== syncedRef.current) {
      setDraft(mineValue);
    }
    syncedRef.current = mineValue;
  }, [mineValue, editing, draft]);

  function handleSave() {
    if (!currentMemberId) {
      toast.error("Pick your name first");
      return;
    }
    const amount = parsePriceAmount(draft);
    if (amount == null || amount <= 0) {
      toast.error("Enter the price you see.");
      return;
    }
    setEditing(false);
    startTransition(async () => {
      applyOptimistic({ type: "set", amount });
      try {
        await setPrice({
          accommodationId,
          memberId: currentMemberId,
          amount,
          currency,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't save your price — try again",
        );
      }
    });
  }

  function handleClear() {
    if (!currentMemberId) return;
    setDraft("");
    setEditing(false);
    startTransition(async () => {
      applyOptimistic({ type: "clear" });
      try {
        await setPrice({ accommodationId, memberId: currentMemberId, amount: null });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't clear your price — try again",
        );
      }
    });
  }

  const hasPrices = comparison.count > 0;
  const reference = formatMoney(referenceAmount, currency);

  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
          <Tag className="size-3" aria-hidden />
          Who pays what
        </span>
        {reference && (
          <span className="text-[0.7rem] text-muted-foreground">
            standard {reference}/night
          </span>
        )}
      </div>

      {hasPrices ? (
        <>
          <ul className="flex flex-col gap-1.5">
            {comparison.entries.map((entry) => (
              <PriceBar
                key={entry.member.id}
                entry={entry}
                currency={currency}
                isMine={entry.member.id === currentMemberId}
              />
            ))}
          </ul>

          <BookerCallout
            comparison={comparison}
            currency={currency}
            stayNights={stayNights}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No personal prices yet — add yours to find who has the best deal.
        </p>
      )}

      {/* Editor: the current member's own price. */}
      {currentMemberId ? (
        editing ? (
          <div className="flex items-center gap-1.5">
            <div className="flex h-8 flex-1 items-center gap-1 rounded-lg border border-input bg-background px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="text-sm text-muted-foreground">
                {(currency || "$").trim()}
              </span>
              <input
                autoFocus
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") {
                    setDraft(mine ? String(mine.amount) : "");
                    setEditing(false);
                  }
                }}
                placeholder="your price / night"
                aria-label="Your price per night"
                className="h-full w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending || !draft.trim()}
            >
              Save
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => {
                setDraft(mine ? String(mine.amount) : "");
                setEditing(false);
              }}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        ) : mine ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Your price ·{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatMoney(mine.amount, currency)}
              </span>
              /night
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setDraft(String(mine.amount));
                  setEditing(true);
                }}
              >
                <Pencil className="size-3" aria-hidden />
                Edit
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Clear your price"
                disabled={isPending}
                onClick={handleClear}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            <Tag className="size-3.5" aria-hidden />
            Add your price
          </Button>
        )
      ) : (
        <p className="text-[0.7rem] text-muted-foreground">
          Pick your name to add your price.
        </p>
      )}
    </section>
  );
}

/** One member's price bar — width ∝ amount, filled in their color. */
function PriceBar({
  entry,
  currency,
  isMine,
}: {
  entry: MemberPriceEntry;
  currency: string | null;
  isMine: boolean;
}) {
  // Floor the width so even the cheapest (shortest) bar stays visible — but keep
  // the floor small so near-ties read as visually close instead of exaggerated.
  const width = `${Math.max(entry.ratio, 0.06) * 100}%`;

  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "w-14 shrink-0 truncate text-xs sm:w-16",
          entry.isCheapest ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
        title={entry.member.name}
      >
        {entry.member.name}
        {isMine && <span className="text-muted-foreground"> (you)</span>}
      </span>

      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-muted">
        <div
          className={cn(
            "h-full rounded-md transition-all duration-300",
            entry.isCheapest ? "opacity-100" : "opacity-45",
          )}
          style={{ width, backgroundColor: entry.member.color }}
        />
        {entry.isCheapest && (
          // A light chip with a member-colored glyph stays legible on any bar
          // color (several palette colors are too light for a white icon).
          <span className="absolute top-1/2 left-1 inline-flex -translate-y-1/2 items-center justify-center rounded-full bg-white/95 p-0.5 shadow-sm">
            <Trophy
              className="size-2.5"
              style={{ color: entry.member.color }}
              aria-hidden
            />
          </span>
        )}
      </div>

      <span
        className={cn(
          "w-12 shrink-0 text-right text-xs tabular-nums sm:w-14",
          entry.isCheapest ? "font-bold text-foreground" : "text-muted-foreground",
        )}
      >
        {formatMoney(entry.amount, currency)}
      </span>
    </li>
  );
}

/** The "who should book" verdict under the bars. */
function BookerCallout({
  comparison,
  currency,
  stayNights,
}: {
  comparison: ReturnType<typeof priceComparison>;
  currency: string | null;
  stayNights: number | null;
}) {
  const { entries, cheapest, count, allEqual, min } = comparison;
  if (count === 0 || min == null) return null;

  // Everyone sees the same number — no one has an edge.
  if (allEqual && count > 1) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
        <Tag className="size-3.5 shrink-0" aria-hidden />
        Same price for everyone so far.
      </p>
    );
  }

  const names = joinNames(cheapest.map((c) => c.member.name));
  const tie = cheapest.length > 1;
  const cheapestColor = cheapest[0].member.color;
  const legTotal = nightlyTotal(min, stayNights);

  // How much the best price beats the *next* real price someone entered — an
  // honest, attainable anchor (never an invented MSRP). Suppressed under $1 so a
  // rounding-level gap never reads as a meaningful saving.
  const nextCheapest = entries.find((e) => e.amount > min)?.amount ?? null;
  const savings =
    nextCheapest != null ? Math.round((nextCheapest - min) * 100) / 100 : null;

  return (
    <div
      className="flex flex-col gap-1 rounded-md px-2.5 py-2 text-xs"
      style={{ backgroundColor: `color-mix(in oklch, ${cheapestColor} 16%, transparent)` }}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-foreground">
        <Trophy className="size-3.5 shrink-0" style={{ color: cheapestColor }} aria-hidden />
        <span>
          <span className="font-bold">{names}</span>{" "}
          {tie ? "tie for the best price" : "has the best price"} at{" "}
          <span className="font-bold tabular-nums">{formatMoney(min, currency)}</span>/night
          {legTotal != null && stayNights != null && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {formatMoney(legTotal, currency)} for {stayNights}{" "}
              {stayNights === 1 ? "night" : "nights"}
            </span>
          )}
        </span>
        <span className="font-semibold" style={{ color: cheapestColor }}>
          → {tie ? "either books" : `${cheapest[0].member.name} books`}
        </span>
      </p>

      {savings != null && savings >= 1 && (
        <p className="pl-5 font-semibold text-yes tabular-nums">
          Saves {formatMoney(savings, currency)}/night vs the next price
        </p>
      )}
    </div>
  );
}
