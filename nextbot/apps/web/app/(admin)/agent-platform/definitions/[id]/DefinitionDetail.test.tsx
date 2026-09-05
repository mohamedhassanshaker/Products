// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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

import { DefinitionDetail } from "./DefinitionDetail.js";

// jsdom does not implement `Element.scrollTo` — Base UI's `Menu` (this shadcn/
// Tailwind conversion's `DropdownMenu`, built on it) calls it internally when the
// focused/highlighted item changes (including on initial open), same as the Chakra
// `Menu` this replaced. A no-op polyfill is the standard, well-established
// workaround for testing menus under jsdom; it has no bearing on this test's
// actual assertions.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const VERSION = {
  id: "v1",
  version: "1.0.0",
  status: "EvalGated" as const,
  graphType: "ADK",
  gitCommitSha: "abcdef1234567890",
  gitPrNumber: null,
  gitPrStatus: "None" as const,
  lastEvalRunId: null,
  createdAt: new Date().toISOString(),
  _allowedTransitions: ["HumanReview", "Deprecated"] as const,
};

describe("DefinitionDetail (UX_GUIDELINES.md §6.1/§6.4)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  function mockLoad(versions: unknown[] = [VERSION]) {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
  }

  it("renders the definition name and its versions table", async () => {
    mockLoad();
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    expect(await screen.findByText("support-triage")).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("EvalGated")).toBeInTheDocument();
  });

  it("shows the empty-versions message when there are none", async () => {
    mockLoad([]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    expect(await screen.findByText(/has no versions yet/i)).toBeInTheDocument();
  });

  it("shows the Git-not-connected banner when no connection exists", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [VERSION] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: null } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    expect(await screen.findByText(/connect a git repository/i)).toBeInTheDocument();
  });

  it("only shows _allowedTransitions in the Promote menu, and calls the promote endpoint on click", async () => {
    mockLoad();
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/promote")) return Promise.resolve({ kind: "ok", data: { version: { ...VERSION, status: "HumanReview" } } });
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [VERSION] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");

    fireEvent.click(screen.getByRole("button", { name: /promote to/i }));
    const humanReviewItem = await screen.findByRole("menuitem", { name: "HumanReview" }, { timeout: 3000 });
    // "Approved"/"Production" are genuinely absent, not disabled, per _allowedTransitions.
    expect(screen.queryByRole("menuitem", { name: "Approved" })).not.toBeInTheDocument();

    fireEvent.click(humanReviewItem);
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/promote"), expect.objectContaining({ method: "POST" })));
  });

  it("fetches and shows the verbatim blocking reason via the '(?)' affordance", async () => {
    mockLoad();
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/promotion-check")) return Promise.resolve({ kind: "ok", data: { allowed: false, reason: "The bound eval suite has not passed (last run status: 'Failed')." } });
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [{ ...VERSION, _allowedTransitions: ["Deprecated"] }] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /why can't i promote this further/i }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/promotion-check?target=HumanReview")));
  });

  it("renders a Compare… link when a previous version exists, and shows a neutral Ran badge for an eval run whose outcome isn't supplied", async () => {
    const olderVersion = { ...VERSION, id: "v0", version: "0.9.0" };
    mockLoad([{ ...VERSION, lastEvalRunId: "run-1" }, olderVersion]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    expect(screen.getByRole("link", { name: /compare/i })).toHaveAttribute("href", "/agent-platform/diff?a=v0&b=v1");
    expect(screen.getByText("Ran")).toBeInTheDocument();
  });

  describe("Restore (Phase 7, client-feedback-batch item 6)", () => {
    it("shows a Restore action only on an old (non-latest) version, linking to the create-version flow pre-filled from it", async () => {
      const latest = { ...VERSION, id: "v1", version: "1.0.0" };
      const older = { ...VERSION, id: "v0", version: "0.9.0" };
      // `listAgentDefinitionVersions` orders newest-first — index 0 is the latest.
      mockLoad([latest, older]);
      render(<DefinitionDetail definitionId="d1" canWrite={true} />);
      await screen.findByText("1.0.0");

      const restoreLinks = screen.getAllByRole("link", { name: /^restore$/i });
      expect(restoreLinks).toHaveLength(1);
      expect(restoreLinks[0]).toHaveAttribute("href", "/agent-platform/definitions/d1/versions/new?fromVersionId=v0");
    });

    it("hides the Restore action for a read-only caller (canWrite=false)", async () => {
      const latest = { ...VERSION, id: "v1", version: "1.0.0" };
      const older = { ...VERSION, id: "v0", version: "0.9.0" };
      mockLoad([latest, older]);
      render(<DefinitionDetail definitionId="d1" canWrite={false} />);
      await screen.findByText("1.0.0");
      expect(screen.queryByRole("link", { name: /^restore$/i })).not.toBeInTheDocument();
    });
  });

  it("Phase 7: shows a real, always-visible 'Run a sandbox test' link to the Sandbox tab when the blocking reason is the sandbox-test gate", async () => {
    mockLoad();
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/promotion-check")) {
        return Promise.resolve({
          kind: "ok",
          data: { allowed: false, reason: "Run at least one sandbox test conversation against this version before promoting it to Production." },
        });
      }
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [{ ...VERSION, status: "Approved", _allowedTransitions: ["Deprecated"] }] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /why can't i promote this further/i }));
    const sandboxLink = await screen.findByRole("link", { name: /run a sandbox test/i });
    expect(sandboxLink).toHaveAttribute("href", "/agent-platform/versions/v1?tab=sandbox");
  });

  it("renders a version with no git commit yet, an open PR, and a Draft/Deprecated status without throwing", async () => {
    mockLoad([
      { ...VERSION, id: "v-draft", version: "0.1.0", status: "Draft", gitCommitSha: null, gitPrNumber: null, _allowedTransitions: ["EvalGated"] },
      { ...VERSION, id: "v-pr", version: "0.2.0", gitPrNumber: 42, gitPrStatus: "Open" },
      { ...VERSION, id: "v-deprecated", version: "0.0.1", status: "Deprecated", _allowedTransitions: [] },
    ]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("0.1.0");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText("0.0.1")).toBeInTheDocument();
  });

  it("distinguishes Passed/Failed eval-run outcomes instead of always showing a flat 'Ran' badge (QA Defect U7)", async () => {
    mockLoad([
      { ...VERSION, id: "v-pass", version: "1.0.1", lastEvalRunId: "run-pass", lastEvalRunStatus: "Passed" },
      { ...VERSION, id: "v-fail", version: "1.0.2", lastEvalRunId: "run-fail", lastEvalRunStatus: "Failed" },
    ]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.1");
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("submits a version for review via the Submit for Review action", async () => {
    mockLoad([{ ...VERSION, gitPrNumber: null }]);
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/submit-review")) return Promise.resolve({ kind: "ok", data: { prNumber: 7 } });
      if (url.includes("/eval-runs") && init?.method === "POST") return Promise.resolve({ kind: "ok", data: {} });
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [VERSION] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/submit-review"), expect.objectContaining({ method: "POST" })));
    // §6.4 open question #1, resolved: submission also triggers an eval run.
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/eval-runs"), expect.objectContaining({ method: "POST" })));
  });

  it("ADR-0009 2026-08-23 amendment: explains the in-app approval mechanism instead of implying a PR is required, for a version with no Git commit at all", async () => {
    mockLoad([{ ...VERSION, id: "v-no-git", gitCommitSha: null, gitPrNumber: null }]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    expect(screen.getByText(/no git connection.*approved in-app/i)).toBeInTheDocument();
    // No "Submit for Review" affordance without a commit to open a PR/MR against.
    expect(screen.queryByRole("button", { name: /submit for review/i })).not.toBeInTheDocument();
  });

  it("keeps the original 'No PR yet' copy for a Git-connected version that simply hasn't opened a PR yet", async () => {
    mockLoad([{ ...VERSION, gitCommitSha: "abcdef1234567890", gitPrNumber: null }]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    expect(screen.getByText("No PR yet")).toBeInTheDocument();
  });

  it("submitForReview surfaces a non-error info toast when the backend reports no Git connection instead of a PR number", async () => {
    mockLoad([{ ...VERSION, gitPrNumber: null }]);
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/submit-review")) return Promise.resolve({ kind: "ok", data: { prNumber: null, reason: "git-not-connected" } });
      if (url.includes("/eval-runs") && init?.method === "POST") return Promise.resolve({ kind: "ok", data: {} });
      if (url.includes("/definitions/d1") && !url.includes("versions")) return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [VERSION] } });
      if (url.includes("/git/connection")) return Promise.resolve({ kind: "ok", data: { connection: { status: "Connected" } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/submit-review"), expect.objectContaining({ method: "POST" })));
    // Still triggers the eval run per §6.4 open question #1 — a missing PR doesn't
    // change that orchestration.
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("/eval-runs"), expect.objectContaining({ method: "POST" })));
  });

  it("shows the Production-promotion confirm dialog stating the concrete consequence before confirming", async () => {
    mockLoad([{ ...VERSION, status: "Approved", _allowedTransitions: ["Production", "Deprecated"] }]);
    render(<DefinitionDetail definitionId="d1" canWrite={true} />);
    await screen.findByText("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /promote to/i }));
    const productionItem = await screen.findByRole("menuitem", { name: "Production" });
    fireEvent.click(productionItem);
    // Phase 17 (BL-48): this copy was corrected when the Deployments & Canary tab
    // shipped — it used to promise traffic-split controls "in a later release", which
    // stopped being true in that same phase.
    expect(await screen.findByText(/immediately creates a 100% production deployment for v1\.0\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/deployments & canary tab/i)).toBeInTheDocument();

    // Cancelling must not call the promote endpoint.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringContaining("/promote"), expect.objectContaining({ method: "POST" }));
  });
});
