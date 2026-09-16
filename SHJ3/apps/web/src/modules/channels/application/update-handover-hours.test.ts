import { describe, expect, it } from "vitest";
import { UpdateHandoverHours } from "./update-handover-hours.js";
import type {
  HandoverConfigRepository,
  HandoverConfigRow,
  UpdateHandoverConfigInput,
} from "../ports/handover-config-repository.js";
import type {
  UpdateWorkingHoursProfileInput,
  WorkingHoursProfileRow,
  WorkingHoursRepository,
} from "../ports/working-hours-repository.js";

function fakeWorkingHours(): WorkingHoursRepository & {
  updates: UpdateWorkingHoursProfileInput[];
} {
  const updates: UpdateWorkingHoursProfileInput[] = [];
  return {
    updates,
    async find(): Promise<WorkingHoursProfileRow | null> {
      return null;
    },
    async update(input) {
      updates.push(input);
    },
    async listPublicHolidays() {
      return [];
    },
  };
}

function fakeHandover(): HandoverConfigRepository & { updates: UpdateHandoverConfigInput[] } {
  const updates: UpdateHandoverConfigInput[] = [];
  return {
    updates,
    async getSingleton(): Promise<HandoverConfigRow | null> {
      return null;
    },
    async update(input) {
      updates.push(input);
    },
  };
}

const BASE_INPUT = {
  workingHoursProfileId: "whp_01",
  handoverConfigId: "hc_01",
  timezone: "Asia/Dubai",
  publicHolidayAutoSync: true,
  slots: [],
  noAgentAvailableMessage: "We are closed right now.",
  now: new Date("2026-09-09T12:00:00Z"),
};

describe("UpdateHandoverHours", () => {
  it("refuses to save, writing neither entity, when escalation is offered outside hours but the assistant would refuse the session entirely", async () => {
    const workingHours = fakeWorkingHours();
    const handover = fakeHandover();
    const useCase = new UpdateHandoverHours({ workingHours, handover });

    const result = await useCase.execute({
      ...BASE_INPUT,
      assistantAvailable247: false,
      offerEscalationOutsideHours: true,
    });

    expect(result).toEqual({ ok: false, reason: "channels.handover_requires_assistant_available" });
    expect(workingHours.updates).toHaveLength(0);
    expect(handover.updates).toHaveLength(0);
  });

  it("saves both entities together for the wireframe's own documented shape", async () => {
    const workingHours = fakeWorkingHours();
    const handover = fakeHandover();
    const useCase = new UpdateHandoverHours({ workingHours, handover });

    const result = await useCase.execute({
      ...BASE_INPUT,
      assistantAvailable247: true,
      offerEscalationOutsideHours: false,
    });

    expect(result).toEqual({ ok: true });
    expect(workingHours.updates).toHaveLength(1);
    expect(handover.updates).toHaveLength(1);
    expect(workingHours.updates[0]?.assistantAvailable247).toBe(true);
    expect(handover.updates[0]?.offerEscalationOutsideHours).toBe(false);
  });
});
