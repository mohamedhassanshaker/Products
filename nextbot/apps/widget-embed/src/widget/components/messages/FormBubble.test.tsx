// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { FormBubble } from "./FormBubble.js";

describe("FormBubble (A.2.8)", () => {
  const payload = {
    contentType: "Form" as const,
    title: "Contact details",
    fields: [
      { name: "email", label: "Email", type: "email" as const, required: true },
      { name: "notes", label: "Notes", type: "textarea" as const },
    ],
    submitLabel: "Submit",
  };

  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    cleanup();
  });

  it("disables Submit until the required field is filled", () => {
    render(<FormBubble payload={payload} />);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("shows a field-targeted validation message on blur for an invalid email", () => {
    render(<FormBubble payload={payload} />);
    const emailInput = screen.getByLabelText(/^Email/);
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });
    fireEvent.blur(emailInput);
    expect(screen.getByText(/doesn't look like a valid email/i)).toBeInTheDocument();
  });

  it("enables Submit once the required field passes validation, and submits via the store", async () => {
    render(<FormBubble payload={payload} />);
    const emailInput = screen.getByLabelText(/^Email/);
    fireEvent.change(emailInput, { target: { value: "a@b.com" } });
    fireEvent.blur(emailInput);

    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(useWidgetStore.getState().send).toHaveBeenCalledWith("Form", { ...payload, values: { email: "a@b.com" } }));
    expect(await screen.findByText("✓ Submitted")).toBeInTheDocument();
  });

  it("does not render a file-upload field (deferred alongside A.2.14)", () => {
    render(
      <FormBubble
        payload={{
          ...payload,
          fields: [...payload.fields, { name: "attachment", label: "Attachment", type: "file" as const }],
        }}
      />,
    );
    expect(screen.queryByLabelText("Attachment")).not.toBeInTheDocument();
  });

  it("renders a select field with its options, and a custom regex pattern error", () => {
    const selectPayload = {
      contentType: "Form" as const,
      fields: [
        {
          name: "category",
          label: "Category",
          type: "select" as const,
          required: true,
          options: [
            { value: "billing", label: "Billing" },
            { value: "support", label: "Support" },
          ],
        },
        { name: "ref", label: "Reference code", type: "text" as const, pattern: "^REF-\\d+$" },
      ],
      submitLabel: "Submit",
    };
    render(<FormBubble payload={selectPayload} />);
    expect(screen.getByRole("option", { name: "Billing" })).toBeInTheDocument();

    const refInput = screen.getByLabelText(/^Reference code/);
    fireEvent.change(refInput, { target: { value: "nope" } });
    fireEvent.blur(refInput);
    expect(screen.getByText(/doesn't look like a valid reference code/i)).toBeInTheDocument();
  });

  it("shows the tool-call-failure alert and preserves entered values on a submit error, allowing retry", async () => {
    const sendMock = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(undefined);
    useWidgetStore.setState({ send: sendMock });
    render(<FormBubble payload={payload} />);

    const emailInput = screen.getByLabelText(/^Email/);
    fireEvent.change(emailInput, { target: { value: "a@b.com" } });
    fireEvent.blur(emailInput);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/logged this/i)).toBeInTheDocument();
    // The entered value survives the failed submit — retry doesn't force retyping.
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe("a@b.com");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("✓ Submitted")).toBeInTheDocument();
  });

  it("select and textarea fields update values on change/blur", () => {
    const mixedPayload = {
      contentType: "Form" as const,
      fields: [
        {
          name: "category",
          label: "Category",
          type: "select" as const,
          required: true,
          options: [{ value: "billing", label: "Billing" }],
        },
        { name: "notes", label: "Notes", type: "textarea" as const },
      ],
      submitLabel: "Submit",
    };
    render(<FormBubble payload={mixedPayload} />);

    const select = screen.getByLabelText(/^Category/);
    fireEvent.change(select, { target: { value: "billing" } });
    fireEvent.blur(select);

    const textarea = screen.getByLabelText(/^Notes/);
    fireEvent.change(textarea, { target: { value: "extra context" } });
    fireEvent.blur(textarea);

    expect((select as HTMLSelectElement).value).toBe("billing");
    expect((textarea as HTMLTextAreaElement).value).toBe("extra context");
  });

  it("renders already-submitted read-only when the disabled prop is set (an older message in history)", () => {
    render(<FormBubble payload={{ ...payload, values: { email: "old@example.com" } }} disabled />);
    expect(screen.getByText("✓ Submitted")).toBeInTheDocument();
    expect(screen.getByText(/old@example.com/)).toBeInTheDocument();
  });
});
