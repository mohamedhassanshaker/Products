// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OfflineBanner } from "./OfflineBanner.js";

describe("OfflineBanner (FR-OC-01 exact boundary-case copy)", () => {
  afterEach(() => cleanup());

  it("renders the exact spec copy with role=status", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("You're offline — messages will send once you're back online.");
  });
});
