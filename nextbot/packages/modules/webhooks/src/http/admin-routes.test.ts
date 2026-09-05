import { describe, expect, it, vi } from "vitest";

const subscribeToWebhooksMock = vi.fn();
const listSubscriptionsMock = vi.fn();
const updateSubscriptionMock = vi.fn();
const unsubscribeMock = vi.fn();
const getWebhookSubscriptionMock = vi.fn();
const listDeliveriesForSubscriptionMock = vi.fn();

vi.mock("../application/webhook-subscription-service.js", () => ({
  subscribeToWebhooks: (...args: unknown[]) => subscribeToWebhooksMock(...args),
  listSubscriptions: (...args: unknown[]) => listSubscriptionsMock(...args),
  updateSubscription: (...args: unknown[]) => updateSubscriptionMock(...args),
  unsubscribe: (...args: unknown[]) => unsubscribeMock(...args),
}));
vi.mock("../infrastructure/webhook-subscription-repository.js", () => ({
  getWebhookSubscription: (...args: unknown[]) => getWebhookSubscriptionMock(...args),
}));
vi.mock("../infrastructure/webhook-delivery-repository.js", () => ({
  listDeliveriesForSubscription: (...args: unknown[]) => listDeliveriesForSubscriptionMock(...args),
}));

const ctx = { tenantId: "tenant-1", region: "US" as const, environment: "Sandbox" as const };

describe("webhooks http/admin-routes (unit, mocked application layer)", () => {
  it("handleListWebhookSubscriptions delegates to the application service", async () => {
    listSubscriptionsMock.mockResolvedValue([{ id: "sub-1" }]);
    const { handleListWebhookSubscriptions } = await import("./admin-routes.js");
    await expect(handleListWebhookSubscriptions(ctx)).resolves.toEqual([{ id: "sub-1" }]);
    expect(listSubscriptionsMock).toHaveBeenCalledWith(ctx);
  });

  it("handleCreateWebhookSubscription forwards the created-by user id", async () => {
    subscribeToWebhooksMock.mockResolvedValue({ subscription: { id: "sub-1" }, signingSecret: "secret" });
    const { handleCreateWebhookSubscription } = await import("./admin-routes.js");
    await handleCreateWebhookSubscription(ctx, { targetUrl: "https://example.com", eventCategories: ["EscalationCreated"] }, "user-1");
    expect(subscribeToWebhooksMock).toHaveBeenCalledWith(ctx, { targetUrl: "https://example.com", eventCategories: ["EscalationCreated"], createdByUserId: "user-1" });
  });

  it("handleUpdateWebhookSubscription delegates to updateSubscription", async () => {
    updateSubscriptionMock.mockResolvedValue({ id: "sub-1", enabled: false });
    const { handleUpdateWebhookSubscription } = await import("./admin-routes.js");
    await handleUpdateWebhookSubscription(ctx, "sub-1", { enabled: false });
    expect(updateSubscriptionMock).toHaveBeenCalledWith(ctx, "sub-1", { enabled: false });
  });

  it("handleDeleteWebhookSubscription delegates to unsubscribe", async () => {
    unsubscribeMock.mockResolvedValue(undefined);
    const { handleDeleteWebhookSubscription } = await import("./admin-routes.js");
    await handleDeleteWebhookSubscription(ctx, "sub-1");
    expect(unsubscribeMock).toHaveBeenCalledWith(ctx, "sub-1");
  });

  it("handleListWebhookDeliveries throws WebhookSubscriptionNotFoundError for an unknown subscription, without listing anything", async () => {
    getWebhookSubscriptionMock.mockResolvedValue(null);
    const { handleListWebhookDeliveries } = await import("./admin-routes.js");
    await expect(handleListWebhookDeliveries(ctx, "missing")).rejects.toThrow();
    expect(listDeliveriesForSubscriptionMock).not.toHaveBeenCalled();
  });

  it("handleListWebhookDeliveries lists deliveries for a real subscription", async () => {
    getWebhookSubscriptionMock.mockResolvedValue({ id: "sub-1" });
    listDeliveriesForSubscriptionMock.mockResolvedValue([{ id: "delivery-1" }]);
    const { handleListWebhookDeliveries } = await import("./admin-routes.js");
    await expect(handleListWebhookDeliveries(ctx, "sub-1")).resolves.toEqual([{ id: "delivery-1" }]);
  });
});
