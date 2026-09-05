// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../store.js";
import { LanguageModal } from "./LanguageModal.js";

describe("LanguageModal (A.1.4)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ languageModalOpen: true, selectLanguage: vi.fn().mockResolvedValue(undefined), closeLanguageModal: vi.fn() });
  });
  afterEach(() => cleanup());

  it("renders each language in its own script/demonym", () => {
    render(<LanguageModal />);
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "العربية" })).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    useWidgetStore.setState({ languageModalOpen: false });
    render(<LanguageModal />);
    expect(screen.queryByText("Choose a language")).not.toBeInTheDocument();
  });

  it("tapping a language calls selectLanguage with its code", () => {
    render(<LanguageModal />);
    fireEvent.click(screen.getByRole("button", { name: "العربية" }));
    expect(useWidgetStore.getState().selectLanguage).toHaveBeenCalledWith("ar");
  });

  it("notes that existing messages won't be translated", () => {
    render(<LanguageModal />);
    expect(screen.getByText(/won't be translated/)).toBeInTheDocument();
  });
});
