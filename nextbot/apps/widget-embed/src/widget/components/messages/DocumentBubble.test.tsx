// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DocumentBubble } from "./DocumentBubble.js";

describe("DocumentBubble (Phase 12 / FR-MCP-07)", () => {
  afterEach(() => cleanup());

  it("renders a link to the document with mime type and formatted size", () => {
    render(
      <DocumentBubble
        payload={{ contentType: "Document", title: "Invoice #99.pdf", url: "https://files.example.com/inv99.pdf", mimeType: "application/pdf", sizeBytes: 204800 }}
      />,
    );
    const link = screen.getByRole("link", { name: "Invoice #99.pdf" });
    expect(link).toHaveAttribute("href", "https://files.example.com/inv99.pdf");
    expect(screen.getByText("application/pdf · 200.0 KB")).toBeInTheDocument();
  });
});
