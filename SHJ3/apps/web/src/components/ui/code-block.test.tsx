import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CodeBlock } from "./code-block";

const SAMPLE_JSON = '{\n  "provider": "SEWA",\n  "confidence": 0.94\n}';

describe("CodeBlock", () => {
  it("renders the code as plain text, always dir=ltr, with no per-token markup", () => {
    const { container } = render(<CodeBlock code={SAMPLE_JSON} variant="json" />);
    const codeEl = container.querySelector("pre code");
    expect(codeEl).not.toBeNull();
    expect(codeEl?.textContent).toBe(SAMPLE_JSON);
    expect(codeEl?.closest("pre")).toHaveAttribute("dir", "ltr");
    // No syntax-highlighting spans — plain text content only, matching the
    // deliberate scope boundary documented in the component itself.
    expect(codeEl?.innerHTML).toBe(codeEl?.textContent);
  });

  it("defaults the header label from the variant, overridable via language", () => {
    const { rerender } = render(<CodeBlock code="print(1)" variant="snippet" />);
    expect(screen.getByText("Snippet")).toBeInTheDocument();
    rerender(<CodeBlock code="print(1)" variant="snippet" language="fetch_bill.py" />);
    expect(screen.getByText("fetch_bill.py")).toBeInTheDocument();
  });

  it("copies the exact code to the clipboard and announces confirmation in a live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CodeBlock code={SAMPLE_JSON} variant="json" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith(SAMPLE_JSON);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard"),
    );
  });

  it("has zero axe violations", async () => {
    const { container } = render(<CodeBlock code={SAMPLE_JSON} variant="trace" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
