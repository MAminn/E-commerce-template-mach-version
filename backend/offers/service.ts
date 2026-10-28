import { query, type DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  cartOffer,
  product,
  type CartOfferRow,
  type OfferCondition,
  type OfferGiftLine,
  type OfferReward,
  type OrderAppliedOfferSnapshot,
} from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import { and, asc, eq, inArray, isNull, lte, gte, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

// ─── Input schemas ────────────────────────────────────────────────────────────

const CartItemInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int().min(1),
  /** Effective price (after any per-product discount) in the store's currency.
   * Ignored by `evaluate`, which prices every line from the database. */
  price: z.number().nonnegative(),
  categoryIds: z.array(z.string()).optional(),
  /** The line's variant, formatted exactly as checkout sends it (see
   * formatSelectedOptions). A free gift copies it from the paid line. */
  selectedOptions: z.string().max(500).nullable().optional(),
});

export type CartItemInput = z.infer<typeof CartItemInputSchema>;

export const evaluateOffersSchema = z.object({
  cartItems: z.array(CartItemInputSchema).max(100),
  /** Ignored — recomputed from database prices. Kept for older clients. */
  subtotal: z.number().nonnegative(),
});

export type EvaluateOffersInput = z.infer<typeof evaluateOffersSchema>;

// ─── Offer CRUD schemas ───────────────────────────────────────────────────────

const conditionSchema: z.ZodType<OfferCondition> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({
    type: z.literal("quantity_threshold"),
    minQuantity: z.number().int().min(1),
    productIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    repeatsPerMultiple: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("cart_total"),
    minTotal: z.number().positive(),
  }),
  z.object({
    type: z.literal("product_bundle"),
    requiredProductIds: z.array(z.string().uuid()).min(2),
  }),
  z.object({
    type: z.literal("buy_x_get_y"),
    buyQuantity: z.number().int().min(1).max(100),
    productIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    repeatsPerMultiple: z.boolean().optional(),
  }),
]);

const rewardSchema: z.ZodType<OfferReward> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("percentage_off"),
    percentOff: z.number().min(1).max(100),
  }),
  z.object({
    type: z.literal("fixed_off"),
    amountOff: z.number().positive(),
  }),
  z.object({ type: z.literal("free_shipping") }),
  z.object({
    type: z.literal("free_items"),
    quantity: z.number().int().min(1),
    which: z.enum(["cheapest", "most_expensive"]),
  }),
  z.object({
    type: z.literal("free_gift"),
    getQuantity: z.number().int().min(1).max(100),
    sameProduct: z.literal(true),
    autoAdd: z.literal(true),
  }),
]);

/**
 * Rules a condition + reward pair must satisfy together. buy_x_get_y and
 * free_gift only make sense as a pair, and a BOGO must name what it covers —
 * an empty list would silently turn into "nothing", never "everything".
 */
export function offerShapeError(condition: OfferCondition, reward: OfferReward): string | null {
  const isBogoCondition = condition.type === "buy_x_get_y";
  const isGiftReward = reward.type === "free_gift";
  if (isBogoCondition && !isGiftReward) {
    return "A Buy X Get Y offer must use the Free Gift reward.";
  }
  if (isGiftReward && !isBogoCondition) {
    return "The Free Gift reward only works with a Buy X Get Y offer.";
  }
  if (
    condition.type === "buy_x_get_y" &&
    (condition.productIds?.length ?? 0) + (condition.categoryIds?.length ?? 0) === 0
  ) {
    return "Pick at least one eligible product or category for this offer.";
  }
  return null;
}

const offerFieldsSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
  isExclusive: z.boolean().default(false),
  condition: conditionSchema,
  reward: rewardSchema,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

export const createOfferSchema = offerFieldsSchema.superRefine((offer, ctx) => {
  const error = offerShapeError(offer.condition, offer.reward);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reward"], message: error });
});

export type CreateOfferInput = z.infer<typeof createOfferSchema>;

// Pair rules for a partial update are checked against the stored offer in
// updateOffer — a request may change only one half of the pair.
export const updateOfferSchema = offerFieldsSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

// ─── Applied offer result ─────────────────────────────────────────────────────

