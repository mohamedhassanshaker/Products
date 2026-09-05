// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("../../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { BrandingSettings } from "./BrandingSettings.js";

const BRANDING_OK = {
  kind: "ok",
  data: {
    branding: {
      brandingConfig: {
        primaryColor: "#4f46e5",
        secondaryColor: "#0e3b28",
        logoLightUrl: null,
        logoDarkUrl: null,
        faviconUrl: null,
        fontFamily: null,
      },
      whiteLabelEnabled: false,
    },
  },
};

describe("BrandingSettings (FR-ADM-07)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    routerRefreshMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<BrandingSettings />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("loads the current branding and shows the live preview", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");
    expect(screen.getByText("Widget launcher")).toBeInTheDocument();
    expect(screen.getByText("Widget window header")).toBeInTheDocument();
  });

  it("does not show the admin-chrome preview section until white-labeling is checked", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");
    expect(screen.queryByText(/Admin Console top bar/)).not.toBeInTheDocument();

    // Plan Phase 1 restyle swaps the Chakra `Checkbox` for shadcn's `Switch`
    // primitive (an ARIA `switch`, not `checkbox`) — same on/off semantics, a
    // different accessible role.
    fireEvent.click(screen.getByRole("switch", { name: /enable white-labeling/i }));
    expect(await screen.findByText(/Admin Console top bar/)).toBeInTheDocument();
  });

  it("saves successfully and shows a confirmation", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ branding: BRANDING_OK.data.branding }) }));
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    expect(await screen.findByText("Branding saved.")).toBeInTheDocument();
    // A successful save must revalidate the server-rendered admin shell (sidebar/
    // top-bar accent are computed per-navigation in `(admin)/layout.tsx`) — without
    // this, only this screen's own client-side preview reflects the new branding and
    // the persistent chrome is stuck on the old color until a manual reload.
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's contrast-failure message without crashing", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ title: "This color doesn't meet accessibility contrast requirements against a light surface." }),
      }),
    );
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't meet accessibility contrast/);
  });

  it("gives each hex-color text input its own accessible label, distinct from the color-swatch's label (QA Defect D4)", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    // Before the fix, the visible `Label htmlFor="branding-primary-color"` only wired
    // to the adjacent native color-swatch input — these text fields had no accessible
    // name at all. `getByLabelText` throws if no accessible name resolves, so a
    // passing query here is itself the regression check.
    const primaryHex = screen.getByLabelText("Primary color (hex value)") as HTMLInputElement;
    const secondaryHex = screen.getByLabelText("Secondary color (hex value)") as HTMLInputElement;
    expect(primaryHex).toHaveValue("#4f46e5");
    expect(secondaryHex).toHaveValue("#0e3b28");
  });

  it("updating the primary color hex field updates the launcher preview", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    const hexInputs = screen.getAllByDisplayValue("#4f46e5");
    fireEvent.change(hexInputs[0]!, { target: { value: "#ff0000" } });
    await waitFor(() => expect(screen.getAllByDisplayValue("#ff0000").length).toBeGreaterThan(0));
  });

  it("falls back to the built-in default branding when the tenant has never saved any (brandingConfig is null)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { branding: { brandingConfig: null, whiteLabelEnabled: false } } });
    render(<BrandingSettings />);
    await screen.findByText("Live preview");
    expect(screen.getAllByDisplayValue("#4f46e5").length).toBeGreaterThan(0);
  });

  it("ignores a file-input change event with no file selected", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    const input = screen.getByLabelText(/Logo \(SVG or PNG/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("NextBot")).toBeInTheDocument();
  });

  it("rejects a logo upload over the 2 MB limit with an explanatory error, without touching the current branding", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    const oversized = new File([new Uint8Array(3 * 1024 * 1024)], "logo.png", { type: "image/png" });
    const input = screen.getByLabelText(/Logo \(SVG or PNG/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/exceeds the 2 MB limit/i);
    // The wordmark fallback (no logo set) is still showing — the rejected upload
    // never reached `setBranding`.
    expect(screen.getByText("NextBot")).toBeInTheDocument();
  });

  it("rejects a non-SVG/PNG logo file type with an explanatory error", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    render(<BrandingSettings />);
    await screen.findByText("Live preview");

    const wrongType = new File(["not an image"], "logo.gif", { type: "image/gif" });
    const input = screen.getByLabelText(/Logo \(SVG or PNG/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [wrongType] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be an SVG or PNG/i);
  });

  it("uploads a valid PNG logo and updates the preview, falling back gracefully to no favicon when canvas rendering is unavailable (this test environment's real, documented fallback path — no `canvas` native module installed)", async () => {
    fetchJsonMock.mockResolvedValue(BRANDING_OK);
    // A minimal fake `Image` so `generateFaviconFromLogo`'s `img.onload` actually
    // fires in jsdom (which doesn't decode data: URLs) — `document.createElement
    // ("canvas").getContext("2d")` is left as jsdom's own real (null, since no
    // `canvas` package is installed) implementation, exercising the function's own
    // graceful-fallback branch rather than mocking it away.
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);

    render(<BrandingSettings />);
    await screen.findByText("Live preview");
    expect(screen.getByText("NextBot")).toBeInTheDocument();

    const logo = new File(["fake-png-bytes"], "logo.png", { type: "image/png" });
    const input = screen.getByLabelText(/Logo \(SVG or PNG/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [logo] } });

    // The wordmark fallback is replaced by the (now-set) logo Avatar once the
    // upload completes.
    await waitFor(() => expect(screen.queryByText("NextBot")).not.toBeInTheDocument());
  });
});
