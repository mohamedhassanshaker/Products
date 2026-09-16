/**
 * Seeds the five canonical suggestion chips (FR-CONV-03, `SHJ3-wireframes-
 * guide.md` §2.3: "Pay SEWA Bills · Pay Utilities Bills · Sharjah Custom
 * Services · Emirate of Sharjah Libraries · Jawaher Centre Booking") into
 * `QuickActions`.
 *
 * A real, found gap, closed here rather than left silently broken: a live
 * proof of the real widget bootstrap endpoint returned `"chips":[]` for the
 * real, already-seeded `sewa` tenant — confirmed by grepping every seed
 * script in this repository (`seed-iam-demo-data.ts`,
 * `seed-agents-tools-demo-data.ts`, `seed-channels-demo-data.ts`) and finding
 * none of them write a `QuickAction` row at all. `ports/quick-action-
 * repository.ts`'s own doc comment names the real, long-term owner as "B7's
 * flow/config screens elsewhere" — this module only ever reads the table —
 * so this is a demo-data stand-in for that not-yet-built screen, the same
 * shape B-5's own review entry used for `platform.Policies` when it found
 * that table empty too: close the gap for real, narrowly, without claiming
 * to be the feature that should own it long-term.
 */
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";

const CANONICAL_CHIPS = [
  { label: "Pay SEWA Bills", payloadIntentKey: "qa_pay_sewa" },
  { label: "Pay Utilities Bills", payloadIntentKey: "qa_pay_utilities" },
  { label: "Sharjah Custom Services", payloadIntentKey: "qa_customs_services" },
  { label: "Emirate of Sharjah Libraries", payloadIntentKey: "qa_libraries" },
  { label: "Jawaher Centre Booking", payloadIntentKey: "qa_jawaher_booking" },
] as const;

/** Idempotent: re-running finds each `(localeCode, channelScope, ordinal)` row already present (the real unique constraint) and updates it in place rather than duplicating. */
export async function seedQuickActions(now: Date): Promise<void> {
  const db = getTenantDb();

  for (const [index, chip] of CANONICAL_CHIPS.entries()) {
    const ordinal = index + 1;
    const existing = await db.quickAction.findUnique({
      where: {
        localeCode_channelScope_ordinal: { localeCode: "en", channelScope: "All", ordinal },
      },
    });

    if (existing) {
      await db.quickAction.update({
        where: { id: existing.id },
        data: {
          label: chip.label,
          payloadIntentKey: chip.payloadIntentKey,
          isEnabled: true,
          updatedAt: now,
        },
      });
      continue;
    }

    await db.quickAction.create({
      data: {
        id: newUlid(now),
        label: chip.label,
        localeCode: "en",
        payloadIntentKey: chip.payloadIntentKey,
        ordinal,
        channelScope: "All",
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
