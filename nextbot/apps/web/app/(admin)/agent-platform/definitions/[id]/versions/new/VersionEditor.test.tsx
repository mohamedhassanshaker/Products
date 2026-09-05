// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
// Phase 7 (client-feedback-batch item 6): `?fromVersionId=` drives the Restore
// pre-fill path — each test controls it via this mutable holder rather than a
// fixed empty default, so the Restore-specific tests below can opt in without a
// second `vi.mock` factory (module factories can't reference an outer `let`
// declared after them, so this is set/reset via `searchParamsValue`, mirroring
// `git-callback/page.test.tsx`'s own established pattern for the same primitive).
let searchParamsValue = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

import { VersionEditor } from "./VersionEditor.js";

// A minimal, schema-valid artifact YAML (matches `AgentDefinitionArtifactSchema`) —
// used by the one Restore test below that actually submits, since `handleSubmit`
// runs the restored content through the same TypeBox validation as a freshly
// scaffolded version.
const VALID_ARTIFACT_YAML = `apiVersion: nextbot.io/v1
kind: AgentDefinition
metadata:
  name: support-triage
  version: 1.0.0
spec:
  graphType: ADK
  modelRoute: chat.primary
  instructions: You are a helpful support agent.
  toolPolicy:
    source: agent-tool-registry
    capabilityGroups: []
    maxToolCallsPerTurn: 5
  guardrails:
    minConfidenceForAutonomy: 0.6
    escalateOn: []
  memory:
    strategy: rolling-window
    maxTurns: 20
  budgets:
    maxCostUsdPerConversation: "0.50"
    maxLatencyMsP95: 6000
`;

