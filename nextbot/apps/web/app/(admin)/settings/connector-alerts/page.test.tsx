// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

// Same convention as `app/internal/ops/(console)/layout.test.tsx`'s redirectMock:
// the real `redirect()` throws a special `NEXT_REDIRECT` control-flow error, so
// this mock mirrors that shape rather than returning normally.
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

const { default: ConnectorAlertsRedirectPage } = await import("./page.js");

describe("app/(admin)/settings/connector-alerts/page.tsx (Plan Phase 3 — folded into MCP Health)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("never 404s a bookmarked/old link — redirects to the new Alert Configuration tab on MCP Health", () => {
    expect(() => ConnectorAlertsRedirectPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/mcp-health?tab=alerts");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });
});
