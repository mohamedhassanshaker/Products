import { describe, expect, it } from "vitest";
import { classifyReadWrite, defaultApprovalTier } from "./backend-type-defaults.js";

describe("classifyReadWrite", () => {
  it("classifies recognized read verbs as Read", () => {
    expect(classifyReadWrite("get_ticket")).toBe("Read");
    expect(classifyReadWrite("listInvoices")).toBe("Read");
    expect(classifyReadWrite("search_customers")).toBe("Read");
  });

  it("classifies everything else as Write (conservative default)", () => {
    expect(classifyReadWrite("create_ticket")).toBe("Write");
    expect(classifyReadWrite("deleteInvoice")).toBe("Write");
    expect(classifyReadWrite("do_the_thing")).toBe("Write");
  });
});

describe("defaultApprovalTier (LLD §3.6 seeded backend-type defaults)", () => {
  it("Read is always Tier1 regardless of backend type", () => {
    expect(defaultApprovalTier("Billing", "Read", "get_invoice")).toBe("Tier1");
    expect(defaultApprovalTier("Custom", "Read", "get_x")).toBe("Tier1");
  });

  it("Write on Billing is always Tier2", () => {
    expect(defaultApprovalTier("Billing", "Write", "create_invoice")).toBe("Tier2");
  });

  it("Write on Ticketing/CRM/HRIS is Tier1 for create-shaped verbs", () => {
    expect(defaultApprovalTier("Ticketing", "Write", "create_ticket")).toBe("Tier1");
    expect(defaultApprovalTier("CRM", "Write", "update_contact")).toBe("Tier1");
  });

  it("Write on Ticketing/CRM/HRIS is Tier2 for destructive/refund-shaped verbs", () => {
    expect(defaultApprovalTier("Ticketing", "Write", "delete_ticket")).toBe("Tier2");
    expect(defaultApprovalTier("CRM", "Write", "cancel_subscription")).toBe("Tier2");
    expect(defaultApprovalTier("HRIS", "Write", "refund_expense")).toBe("Tier2");
  });

  it("Write on other backend types defaults conservatively to Tier2", () => {
    expect(defaultApprovalTier("ERP", "Write", "post_order")).toBe("Tier2");
    expect(defaultApprovalTier("Custom", "Write", "do_thing")).toBe("Tier2");
  });
});
