// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "./not-found.js";
import { NotFoundPage } from "@/src/lib/not-found-page";

describe("app/not-found.tsx (NFR-11 page-surface Defect 1)", () => {
  /**
   * The whole fix rests on there being exactly ONE not-found UI in the app: the app-wide
   * boundary and the ops catch-all must render the same component, so a denied
   * `/internal/ops/**` path and a genuinely nonexistent path cannot be told apart by
   * markup, `<title>`, or visible text. Asserting identical output (not just "it renders
   * something") is what would catch someone giving the boundary its own bespoke UI later.
   */
  it("renders exactly the shared NotFoundPage markup", () => {
    expect(renderToStaticMarkup(<NotFound />)).toBe(renderToStaticMarkup(<NotFoundPage />));
  });
});
