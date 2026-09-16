/**
 * `PaymentGateways` — B11 tab 3's two config rows: which gateways exist, which
 * methods they support, `Live` vs `Sandbox`, whether refunds are supported.
 *
 * Not to be confused with `ports/payment-gateway.ts`'s `PaymentGateway` — that
 * is the runtime port a payment actually flows through; this is the registry
 * a `Super Admin` configures (api.md §6.11).
 */

export interface PaymentGatewayConfigRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly methods: readonly string[];
  readonly mode: "Live" | "Sandbox";
  readonly isEnabled: boolean;
  readonly supportsRefunds: boolean;
}

export type SwitchGatewayModeResult =
  | { readonly ok: true; readonly gateway: PaymentGatewayConfigRow }
  | {
      readonly ok: false;
      /** FR-PAY-09/ADR-0006 rule 6's own payments analogue — a Sandbox gateway may never process a production payment. */
      readonly reason:
        "payments.sandbox_forbidden_in_production" | "payments.connectivity_check_required";
    };

export interface PaymentGatewayRegistryRepository {
  list(): Promise<readonly PaymentGatewayConfigRow[]>;
  findByKey(key: string): Promise<PaymentGatewayConfigRow | null>;
  setEnabledMethods(input: {
    readonly key: string;
    readonly isEnabled: boolean;
    readonly methods: readonly string[];
    readonly now: Date;
  }): Promise<PaymentGatewayConfigRow>;
}