export interface AppliedOffer {
  id: string;
  name: string;
  description: string | null;
  reward: OfferReward;
  /** Amount deducted from the cart total (0 for free_shipping) */
  discountAmount: number;
  /** True when reward includes free shipping */
  freeShipping: boolean;
  /** Human-readable summary shown in cart e.g. "Buy 3 Get 1 Free" */
  label: string;
  /** free_gift rewards only: the units this offer adds at price 0. They are
   * not part of `discountAmount` — gifts are extra lines, not a discount. */
  gifts?: AppliedOfferGift[];
}

export interface AppliedOfferGift extends OfferGiftLine {
  /** Set by `evaluate` when stock cannot cover the paid units plus every free
   * unit of this product. Checkout refuses such a cart. */
  insufficientStock?: { available: number; required: number };
}

type BuyXGetYCondition = Extract<OfferCondition, { type: "buy_x_get_y" }>;
type FreeGiftReward = Extract<OfferReward, { type: "free_gift" }>;

// ─── Evaluation logic (pure, no Effect) ──────────────────────────────────────

function conditionMet(condition: OfferCondition, cartItems: CartItemInput[], subtotal: number): boolean {
  switch (condition.type) {
    case "always":
      return true;

    case "quantity_threshold": {
      let relevantItems = cartItems;
      if (condition.productIds?.length) {
        relevantItems = cartItems.filter((i) => condition.productIds!.includes(i.id));
      } else if (condition.categoryIds?.length) {
        relevantItems = cartItems.filter((i) =>
          i.categoryIds?.some((c) => condition.categoryIds!.includes(c))
        );
      }
      const totalQty = relevantItems.reduce((s, i) => s + i.quantity, 0);
      return totalQty >= condition.minQuantity;
    }

    case "cart_total":
      return subtotal >= condition.minTotal;

    case "product_bundle": {
      const presentIds = new Set(cartItems.map((i) => i.id));
      return condition.requiredProductIds.every((id) => presentIds.has(id));
    }

    default:
      return false;
  }
}

/**
 * How many times a quantity_threshold condition's own reward should repeat,
 * given the cart. 1 for every other condition type, and for quantity_threshold
 * unless the admin opted into `repeatsPerMultiple` (this is separate from
 * `isExclusive`/offer-vs-offer stacking — see the schema.ts doc comment).
 */
function rewardMultiplier(condition: OfferCondition, cartItems: CartItemInput[]): number {
  if (condition.type !== "quantity_threshold" || !condition.repeatsPerMultiple) return 1;

  let relevantItems = cartItems;
  if (condition.productIds?.length) {
    relevantItems = cartItems.filter((i) => condition.productIds!.includes(i.id));
  } else if (condition.categoryIds?.length) {
    relevantItems = cartItems.filter((i) =>
      i.categoryIds?.some((c) => condition.categoryIds!.includes(c))
    );
  }
  const totalQty = relevantItems.reduce((s, i) => s + i.quantity, 0);
  return Math.max(1, Math.floor(totalQty / condition.minQuantity));
}

/**
 * Returns the reward as actually applied to this cart — identical to the
 * stored reward when multiplier is 1, otherwise scaled so downstream
 * consumers (discount math, free-item badges) see the effective amount
 * without needing to know about repeatsPerMultiple themselves.
 */
function effectiveReward(reward: OfferReward, multiplier: number): OfferReward {
  if (multiplier <= 1) return reward;
  switch (reward.type) {
    case "fixed_off":
      return { ...reward, amountOff: reward.amountOff * multiplier };
    case "free_items":
      return { ...reward, quantity: reward.quantity * multiplier };
    default:
      return reward;
  }
}

function computeDiscount(reward: OfferReward, cartItems: CartItemInput[], subtotal: number): { discountAmount: number; freeShipping: boolean } {
  switch (reward.type) {
    case "percentage_off":
      return { discountAmount: subtotal * (reward.percentOff / 100), freeShipping: false };

    case "fixed_off":
      return { discountAmount: Math.min(reward.amountOff, subtotal), freeShipping: false };

    case "free_shipping":
      return { discountAmount: 0, freeShipping: true };

    case "free_items": {
      const allItems = cartItems.flatMap((i) => Array(i.quantity).fill(i.price) as number[]);
      const sorted = reward.which === "cheapest"
        ? allItems.sort((a, b) => a - b)
        : allItems.sort((a, b) => b - a);
      const freeValue = sorted.slice(0, reward.quantity).reduce((s, p) => s + p, 0);
      return { discountAmount: freeValue, freeShipping: false };
    }

    default:
      return { discountAmount: 0, freeShipping: false };
  }
}

