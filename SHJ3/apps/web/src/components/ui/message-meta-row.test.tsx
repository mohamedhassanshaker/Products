import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { MessageMetaRow } from "./message-meta-row";

const TIMESTAMP = new Date("2026-09-08T11:42:00Z");

describe("MessageMetaRow — assistant", () => {
  it("renders three labelled IconButtons and a real <time> element", () => {
    render(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        rating={null}
        onRatingChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good response" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poor response" })).toBeInTheDocument();
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("datetime", TIMESTAMP.toISOString());
  });

  it("the rating toggle group is two-state via aria-pressed: selecting one presses it and un-presses the other", () => {
    const onRatingChange = vi.fn();
    const { rerender } = render(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        rating={null}
        onRatingChange={onRatingChange}
      />,
    );
    const up = screen.getByRole("button", { name: "Good response" });
    const down = screen.getByRole("button", { name: "Poor response" });
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(up);
    expect(onRatingChange).toHaveBeenCalledWith("up");

    rerender(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        rating="up"
        onRatingChange={onRatingChange}
      />,
    );
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(down).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the currently-active rating clears it rather than being a dead click", () => {
    const onRatingChange = vi.fn();
    render(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        rating="down"
        onRatingChange={onRatingChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Poor response" }));
    expect(onRatingChange).toHaveBeenCalledWith(null);
  });

  it("speaking relabels the read-aloud control, marks it pressed, and announces politely", () => {
    render(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        speaking
        rating={null}
        onRatingChange={vi.fn()}
      />,
    );
    const readAloud = screen.getByRole("button", { name: "Stop reading aloud" });
    expect(readAloud).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Reading message aloud");
  });

  it("has zero axe violations", async () => {
    const { container } = render(
      <MessageMetaRow
        variant="assistant"
        timestamp={TIMESTAMP}
        onReadAloud={vi.fn()}
        rating="up"
        onRatingChange={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("MessageMetaRow — user", () => {
  it("renders only the timestamp, no interactive controls", () => {
    render(<MessageMetaRow variant="user" timestamp={TIMESTAMP} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", TIMESTAMP.toISOString());
  });
});

describe("MessageMetaRow — system", () => {
  it("renders the note text alongside the timestamp", () => {
    render(
      <MessageMetaRow variant="system" timestamp={TIMESTAMP} note="Escalated to human agent" />,
    );
    expect(screen.getByText("Escalated to human agent")).toBeInTheDocument();
    expect(document.querySelector("time")).toBeInTheDocument();
  });
});
