import { describe, expect, it } from "vitest";
import { WidgetSessionInvalidError } from "@nextbot/contracts";
import { problemResponse } from "./problem-response.js";

describe("problemResponse (apps/gateway)", () => {
  it("maps a DomainError to its declared httpStatus + code", async () => {
    const res = problemResponse(new WidgetSessionInvalidError());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("WIDGET_SESSION_INVALID");
  });

  it("maps an unknown error to a generic 500 without leaking detail", async () => {
    const res = problemResponse(new Error("some internal secret detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("internal secret detail");
  });
});
