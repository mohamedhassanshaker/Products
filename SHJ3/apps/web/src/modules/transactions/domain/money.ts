/**
 * Money, exactly as `docs/data-model.md` §4.12 requires: minor units (fils) as
 * an exact integer, never `DECIMAL` or a float. AED 412.00 is `41200n`, and
 * every refund/settlement computation in this module works in that same
 * integer space — "a rounding difference in a government payment record is a
 * reconciliation incident."
 *
 * `amountMinor` is a `bigint` because `Transaction.amountMinor` is a SQL
 * Server `BIGINT` column (Prisma's own mapping) and a `number` would silently
 * lose precision above 2^53 fils (a real, if extreme, amount) — matching
 * `CK_Transactions_amountPositive`'s own floor of exactly one fils.
 */

export interface Money {
  readonly amountMinor: bigint;
  /** ISO 4217, `CK_Transactions_currency` — `AED` is the only seeded value; the column exists so a second currency is additive. */
  readonly currency: string;
}

export function money(amountMinor: bigint, currency = "AED"): Money {
  if (amountMinor <= 0n) {
    throw new Error(
      `Money amount must be a positive integer number of minor units, got ${amountMinor}.`,
    );
  }
  return { amountMinor, currency };
}

export function isSameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}
