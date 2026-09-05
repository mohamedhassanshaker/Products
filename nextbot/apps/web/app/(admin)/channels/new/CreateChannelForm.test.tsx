// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { CreateChannelForm } from "./CreateChannelForm.js";

describe("CreateChannelForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
    cleanup();
  });

  it("submits the form and navigates to /channels on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ channel: { id: "c1" } }) }));
    render(<CreateChannelForm />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Main Widget" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/channels"));
  });

  it("surfaces a server-side error without navigating away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "A channel named 'Main Widget' already exists in this environment." }) }),
    );
    render(<CreateChannelForm />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Main Widget" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a validation error for an empty name", async () => {
    render(<CreateChannelForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    expect(await screen.findByText(/name/i)).toBeInTheDocument();
  });
});
