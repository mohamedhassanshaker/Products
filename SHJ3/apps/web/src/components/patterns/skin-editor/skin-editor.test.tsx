import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { semanticColors } from "@shj3/tokens";
import enMessages from "../../../../messages/en.json";
import { SkinEditor, type SkinEditorActions, type SkinEditorProps } from "./skin-editor.js";
import type {
  SkinEditorBrandAssets,
  SkinEditorBrandingScalars,
  SkinEditorPersonalPreference,
} from "./skin-editor-types.js";

// SkinEditor renders a real SubTabBar (the five editing sections), which calls
// use-url-synced-value.ts's next/navigation hooks unconditionally on every render
// even with urlParam={null} — mocked module-wide, matching sub-tab-bar.test.tsx's
// own established pattern, so SkinEditor can render outside a real Next.js router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/en/settings/appearance",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function branding(): SkinEditorBrandingScalars {
  return {
    appTitle: "Test Tenant",
    defaultMode: "System",
    defaultDirection: "LTR",
    density: "Comfortable",
    fontSize: "0.875rem",
    shadowDepth: "1",
    sidebarStyle: "neutral",
  };
}

function personal(): SkinEditorPersonalPreference {
  return { mode: null, density: null, direction: null, fontSize: null, reducedMotion: null };
}

function brandAssets(): SkinEditorBrandAssets {
  return { logoLightUrl: null, logoDarkUrl: null, faviconUrl: null };
}

function renderEditor(
  overrides: Partial<SkinEditorProps> = {},
  actionOverrides: Partial<SkinEditorActions> = {},
) {
  const actions: SkinEditorActions = {
    saveTenantAppearance: vi
      .fn()
      .mockResolvedValue({ ok: true, skinId: "skin-1", lightReport: null, darkReport: null }),
    applyTenantSkin: vi.fn().mockResolvedValue(undefined),
    applyPersonalSkin: vi.fn().mockResolvedValue(undefined),
    duplicateTenantSkin: vi.fn().mockResolvedValue(undefined),
    renameTenantSkin: vi.fn().mockResolvedValue(undefined),
    deleteTenantSkin: vi.fn().mockResolvedValue({ blocked: false }),
    exportTenantSkin: vi.fn().mockResolvedValue(undefined),
    importSkinMode: vi.fn(),
    savePersonalPreference: vi.fn().mockResolvedValue(undefined),
    uploadBrandAsset: vi.fn().mockResolvedValue({ ok: true, url: "/uploads/brand-assets/t/x.png" }),
    ...actionOverrides,
  };

  const props: SkinEditorProps = {
    canManageTenantAppearance: true,
    resetHref: "/en/settings/appearance/reset",
    initialEditingSkinId: null,
    initialSkinName: "My Organisation",
    initialSkinDescription: null,
    initialLight: semanticColors.light,
    initialDark: semanticColors.dark,
    initialBranding: branding(),
    initialBrandAssets: brandAssets(),
    hasTenantBranding: true,
    initialPersonal: personal(),
    skins: [],
    actions,
    ...overrides,
  };

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SkinEditor {...props} />
    </NextIntlClientProvider>,
  );

  return { actions };
}

function primaryColorInput(): HTMLInputElement {
  const el = document.getElementById("skin-editor-brand-primary");
  if (!el) throw new Error("primary color field not found");
  return el as HTMLInputElement;
}

describe("SkinEditor — light/dark independent edit and save (§9.2 rule 6)", () => {
  it("editing light, switching to dark, editing dark, then Save sends BOTH edits in one call", async () => {
    const { actions } = renderEditor();

    // Editing mode defaults to light.
    fireEvent.change(primaryColorInput(), { target: { value: "#111111" } });
    expect(primaryColorInput().value).toBe("#111111");

    // Switch the editing/preview mode to dark.
    fireEvent.click(screen.getByLabelText("Dark", { selector: "button" }));

    // The dark-mode primary field now shows dark's own value, not light's edit —
    // proving the panes genuinely swapped rather than sharing one text field.
    await waitFor(() => expect(primaryColorInput().value).toBe(semanticColors.dark.primary));
    fireEvent.change(primaryColorInput(), { target: { value: "#222222" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.saveTenantAppearance).toHaveBeenCalledTimes(1));
    const calls = (actions.saveTenantAppearance as ReturnType<typeof vi.fn>).mock.calls;
    const firstCall = calls[0];
    if (!firstCall) throw new Error("unreachable — toHaveBeenCalledTimes(1) asserted above");
    const call = firstCall[0];
    // Both edits present simultaneously in the ONE atomic save call — rule 1 (atomic)
    // and rule 6 (independent modes) proven together, the way they actually compose.
    expect(call.light.primary).toBe("#111111");
    expect(call.dark.primary).toBe("#222222");
  });
});

describe("SkinEditor — contrast gate genuinely blocks a bad save", () => {
  it("a rejected save renders the real failing pairs and does not clear the unsaved badge", async () => {
    const badReport = {
      checks: [],
      passed: false,
      blockers: [
        {
          pair: {
            fg: "foreground",
            bg: "background",
            class: "text" as const,
            note: "Body text on the page ground",
          },
          foreground: "#000000",
          background: "#000000",
          ratio: 1,
          required: 4.5,
          passed: false,
          blocking: true,
        },
      ],
      warnings: [],
    };
    const { actions } = renderEditor(
      {},
      {
        saveTenantAppearance: vi
          .fn()
          .mockResolvedValue({ ok: false, lightReport: badReport, darkReport: null }),
      },
    );

    fireEvent.change(primaryColorInput(), { target: { value: "#000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.saveTenantAppearance).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/is not readable enough/i)).toBeInTheDocument();
    expect(screen.getByText("Body text on the page ground")).toBeInTheDocument();
    // Still marked unsaved: the whole point of blocking rather than warning is that
    // nothing was persisted, so the dirty state must not have been cleared.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});

describe("SkinEditor — the never-half-applied navigation guard", () => {
  it("registers a real beforeunload listener once dirty, and removes it once clean again", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    renderEditor();
    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));

    fireEvent.change(primaryColorInput(), { target: { value: "#333333" } });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("clicking the Reset-to-default link while dirty raises a confirmation instead of navigating immediately", () => {
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    // jsdom's window.location is not directly reassignable; stub navigation via a
    // configurable property, restored in afterEach's vi.restoreAllMocks (spy) plus
    // an explicit restore here since this is a full property replace, not a spy.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignSpy },
    });

    renderEditor();
    fireEvent.change(primaryColorInput(), { target: { value: "#444444" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.getByText("Leave with unsaved changes?")).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Leave and discard" }));
    expect(assignSpy).toHaveBeenCalledWith("/en/settings/appearance/reset");

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});

describe("SkinEditor — discard reverts by closure, not refetch", () => {
  it("discard restores the pre-edit colour and clears the unsaved badge", async () => {
    renderEditor();

    fireEvent.change(primaryColorInput(), { target: { value: "#555555" } });
    expect(primaryColorInput().value).toBe("#555555");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(primaryColorInput().value).toBe(semanticColors.light.primary);
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