function rewardLabel(reward: OfferReward): string {
  switch (reward.type) {
    case "percentage_off": return `${reward.percentOff}% off`;
    case "fixed_off": return `${reward.amountOff} off`;
    case "free_shipping": return "Free shipping";
    case "free_items": return `${reward.quantity} item${reward.quantity > 1 ? "s" : ""} free`;
    case "free_gift": return `${reward.getQuantity} free gift${reward.getQuantity > 1 ? "s" : ""}`;
    default: return "Discount applied";
  }
}

function isGiftEligible(condition: BuyXGetYCondition, item: CartItemInput): boolean {
  if (condition.productIds?.includes(item.id)) return true;
  return !!item.categoryIds?.some((c) => condition.categoryIds?.includes(c));
}

/**
 * The free units a Buy X Get Y offer adds to this cart.
 *
 * Counted per cart line (product + variant), in cart order, and only on the
 * paid quantity — gifts are never part of `cartItems`, so a free unit can't
 * earn another one. Lines are deliberately not merged: splitting a line can
 * only lower floor(qty / buyQuantity), never raise it.
 *   repeatsPerMultiple on:  every line gets floor(qty / buy) × get.
 *   repeatsPerMultiple off: one gift set per order, on the first line that
 *                           reaches buyQuantity.
 * Lines in `claimedLines` already earned a gift from a higher-priority offer
 * and are skipped, so two overlapping BOGO offers never both give one.
 */
export function computeOfferGifts(
  offer: Pick<CartOfferRow, "id" | "name">,
  condition: BuyXGetYCondition,
  reward: FreeGiftReward,
  cartItems: CartItemInput[],
  claimedLines: ReadonlySet<number> = new Set(),
): { gifts: OfferGiftLine[]; lineIndexes: number[] } {
  const gifts: OfferGiftLine[] = [];
  const lineIndexes: number[] = [];

  for (const [index, item] of cartItems.entries()) {
    if (claimedLines.has(index) || !isGiftEligible(condition, item)) continue;
    const sets = Math.floor(item.quantity / condition.buyQuantity);
    if (sets < 1) continue;

    gifts.push({
      offerId: offer.id,
      offerName: offer.name,
      productId: item.id,
      selectedOptions: item.selectedOptions || null,
      name: item.name,
      quantity: (condition.repeatsPerMultiple ? sets : 1) * reward.getQuantity,
      unitValue: item.price,
    });
    lineIndexes.push(index);
    if (!condition.repeatsPerMultiple) break;
  }

  return { gifts, lineIndexes };
}

/**
 * Products whose stock can't cover their paid units plus their free units.
 * `stockById` must come from the database (checkout: rows locked FOR UPDATE).
 */
export function findGiftStockShortfalls(
  cartItems: readonly { id: string; quantity: number }[],
  gifts: readonly { productId: string; quantity: number }[],
  stockById: ReadonlyMap<string, number>,
): Map<string, { available: number; required: number }> {
  const giftQty = new Map<string, number>();
  for (const g of gifts) giftQty.set(g.productId, (giftQty.get(g.productId) ?? 0) + g.quantity);

  const shortfalls = new Map<string, { available: number; required: number }>();
  for (const [productId, free] of giftQty) {
    const paid = cartItems.reduce((s, i) => (i.id === productId ? s + i.quantity : s), 0);
    const available = stockById.get(productId) ?? 0;
    if (available < paid + free) shortfalls.set(productId, { available, required: paid + free });
  }
  return shortfalls;
}

