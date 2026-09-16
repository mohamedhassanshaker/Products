/**
 * The real `PaymentGatewayRegistryRepository` — `PaymentGateways`, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  PaymentGatewayConfigRow,
  PaymentGatewayRegistryRepository,
} from "../../../ports/payment-gateway-registry-repository.js";

const OPERATION = "transactions payment-gateway registry";

function toRow(row: {
  id: string;
  key: string;
  name: string;
  methodsJson: string;
  mode: string;
  isEnabled: boolean;
  supportsRefunds: boolean;
}): PaymentGatewayConfigRow {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    methods: JSON.parse(row.methodsJson) as string[],
    mode: row.mode as "Live" | "Sandbox",
    isEnabled: row.isEnabled,
    supportsRefunds: row.supportsRefunds,
  };
}

export class PrismaPaymentGatewayRegistryRepository implements PaymentGatewayRegistryRepository {
  async list(): Promise<readonly PaymentGatewayConfigRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.paymentGateway.findMany();
    return rows.map(toRow);
  }

  async findByKey(key: string): Promise<PaymentGatewayConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.paymentGateway.findUnique({ where: { key } });
    return row ? toRow(row) : null;
  }

  async setEnabledMethods(input: {
    readonly key: string;
    readonly isEnabled: boolean;
    readonly methods: readonly string[];
    readonly now: Date;
  }): Promise<PaymentGatewayConfigRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.paymentGateway.update({
      where: { key: input.key },
      data: {
        isEnabled: input.isEnabled,
        methodsJson: JSON.stringify(input.methods),
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }
}
