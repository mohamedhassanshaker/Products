// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { CreateWhatsAppChannelForm } from "./CreateWhatsAppChannelForm.js";

describe("CreateWhatsAppChannelForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
    cleanup();
  });

  it("submits with type=WhatsApp and routes to the WhatsApp config screen for the new channel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ channel: { id: "chan-abc" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateWhatsAppChannelForm />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Main WhatsApp Line" } });
    fireEvent.click(screen.getByRole("button", { name: /continue to whatsapp setup/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/channels/chan-abc/whatsapp"));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ type: "WhatsApp", name: "Main WhatsApp Line" });
  });

  it("surfaces a server-side error without navigating away", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "A channel named 'X' already exists in this environment." }) }));
    render(<CreateWhatsAppChannelForm />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Main WhatsApp Line" } });
    fireEvent.click(screen.getByRole("button", { name: /continue to whatsapp setup/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