/** The audit record an order keeps of the offers applied to it. */
export function snapshotAppliedOffers(
  applied: readonly AppliedOffer[],
  offers: readonly CartOfferRow[],
): OrderAppliedOfferSnapshot[] {
  return applied.map((o) => ({
    id: o.id,
    name: o.name,
    condition: offers.find((row) => row.id === o.id)?.condition,
    reward: o.reward,
    discountAmount: o.discountAmount,
    freeShipping: o.freeShipping,
    ...(o.gifts?.length
      ? { gifts: o.gifts.map(({ insufficientStock: _ignored, ...gift }) => gift) }
      : {}),
  }));
}

// ─── Pure evaluation helper (no Effect, usable inside DB transactions) ───────

/**
 * Evaluate which offers apply to the given cart. Accepts pre-fetched offer rows
 * so callers (e.g. order creation) can run this inside an existing transaction
 * without needing to compose Effects.
 */
export function applyOffersToCart(
  offers: CartOfferRow[],
  cartItems: CartItemInput[],
  subtotal: number,
): AppliedOffer[] {
  const applied: AppliedOffer[] = [];
  let exclusiveTriggered = false;
  // Cart lines that already earned a free gift (see computeOfferGifts).
  const claimedGiftLines = new Set<number>();

  for (const offer of offers) {
    if (exclusiveTriggered) break;
    const condition = offer.condition as OfferCondition;
    const storedReward = offer.reward as OfferReward;

    if (condition.type === "buy_x_get_y" || storedReward.type === "free_gift") {
      // A half-paired BOGO (rejected on save, but JSONB can hold anything)
      // never applies.
      if (condition.type !== "buy_x_get_y" || storedReward.type !== "free_gift") continue;
      const { gifts, lineIndexes } = computeOfferGifts(
        offer,
        condition,
        storedReward,
        cartItems,
        claimedGiftLines,
      );
      if (gifts.length === 0) continue;
      for (const index of lineIndexes) claimedGiftLines.add(index);

      applied.push({
        id: offer.id,
        name: offer.name,
        description: offer.description,
        reward: storedReward,
        discountAmount: 0,
        freeShipping: false,
        label: `Buy ${condition.buyQuantity} Get ${storedReward.getQuantity} Free`,
        gifts,
      });

      if (offer.isExclusive) exclusiveTriggered = true;
      continue;
    }

    if (!conditionMet(condition, cartItems, subtotal)) continue;

    const multiplier = rewardMultiplier(condition, cartItems);
    const reward = effectiveReward(storedReward, multiplier);
    const { discountAmount, freeShipping } = computeDiscount(reward, cartItems, subtotal);

    applied.push({
      id: offer.id,
      name: offer.name,
      description: offer.description,
      reward,
      discountAmount,
      freeShipping,
      label: rewardLabel(reward),
    });

    if (offer.isExclusive) exclusiveTriggered = true;
  }

  return applied;
}

/**
 * Active offers at `now`, in evaluation order: priority ascending (lower runs
 * first), then oldest first so equal priorities always resolve the same way.
 * The single query behind the cart preview, promo validation and checkout.
 */
export function selectActiveOffers(
  db: Pick<DatabaseClient, "select">,
  now: Date = new Date(),
): Promise<CartOfferRow[]> {
  return db
    .select()
    .from(cartOffer)
    .where(
      and(
        eq(cartOffer.isActive, true),
        or(isNull(cartOffer.startsAt), lte(cartOffer.startsAt, now)),
        or(isNull(cartOffer.endsAt), gte(cartOffer.endsAt, now)),
      ),
    )
    .orderBy(asc(cartOffer.priority), asc(cartOffer.createdAt), asc(cartOffer.id))
    .execute();
}

// ─── Effect services ──────────────────────────────────────────────────────────

/** Returns all active, non-expired offers ordered by priority. */
export const listActiveOffers = () =>
  Effect.gen(function* ($) {
    return yield* $(query((db) => selectActiveOffers(db)));
  });

/**
 * Evaluates which offers apply to the given cart — the cart's live preview of
 * what checkout will charge. Lines are priced and categorised from the
 * database (client prices are ignored); lines for unknown, hidden or deleted
 * products are left out, as checkout refuses them anyway. Free gifts that
 * stock can't cover are flagged so the cart can warn before checkout.
 */
