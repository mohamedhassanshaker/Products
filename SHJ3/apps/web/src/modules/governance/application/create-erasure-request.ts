import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type {
  ErasureRequestRepository,
  ErasureRequestRow,
} from "../ports/erasure-request-repository.js";

export interface CreateErasureRequestInput {
  readonly subjectKind: string;
  readonly subjectHash: string;
  readonly citizenIdentityId: string | null;
  readonly receivedVia: string;
  readonly actor: Principal;
  readonly now: Date;
}

/** B14 tab 4's "right to be forgotten" intake (FR-GOV-22). Records the request and
 *  audits its receipt; `ProcessErasureRequest` does the real 4-store work afterward. */
export class CreateErasureRequest {
  constructor(
    private readonly deps: {
      readonly erasureRequests: ErasureRequestRepository;
      readonly audit: AuditSink;
    },
  ) {}

  async execute(input: CreateErasureRequestInput): Promise<ErasureRequestRow> {
    const row = await this.deps.erasureRequests.create({
      subjectKind: input.subjectKind,
      subjectHash: input.subjectHash,
      citizenIdentityId: input.citizenIdentityId,
      receivedVia: input.receivedVia,
      now: input.now,
    });

    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: "governance.erasure_request_received",
      target: {
        kind: "ErasureRequest",
        id: row.id,
        labelSnapshot: `Erasure request (${input.subjectKind})`,
      },
      summary: `Received an erasure request via ${input.receivedVia}`,
    });

    return row;
  }
}
