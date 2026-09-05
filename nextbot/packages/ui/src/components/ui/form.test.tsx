// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "./form.js";
import { Input } from "./input.js";

/** Minimal RHF-wired harness mirroring how real call sites (e.g.
 * `ConnectorWizard.tsx`) wire `Form`/`FormField`/`FormControl`. */
function Harness({ withDescription }: { withDescription: boolean }) {
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              {withDescription && <FormDescription>Some helper text.</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * QA fix regression test (Batch C retry 1, Defect 3).
 *
 * `FormControl` used to always wire `aria-describedby` to a
 * `{id}-form-item-description` id, even when no `FormDescription` was
 * rendered for that field — a dangling ARIA IDREF (every field in
 * `ConnectorWizard.tsx` hit this, since none of them render a
 * `FormDescription`). This proves `aria-describedby` only references the
 * description id when a `FormDescription` is actually present.
 */
describe("FormControl — aria-describedby only references an id that actually exists", () => {
  afterEach(() => cleanup());

  it("omits the description id from aria-describedby when no FormDescription is rendered", () => {
    render(<Harness withDescription={false} />);
    const input = screen.getByRole("textbox");
    // No FormDescription rendered — aria-describedby must either be absent or,
    // if present (e.g. for an error message id), must not reference the
    // nonexistent description id.
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toMatch(/-form-item-description/);
  });

  it("includes the description id in aria-describedby when a FormDescription is rendered, and that id exists in the DOM", () => {
    render(<Harness withDescription={true} />);
    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const descriptionId = describedBy.split(" ").find((id) => id.endsWith("-form-item-description"));
    expect(descriptionId).toBeDefined();
    expect(document.getElementById(descriptionId as string)).toBeInTheDocument();
  });
});
