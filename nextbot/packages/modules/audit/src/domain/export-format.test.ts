import { describe, expect, it } from "vitest";
import { auditLogToCsv, auditLogToJson } from "./export-format.js";
import type { AuditLogEntryRow } from "../application/query-audit.js";

const ROW: AuditLogEntryRow = {
  id: "1",
  occurredAt: new Date("2026-08-16T00:00:00Z"),
  actorId: "u1",
  actorLabel: "admin@example.com",
  actionType: "connector.updated",
  targetType: "connector",
  targetId: "c1",
  outcome: "Success",
  details: { note: "routine update" },
};

describe("auditLogToCsv", () => {
  it("produces a header row plus one row per entry", () => {
    const csv = auditLogToCsv([ROW]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("occurredAt,actorLabel,actionType,targetType,targetId,outcome,details");
    expect(lines[1]).toContain("admin@example.com");
  });

  it("escapes a field containing a comma or quote", () => {
    const row = { ...ROW, actorLabel: 'Jane, "the admin"' };
    const csv = auditLogToCsv([row]);
    expect(csv).toContain('"Jane, ""the admin"""');
  });

  it("handles an empty result set", () => {
    expect(auditLogToCsv([]).split("\n")).toHaveLength(1);
  });
});

describe("auditLogToJson", () => {
  it("round-trips every field", () => {
    const parsed = JSON.parse(auditLogToJson([ROW]));
    expect(parsed[0].actionType).toBe("connector.updated");
    expect(parsed[0].details).toEqual({ note: "routine update" });
  });
});
