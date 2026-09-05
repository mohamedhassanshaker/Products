// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotFoundPage } from "./not-found-page.js";

afterEach(() => cleanup());

describe("NotFoundPage (NFR-11 page-surface Defect 1 — the app's one not-found UI)", () => {
  it("renders the shared 404 heading and message", () => {
    render(<NotFoundPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
    expect(screen.getByText("This page could not be found.")).toBeInTheDocument();
  });

  it("takes no props", () => {
    expect(NotFoundPage.length).toBe(0);
  });

  /**
   * The load-bearing property: the markup must be byte-identical every time it is
   * rendered. Any per-render variation (a `useId`, a timestamp, a random key) would both
   * give an attacker something to diff between a denied real ops path and a genuinely
   * nonexistent one, and force the app-wide not-found off its single prerendered entry —
   * which is what makes every genuine 404 in this app share one body and one `ETag`.
   */
  it("produces identical markup on every render", () => {
    const renders = [renderToStaticMarkup(<NotFoundPage />), renderToStaticMarkup(<NotFoundPage />), renderToStaticMarkup(<NotFoundPage />)];
    expect(new Set(renders).size).toBe(1);
  });

  it("leaks nothing about the ops console or which check denied a caller", () => {
    const markup = renderToStaticMarkup(<NotFoundPage />);
    for (const forbidden of ["ops", "internal", "tenant", "login", "token", "allowlist", "denied", "forbidden", "unauthorized"]) {
      expect(markup.toLowerCase()).not.toContain(forbidden);
    }
  });
});
