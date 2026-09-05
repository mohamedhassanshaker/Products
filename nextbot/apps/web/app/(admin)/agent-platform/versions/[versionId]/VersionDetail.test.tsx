// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Phase 7 (client-feedback-batch item 6): `?tab=sandbox` deep-links here from
// `DefinitionDetail.tsx`'s "Run a sandbox test" link. Mutable holder (mirrors
// `VersionEditor.test.tsx`'s own established pattern for the same primitive) so
// individual tests can opt into a non-empty query string.
let searchParamsValue = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsValue,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { VersionDetail } from "./VersionDetail.js";

/** shadcn/Tailwind conversion (Batch D) — same `chooseOption` helper this migration
 * established in `RoutingConfig.test.tsx` (Batch A) for driving the new Base
 * UI-backed `Select` instead of a native `<select>`'s `fireEvent.change`. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  const trigger = await screen.findByRole("combobox", { name: triggerName });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const VERSION = {
  id: "v1",
  agentDefinitionId: "d1",
  version: "1.0.0",
  status: "Draft",
  graphType: "ADK",
  definitionYaml: "apiVersion: nextbot.io/v1\n",
  evalSuiteId: null,
  gitCommitSha: "abc",
};

function mockRoutes(overrides: Record<string, unknown> = {}) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [] } });
    if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, ...overrides } } });
    if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1" }] } });
    return Promise.resolve({ kind: "ok", data: {} });
  });
}

describe("VersionDetail (UX_GUIDELINES.md §6.4/§6.5)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    searchParamsValue = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
  });

  it("Phase 7: ?tab=sandbox deep-links directly to the Sandbox tab instead of Overview", async () => {
    searchParamsValue = new URLSearchParams({ tab: "sandbox" });
    mockRoutes();
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/channels")) return Promise.resolve({ kind: "forbidden" });
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: VERSION } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    expect(screen.getByRole("tab", { name: "Sandbox", selected: true })).toBeInTheDocument();
  });

  it("renders the version's read-only YAML content and status", async () => {
    mockRoutes();
    render(<VersionDetail versionId="v1" canWrite={true} />);
    expect(await screen.findByRole("heading", { name: /v1\.0\.0/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/agent definition yaml content/i)).toHaveValue(VERSION.definitionYaml);
    expect(screen.getByLabelText(/agent definition yaml content/i)).toHaveAttribute("readonly");
  });

  it("shows the no-eval-suite-bound prompt on the Eval tab and binds one", async () => {
    mockRoutes();
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Eval" }));
    expect(await screen.findByText(/no eval suite is bound/i)).toBeInTheDocument();

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok" }); // bind-eval-suite POST
    mockRoutes({ evalSuiteId: "s1" });
    await chooseOption(/select eval suite/i, "golden-v1");
    fireEvent.click(screen.getByRole("button", { name: /bind eval suite/i }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("bind-eval-suite"), expect.objectContaining({ method: "POST" })));
  });

  it("shows run history once a suite is bound and triggers a new run", async () => {
    mockRoutes({ evalSuiteId: "s1" });
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [{ id: "r1", status: "Passed", passRatePct: "100.00", triggeredBy: "Manual", startedAt: new Date().toISOString(), finishedAt: null }] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, evalSuiteId: "s1" } } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Eval" }));
    expect(await screen.findByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("fetches and shows the per-case results table on demand (QA Defect U2 — GET /eval-runs/:id/results existed but was never called from the frontend)", async () => {
    mockRoutes({ evalSuiteId: "s1" });
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/eval-runs/r1/results")) {
        return Promise.resolve({
          kind: "ok",
          data: {
            results: [
              { id: "res-1", evalCaseId: "case-1", caseName: "greets-politely", passed: true, actualResponse: "Hello!", failureReason: null, costUsd: "0.0012", latencyMs: 340 },
              { id: "res-2", evalCaseId: "case-2", caseName: "tool-call-case", passed: false, actualResponse: "", failureReason: "Tool-call expectations cannot be evaluated until Phase 12 wires real tool dispatch through the turn pipeline.", costUsd: null, latencyMs: 12 },
            ],
          },
        });
      }
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [{ id: "r1", status: "Failed", passRatePct: "50.00", triggeredBy: "Manual", startedAt: new Date().toISOString(), finishedAt: null }] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, evalSuiteId: "s1" } } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Eval" }));
    await screen.findByText("Failed");

    fireEvent.click(screen.getByRole("button", { name: /view results/i }));
    expect(await screen.findByText("greets-politely")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("tool-call-case")).toBeInTheDocument();
    // The neutral "not yet supported" treatment, not a red "Failed" badge.
    expect(screen.getByText("Not yet supported")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/eval-runs/r1/results"));
  });

  it("shows an empty-results message when a run's case-results array is empty, and a '—' fallback for a null cost/latency", async () => {
    mockRoutes({ evalSuiteId: "s1" });
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/eval-runs/r-empty/results")) return Promise.resolve({ kind: "ok", data: { results: [] } });
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [{ id: "r-empty", status: "Passed", passRatePct: null, triggeredBy: "Manual", startedAt: null, finishedAt: null }] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, evalSuiteId: "s1" } } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Eval" }));
    // passRatePct null and startedAt null both render "—" fallbacks.
    expect(await screen.findAllByText("—")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /view results/i }));
    expect(await screen.findByText(/no case results for this run/i)).toBeInTheDocument();
  });

  it("renders a null cost/latency case result as '—' rather than throwing", async () => {
    mockRoutes({ evalSuiteId: "s1" });
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/eval-runs/r1/results")) {
        return Promise.resolve({
          kind: "ok",
          data: { results: [{ id: "res-1", evalCaseId: "case-1", caseName: "no-cost-case", passed: true, actualResponse: null, failureReason: null, costUsd: null, latencyMs: null }] },
        });
      }
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [{ id: "r1", status: "Passed", passRatePct: "100.00", triggeredBy: "Manual", startedAt: new Date().toISOString(), finishedAt: null }] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, evalSuiteId: "s1" } } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Eval" }));
    fireEvent.click(await screen.findByRole("button", { name: /view results/i }));
    expect(await screen.findByText("no-cost-case")).toBeInTheDocument();
  });

  it("Phase 6: Sandbox tab mounts ChatPreviewPanel scoped to this version once a WebWidget channel is found", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      // More specific patterns first: "/versions/v1" is itself a substring of the
      // sandbox-preview-token URL, so it must not shadow that branch.
      if (url.includes("sandbox-preview-token")) return Promise.resolve({ kind: "ok", data: { previewToken: "tok-1" } });
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: VERSION } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [] } });
      if (url.includes("/api/v1/admin/channels")) {
        return Promise.resolve({
          kind: "ok",
          data: { channels: [{ type: "WebWidget", publicKey: "wc_1" }], tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" },
        });
      }
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Sandbox" }));

    expect(await screen.findByTitle("NextBot chat preview")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/versions/v1/sandbox-preview-token"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Phase 6: Sandbox tab shows an honest 'add a channel first' message when the tenant has no WebWidget channel yet", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/eval-runs")) return Promise.resolve({ kind: "ok", data: { runs: [] } });
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "ok", data: { version: VERSION } });
      if (url.includes("/eval-suites")) return Promise.resolve({ kind: "ok", data: { suites: [] } });
      if (url.includes("/api/v1/admin/channels")) {
        return Promise.resolve({ kind: "ok", data: { channels: [], tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" } });
      }
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    await screen.findByRole("heading", { name: /v1\.0\.0/ });
    fireEvent.click(screen.getByRole("tab", { name: "Sandbox" }));

    expect(await screen.findByText(/no web widget channel exists yet/i)).toBeInTheDocument();
  });

  it("shows a full-page error alert when loading the version fails", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/versions/v1")) return Promise.resolve({ kind: "error", status: 500, message: "Something went wrong loading this version." });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<VersionDetail versionId="v1" canWrite={true} />);
    expect(await screen.findByText("Something went wrong loading this version.")).toBeInTheDocument();
  });
});
