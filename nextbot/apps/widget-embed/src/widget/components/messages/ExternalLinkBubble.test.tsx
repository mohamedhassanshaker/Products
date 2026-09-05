// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExternalLinkBubble } from "./ExternalLinkBubble.js";

describe("ExternalLinkBubble (Phase 12 / FR-MCP-07)", () => {
  afterEach(() => cleanup());

  it("renders the link with title and optional description", () => {
    render(
      <ExternalLinkBubble
        payload={{ contentType: "ExternalLink", title: "Track your shipment", url: "https://carrier.example.com/track/1", description: "Opens the carrier's site" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Track your shipment ↗" });
    expect(link).toHaveAttribute("href", "https://carrier.example.com/track/1");
    expect(screen.getByText("Opens the carrier's site")).toBeInTheDocument();
  });
});