export const evaluateOffers = (input: EvaluateOffersInput) =>
  Effect.gen(function* ($) {
    const offers = yield* $(listActiveOffers());
    if (offers.length === 0 || input.cartItems.length === 0) return [];

    const ids = [...new Set(input.cartItems.map((i) => i.id))];
    const rows = yield* $(
      query((db) =>
        db
          .select({
            id: product.id,
            name: product.name,
            price: product.price,
            discountPrice: product.discountPrice,
            stock: product.stock,
            categoryId: product.categoryId,
            hidden: product.hidden,
            deleted: product.deleted,
          })
          .from(product)
          .where(inArray(product.id, ids))
          .execute(),
      ),
    );

    const lines: CartItemInput[] = input.cartItems.flatMap((item) => {
      const row = rows.find((r) => r.id === item.id);
      if (!row || row.hidden || row.deleted) return [];
      return [
        {
          id: item.id,
          name: row.name,
          quantity: item.quantity,
          price: Number.parseFloat(row.discountPrice ?? row.price),
          categoryIds: row.categoryId ? [row.categoryId] : [],
          selectedOptions: item.selectedOptions || null,
        },
      ];
    });
    const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    const applied = applyOffersToCart(offers, lines, subtotal);

    const shortfalls = findGiftStockShortfalls(
      lines,
      applied.flatMap((o) => o.gifts ?? []),
      new Map(rows.map((r) => [r.id, r.stock])),
    );
    if (shortfalls.size === 0) return applied;
    return applied.map((o) =>
      o.gifts
        ? {
            ...o,
            gifts: o.gifts.map((g) => {
              const shortfall = shortfalls.get(g.productId);
              return shortfall ? { ...g, insufficientStock: shortfall } : g;
            }),
          }
        : o,
    );
  });

/** Admin: list all offers (including inactive) */
export const listAllOffers = () =>
  Effect.gen(function* ($) {
    const offers = yield* $(
      query((db) => db.select().from(cartOffer).orderBy(asc(cartOffer.priority)))
    );
    return offers;
  });

/** Admin: create an offer */
export const createOffer = (input: CreateOfferInput) =>
  Effect.gen(function* ($) {
    const [created] = yield* $(
      query((db) =>
        db
          .insert(cartOffer)
          .values({
            name: input.name,
            description: input.description ?? null,
            isActive: input.isActive,
            priority: input.priority,
            isExclusive: input.isExclusive,
            condition: input.condition,
            reward: input.reward,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
          })
          .returning()
      )
    );
    if (!created) {
      return yield* $(
        Effect.fail(new ServerError({ tag: "Internal", statusCode: 500, clientMessage: "Failed to create offer" }))
      );
    }
    return created;
  });

/** Admin: update an offer */
export const updateOffer = (input: UpdateOfferInput) =>
  Effect.gen(function* ($) {
    const { id, ...rest } = input;

    if (rest.condition || rest.reward) {
      const [existing] = yield* $(
        query((db) => db.select().from(cartOffer).where(eq(cartOffer.id, id)))
      );
      if (!existing) {
        return yield* $(
          Effect.fail(new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Offer not found" }))
        );
      }
      const error = offerShapeError(
        rest.condition ?? existing.condition,
        rest.reward ?? existing.reward,
      );
      if (error) {
        return yield* $(
          Effect.fail(new ServerError({ tag: "BadRequest", statusCode: 400, clientMessage: error }))
        );
      }
    }

    const [updated] = yield* $(
      query((db) =>
        db
          .update(cartOffer)
          .set({ ...rest, updatedAt: new Date() })
          .where(eq(cartOffer.id, id))
          .returning()
      )
    );
    if (!updated) {
      return yield* $(
        Effect.fail(new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Offer not found" }))
      );
    }
    return updated;
  });

/** Admin: delete an offer */
export const deleteOffer = (id: string) =>
  Effect.gen(function* ($) {
    const [deleted] = yield* $(
      query((db) => db.delete(cartOffer).where(eq(cartOffer.id, id)).returning())
    );
    if (!deleted) {
      return yield* $(
        Effect.fail(new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Offer not found" }))
      );
    }
    return { success: true };
  });
