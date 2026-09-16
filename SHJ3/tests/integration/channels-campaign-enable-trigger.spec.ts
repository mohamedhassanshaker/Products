/**
 * The wave's own hard requirement: prove, against a REAL running SQL Server, that
 * `TR_Campaigns_templateMustBeApproved` — not application code — is what refuses to enable a
 * campaign whose template is not `Approved`. Per this project's own testing discipline
 * (`tasks/lessons.md`), this is deliberately NOT a fake-backed unit test of the adapter's
 * error-translation logic (that coverage already exists in
 * `apps/web/src/modules/channels/application/enable-campaign.test.ts`, against a fake that
 * throws the typed error) — this spec exercises the real, live database trigger itself.
 *
 * Two proofs, both against the real database:
 *   1. Through the real stack (`PrismaCampaignRepository` -> `EnableCampaign` use case) —
 *      the shape a Server Action actually sees.
 *   2. A RAW `db.campaign.update()` call that bypasses this module's own repository and use
 *      case entirely — proving the refusal is the database's own structural guard, not an
 *      artifact of this adapter's specific code path.
 *
 * Requires the real `sqlserver` container (see `docker-compose.yml`) and the `sewa` tenant
 * schema already provisioned — both true in this repo's normal dev environment.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  disconnectAllTenantDbs,
  getTenantDb,
} from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { seedTemplatesAndCampaigns } from "../../apps/web/src/modules/channels/adapters/outbound/sql/seed-channels-demo-data.js";
import { PrismaCampaignRepository } from "../../apps/web/src/modules/channels/adapters/outbound/sql/prisma-campaign-repository.js";
import { EnableCampaign } from "../../apps/web/src/modules/channels/application/enable-campaign.js";

const SEWA = assertValidSlugShape("sewa");
const BLOCKED_CAMPAIGN_NAME = "Appointment confirmation";

function withSewaTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      tenant: SEWA,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    fn,
  );
}

beforeAll(async () => {
  await withSewaTenant(async () => {
    await seedTemplatesAndCampaigns(new Date());
  });
});

afterAll(async () => {
  await disconnectAllTenantDbs();
});

describe("TR_Campaigns_templateMustBeApproved (real SQL Server)", () => {
  it("refuses, at the database, to enable a campaign whose template is Pending — through the real repository and use case", async () => {
    await withSewaTenant(async () => {
      const db = getTenantDb();
      const campaign = await db.campaign.findFirst({ where: { name: BLOCKED_CAMPAIGN_NAME } });
      expect(campaign).not.toBeNull();
      // Sanity: the campaign starts disabled, and its template really is not Approved.
      expect(campaign?.isEnabled).toBe(false);

      const useCase = new EnableCampaign({ campaigns: new PrismaCampaignRepository() });
      const result = await useCase.execute({ id: campaign!.id, now: new Date() });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("channels.template_not_approved");
        expect(result.templateName).toBe("appointment_confirmation");
        expect(result.templateStatus).toBe("Pending");
      }

      // The write genuinely did not happen — re-read from the database, not from memory.
      const after = await db.campaign.findUnique({ where: { id: campaign!.id } });
      expect(after?.isEnabled).toBe(false);
    });
  });

  it("refuses a RAW update() that bypasses this module's own repository and use case entirely — proving the trigger, not the adapter, is the real guard", async () => {
    await withSewaTenant(async () => {
      const db = getTenantDb();
      const campaign = await db.campaign.findFirst({ where: { name: BLOCKED_CAMPAIGN_NAME } });
      expect(campaign).not.toBeNull();

      let thrown: unknown;
      try {
        await db.campaign.update({
          where: { id: campaign!.id },
          data: { isEnabled: true, updatedAt: new Date() },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(
        "cannot be enabled while its message template is not Approved",
      );

      const after = await db.campaign.findUnique({ where: { id: campaign!.id } });
      expect(after?.isEnabled).toBe(false);
    });
  });

  it("allows enabling once the template is Approved — proving the trigger checks live status, not a cached flag", async () => {
    await withSewaTenant(async () => {
      const db = getTenantDb();
      const campaign = await db.campaign.findFirst({ where: { name: BLOCKED_CAMPAIGN_NAME } });
      expect(campaign).not.toBeNull();

      await db.messageTemplate.update({
        where: { id: campaign!.messageTemplateId },
        data: {
          approvalStatus: "Approved",
          bspTemplateId: "shj3-test-appointment_confirmation-en",
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const useCase = new EnableCampaign({ campaigns: new PrismaCampaignRepository() });
      const result = await useCase.execute({ id: campaign!.id, now: new Date() });
      expect(result).toEqual({ ok: true });

      const after = await db.campaign.findUnique({ where: { id: campaign!.id } });
      expect(after?.isEnabled).toBe(true);

      // Restore fixture state for repeated local runs of this spec.
      await db.campaign.update({
        where: { id: campaign!.id },
        data: { isEnabled: false, updatedAt: new Date() },
      });
      await db.messageTemplate.update({
        where: { id: campaign!.messageTemplateId },
        data: {
          approvalStatus: "Pending",
          bspTemplateId: null,
          reviewedAt: null,
          updatedAt: new Date(),
        },
      });
    });
  });
});
