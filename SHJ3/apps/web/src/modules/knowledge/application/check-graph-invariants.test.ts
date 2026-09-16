import { describe, expect, it } from "vitest";
import { CheckGraphInvariants } from "./check-graph-invariants.js";
import { FakeKnowledgeAiClient } from "../testing/fakes.js";

describe("the G11/G12 graph invariant sweep", () => {
  it("surfaces a non-zero finding plainly rather than hiding it", async () => {
    const ai = new FakeKnowledgeAiClient();
    ai.setGraphInvariantsResult({
      labelledButWrongProp: 0,
      propButNoLabel: 2,
      crossTenantEdges: 0,
    });

    const result = await new CheckGraphInvariants({ ai }).execute();
    expect(result.propButNoLabel).toBe(2);
  });

  it("is all-zero for a healthy tenant", async () => {
    const ai = new FakeKnowledgeAiClient();
    const result = await new CheckGraphInvariants({ ai }).execute();
    expect(result).toEqual({ labelledButWrongProp: 0, propButNoLabel: 0, crossTenantEdges: 0 });
  });
});
