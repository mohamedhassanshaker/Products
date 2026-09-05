// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SsoGroupMappingSection } from "./SsoGroupMappingSection.js";

afterEach(() => cleanup());

describe("SsoGroupMappingSection", () => {
  it("renders an honest 'not yet configured' placeholder rather than a fabricated config form", () => {
    render(<SsoGroupMappingSection />);
    expect(screen.getByRole("heading", { level: 2, name: /sso & group mapping/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/isn.t configured for this tenant yet/i);
  });
});
