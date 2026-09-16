import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Building2 } from "lucide-react";
import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("image variant: root carries the accessible name, the inner <img> stays decorative", () => {
    render(<Avatar variant="image" src="/none.png" name="Sara Al Mazrouei" />);
    const root = screen.getByRole("img", { name: "Sara Al Mazrouei" });
    expect(root).toBeInTheDocument();
  });

  it("initials variant: renders computed initials and the accessible name", () => {
    render(<Avatar variant="initials" name="Sara Al Mazrouei" />);
    expect(screen.getByRole("img", { name: "Sara Al Mazrouei" })).toBeInTheDocument();
    expect(screen.getByText("SM")).toBeInTheDocument();
  });

  it("entity variant: renders the icon and uses `label` as the accessible name", () => {
    render(<Avatar variant="entity" icon={Building2} label="SEWA" />);
    expect(screen.getByRole("img", { name: "SEWA" })).toBeInTheDocument();
  });

  it("adjacentNameVisible makes the avatar decorative, not announced twice", () => {
    const { container } = render(
      <Avatar variant="initials" name="Sara Al Mazrouei" adjacentNameVisible />,
    );
    const root = container.querySelector('[data-slot="avatar"]');
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).not.toHaveAttribute("role");
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Avatar variant="initials" name="Sara Al Mazrouei" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
