/**
 * Meta Graph API client (WhatsApp Business Platform), plain `fetch` — no SDK, same
 * rationale as `agent-platform`'s `github-client.ts`/`gitlab-client.ts`: the surface
 * this product needs (business info, WABA phone numbers, message templates, sending
 * a message) is a handful of stable, documented REST endpoints, and staying
 * SDK-free keeps this fully explicit and trivially pointable at a local mock server
 * in tests (`packages/testing`'s `startMockMetaGraphServer`).
 *
 * **No real Meta App/System User credentials exist in this sandbox** (same
 * disclosed limitation as the Git provider clients and the LLM providers) — every
 * method below is implemented against Meta's real, documented Graph API v19.0 wire
 * shape and is exercised end-to-end in tests against a local mock server matching
 * that shape, not faked at every layer.
 */
export class MetaGraphTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MetaGraphTransportError";
  }
}

export interface MetaBusinessInfo {
  id: string;
  name: string;
}

export interface MetaPhoneNumber {
  id: string; // Graph "phone_number_id" — the path segment /{id}/messages uses
  display_phone_number: string;
  verified_name?: string;
  code_verification_status?: "VERIFIED" | "PENDING" | "NOT_VERIFIED";
  quality_rating?: string;
  messaging_limit_tier?: string; // e.g. "TIER_250", "TIER_1K", "TIER_10K", "TIER_100K" (Meta's own naming)
}

export interface MetaMessageTemplate {
  id: string;
  name: string;
  language: string;
  category?: string;
  status: "APPROVED" | "PENDING" | "REJECTED";
  components: Array<{ type: string; text?: string }>;
}

export interface MetaGraphClientOptions {
  accessToken: string;
  baseUrl?: string;
}

export function createMetaGraphClient(opts: MetaGraphClientOptions) {
  const apiBase = (opts.baseUrl ?? "https://graph.facebook.com/v19.0").replace(/\/$/, "");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${opts.accessToken}`,
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (cause) {
      throw new MetaGraphTransportError(`Meta Graph API ${init?.method ?? "GET"} ${path} failed: ${(cause as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new MetaGraphTransportError(
        `Meta Graph API ${init?.method ?? "GET"} ${path} failed with status ${response.status}: ${detail.slice(0, 500)}`,
        response.status,
      );
    }
    return response.json() as Promise<T>;
  }

  return {
    async getBusinessInfo(businessId: string): Promise<MetaBusinessInfo> {
      return call<MetaBusinessInfo>(`/${businessId}?fields=id,name`);
    },

    async listPhoneNumbers(wabaId: string): Promise<MetaPhoneNumber[]> {
      const result = await call<{ data: MetaPhoneNumber[] }>(
        `/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier`,
      );
      return result.data;
    },

    async listMessageTemplates(wabaId: string): Promise<MetaMessageTemplate[]> {
      const result = await call<{ data: MetaMessageTemplate[] }>(
        `/${wabaId}/message_templates?fields=id,name,language,category,status,components`,
      );
      return result.data;
    },

    /** `POST /{phone-number-id}/messages` — the real WhatsApp Cloud API send
     * endpoint's documented request shape. `payload` is already the exact Graph API
     * JSON body (text / interactive-buttons / template) — this client is a thin
     * transport, all business logic (24h window, button-limit truncation) lives in
     * `adapter.ts`, upstream of this call. */
    async sendMessage(phoneNumberId: string, payload: Record<string, unknown>): Promise<{ messages: Array<{ id: string }> }> {
      return call(`/${phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      });
    },
  };
}
export type MetaGraphClient = ReturnType<typeof createMetaGraphClient>;