describe("VersionEditor (BL-07, UX_GUIDELINES.md §6.4 — plain YAML authoring, immutable versions)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    pushMock.mockReset();
    searchParamsValue = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
  });

  it("pre-fills a scaffold YAML template once the definition name loads", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definition: { name: "support-triage" } } });
    render(<VersionEditor definitionId="d1" />);
    const editor = await screen.findByLabelText(/agent definition yaml editor/i);
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("name: support-triage"));
  });

  it("shows structured TypeBox validation errors for invalid YAML instead of submitting", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definition: { name: "support-triage" } } });
    render(<VersionEditor definitionId="d1" />);
    const editor = await screen.findByLabelText(/agent definition yaml editor/i);
    fireEvent.change(editor, { target: { value: "not: valid: at: all: yaml: [" } });
    fireEvent.click(screen.getByRole("button", { name: /create version/i }));
    expect(await screen.findByText("Validation errors")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringContaining("/versions"), expect.objectContaining({ method: "POST" }));
  });

  it("humanizes a real YAML parse error instead of showing js-yaml's raw parser output (QA Defect U3)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definition: { name: "support-triage" } } });
    render(<VersionEditor definitionId="d1" />);
    const editor = await screen.findByLabelText(/agent definition yaml editor/i);
    // A genuine bad-indentation parse error (not a TypeBox schema error) — js-yaml's
    // raw message for this looks like `bad indentation of a mapping entry (3:4)` plus
    // a caret-diagram snippet.
    fireEvent.change(editor, { target: { value: "a:\n b: c\n  d: e\n" } });
    fireEvent.click(screen.getByRole("button", { name: /create version/i }));
    expect(await screen.findByText(/there's a syntax error in your yaml/i)).toBeInTheDocument();
    expect(screen.queryByText(/bad indentation/i)).not.toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringContaining("/versions"), expect.objectContaining({ method: "POST" }));
  });

  it("submits a valid artifact and navigates to the new version's detail page", async () => {
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ kind: "ok", data: { version: { id: "v-new" } } });
      return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
    });
    render(<VersionEditor definitionId="d1" />);
    await screen.findByLabelText(/agent definition yaml editor/i);
    fireEvent.click(screen.getByRole("button", { name: /create version/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/agent-platform/versions/v-new"));
  });

  it("surfaces GIT_CONNECTION_UNAVAILABLE without discarding the editor's content (a genuinely broken *configured* connection — still a blocking error)", async () => {
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ kind: "error", status: 409, message: "Git connection unavailable — reconnect in Settings." });
      return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
    });
    render(<VersionEditor definitionId="d1" />);
    const editor = await screen.findByLabelText(/agent definition yaml editor/i);
    const originalContent = (editor as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole("button", { name: /create version/i }));
    expect(await screen.findByText(/git connection unavailable/i)).toBeInTheDocument();
    expect(editor).toHaveValue(originalContent);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ADR-0009 2026-08-23 amendment: succeeds and shows a non-blocking info banner (never navigates away silently) when the tenant has no Git connection configured at all", async () => {
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ kind: "ok", data: { version: { id: "v-no-git", gitCommitSha: null } } });
      return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
    });
    render(<VersionEditor definitionId="d1" />);
    await screen.findByLabelText(/agent definition yaml editor/i);
    fireEvent.click(screen.getByRole("button", { name: /create version/i }));
    expect(await screen.findByText(/not synced to git/i)).toBeInTheDocument();
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
    // Non-blocking: creation already succeeded — the user can still get to the
    // version, just via an explicit link rather than an automatic redirect that
    // would have hidden the banner they need to see.
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /continue to version/i })).toHaveAttribute("href", "/agent-platform/versions/v-no-git");
  });

  describe("Design/Text mode toggle (Phase 9, client-feedback-batch item 7)", () => {
    // Phase 10 (client-feedback-batch item 8): entering Design mode now also fires
    // `DesignModeForm`'s own `GET /api/v1/admin/tools/capability-groups` fetch through
    // this same mocked `fetchJson` helper — a single `mockResolvedValue` shaped only
    // for the definition-name fetch would resolve that call too and crash the picker
    // (`capabilityGroups` would be `undefined`, not `[]`), so every test in this
    // describe block discriminates by URL instead.
    function mockFetchForDesignMode() {
      fetchJsonMock.mockImplementation((url: string) => {
        if (url.includes("/capability-groups")) return Promise.resolve({ kind: "ok", data: { capabilityGroups: [] } });
        return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      });
    }

    it("defaults to the Text tab, with Design reachable by clicking its tab", async () => {
      mockFetchForDesignMode();
      render(<VersionEditor definitionId="d1" />);
      await screen.findByLabelText(/agent definition yaml editor/i);
      expect(screen.getByRole("tab", { name: "Text", selected: true })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Design" }));
      expect(screen.getByRole("tab", { name: "Design", selected: true })).toBeInTheDocument();
      expect(await screen.findByRole("combobox", { name: "Graph type" })).toBeInTheDocument();
    });

    it("switching Text -> Design -> Text without editing anything leaves the YAML text unchanged", async () => {
      mockFetchForDesignMode();
      render(<VersionEditor definitionId="d1" />);
      const editor = (await screen.findByLabelText(/agent definition yaml editor/i)) as HTMLTextAreaElement;
      const originalValue = editor.value;

      fireEvent.click(screen.getByRole("tab", { name: "Design" }));
      await screen.findByRole("combobox", { name: "Graph type" });
      fireEvent.click(screen.getByRole("tab", { name: "Text" }));

      const editorAgain = (await screen.findByLabelText(/agent definition yaml editor/i)) as HTMLTextAreaElement;
      expect(editorAgain.value).toBe(originalValue);
    });

    it("an edit made in Design mode is reflected back in Text mode's YAML after switching tabs", async () => {
      mockFetchForDesignMode();
      render(<VersionEditor definitionId="d1" />);
      await screen.findByLabelText(/agent definition yaml editor/i);

      fireEvent.click(screen.getByRole("tab", { name: "Design" }));
      const instructions = await screen.findByLabelText(/system instructions/i);
      fireEvent.change(instructions, { target: { value: "You are a billing specialist." } });
      // Wait for the design form's change-subscription effect to propagate up.
      await waitFor(() => expect(screen.queryByLabelText(/system instructions/i)).toHaveValue("You are a billing specialist."));

      fireEvent.click(screen.getByRole("tab", { name: "Text" }));
      const editor = (await screen.findByLabelText(/agent definition yaml editor/i)) as HTMLTextAreaElement;
      await waitFor(() => expect(editor.value).toContain("You are a billing specialist."));
    });

    it("editing in Text mode is reflected in Design mode's fields after switching tabs", async () => {
      mockFetchForDesignMode();
      render(<VersionEditor definitionId="d1" />);
      const editor = await screen.findByLabelText(/agent definition yaml editor/i);
      fireEvent.change(editor, { target: { value: VALID_ARTIFACT_YAML.replace("chat.primary", "chat.fast") } });

      fireEvent.click(screen.getByRole("tab", { name: "Design" }));
      expect(await screen.findByRole("combobox", { name: "Model route" })).toHaveTextContent("chat.fast");
    });
  });

  describe("Restore (Phase 7, client-feedback-batch item 6) — pre-fills from an old version's real content, never a blank scaffold", () => {
    beforeEach(() => {
      searchParamsValue = new URLSearchParams({ fromVersionId: "v-old" });
    });

    it("pre-fills the YAML/graphType/modelRouteKey from the source version and suggests a bumped patch version", async () => {
      fetchJsonMock.mockImplementation((url: string) => {
        if (url.includes("/versions/v-old")) {
          return Promise.resolve({
            kind: "ok",
            data: { version: { version: "1.2.3", graphType: "CustomFSM", modelRouteKey: "chat.fast", definitionYaml: "apiVersion: nextbot.io/v1\nkind: AgentDefinition\n" } },
          });
        }
        return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      });
      render(<VersionEditor definitionId="d1" />);
      const editor = await screen.findByLabelText(/agent definition yaml editor/i);
      await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe("apiVersion: nextbot.io/v1\nkind: AgentDefinition\n"));
      // Never the blank scaffold's own boilerplate content.
      expect((editor as HTMLTextAreaElement).value).not.toContain("You are a helpful support agent.");
      expect(screen.getByLabelText(/^version$/i)).toHaveValue("1.2.4");
      expect(screen.getByText(/restoring content from an earlier version/i)).toBeInTheDocument();
    });

    it("falls back to a non-colliding '-restored' suffix when the source version label isn't semver-shaped", async () => {
      fetchJsonMock.mockImplementation((url: string) => {
        if (url.includes("/versions/v-old")) {
          return Promise.resolve({ kind: "ok", data: { version: { version: "not-semver", graphType: "ADK", modelRouteKey: "chat.primary", definitionYaml: "a: b\n" } } });
        }
        return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      });
      render(<VersionEditor definitionId="d1" />);
      await screen.findByLabelText(/agent definition yaml editor/i);
      await waitFor(() => expect(screen.getByLabelText(/^version$/i)).toHaveValue("not-semver-restored"));
    });

    it("creates a genuinely new version (POST, never a PATCH/PUT against the old version's id) when submitting a restored draft", async () => {
      // A schema-valid artifact (unlike the other Restore tests above, which never
      // submit) — `handleSubmit` runs this through the same TypeBox validation as a
      // freshly-scaffolded version, so the restored YAML must actually conform.
      fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/versions/v-old")) {
          return Promise.resolve({ kind: "ok", data: { version: { version: "1.0.0", graphType: "ADK", modelRouteKey: "chat.primary", definitionYaml: VALID_ARTIFACT_YAML } } });
        }
        if (init?.method === "POST") return Promise.resolve({ kind: "ok", data: { version: { id: "v-restored-new" } } });
        return Promise.resolve({ kind: "ok", data: { definition: { name: "support-triage" } } });
      });
      render(<VersionEditor definitionId="d1" />);
      await screen.findByLabelText(/agent definition yaml editor/i);
      await waitFor(() => expect(screen.getByLabelText(/^version$/i)).toHaveValue("1.0.1"));
      fireEvent.click(screen.getByRole("button", { name: /create version/i }));
      await waitFor(() =>
        expect(fetchJsonMock).toHaveBeenCalledWith(
          "/api/v1/admin/agent-platform/definitions/d1/versions",
          expect.objectContaining({ method: "POST" }),
        ),
      );
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/agent-platform/versions/v-restored-new"));
    });
  });
});
