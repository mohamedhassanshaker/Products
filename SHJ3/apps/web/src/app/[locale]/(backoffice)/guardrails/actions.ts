"use server";

/**
 * Server Actions for `/guardrails` (Screen 3 — Guardrails & policies: the GLOBAL policy
 * catalogue admin view).
 *
 * Every action gates on `governance:manage` (real key in `modules/iam/domain/
 * permissions.ts`, restricted to `SuperAdmin`/`EntityAdmin`) — checked here, in the
 * caller, per api.md §12 invariant 2, matching `governance/actions.ts`'s own precedent.
 * This is the same permission `/governance` uses: this screen shares governance's own
 * "even Super Admin cannot bypass a structural lock" theme (task brief), and the codebase
 * has no separate permission for the global guardrail catalogue specifically — confirmed
 * against the real, current 11-permission matrix before reusing this one rather than
 * inventing a new key.
 */
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ListGuardrailPolicies } from "../../../../modules/guardrails/application/list-guardrail-policies.js";
import {
  UpdateGuardrailPolicyValue,
  type UpdateGuardrailPolicyValueResult,
} from "../../../../modules/guardrails/application/update-guardrail-policy-value.js";
import { ListPolicyOverrides } from "../../../../modules/guardrails/application/list-policy-overrides.js";
import type { GlobalPolicyRow } from "../../../../modules/guardrails/ports/policy-catalogue-repository.js";
import type { PolicyOverrideDirectoryRow } from "../../../../modules/guardrails/ports/policy-override-directory-repository.js";
import {
  now,
  policyCatalogueRepository,
  policyOverrideDirectoryRepository,
} from "./composition.js";

const PERMISSION = "governance:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function listGuardrailPoliciesAction(): Promise<
  ActionResult<readonly GlobalPolicyRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "guardrails.listGuardrailPolicies");
      const { policies } = await new ListGuardrailPolicies({
        policies: policyCatalogueRepository(),
      }).execute();
      return { ok: true, value: policies } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface UpdateGuardrailPolicyValueFormInput {
  readonly policyKey: string;
  readonly defaultValueJson: string;
}

/**
 * The real, server-side refusal this screen's brief demands: a locked policy's write is
 * refused here regardless of what the UI did or didn't show — `UpdateGuardrailPolicyValue`
 * re-checks the live `platform.OverridablePolicies` membership itself, not a value already
 * read by the caller.
 */
export async function updateGuardrailPolicyValueAction(
  input: UpdateGuardrailPolicyValueFormInput,
): Promise<ActionResult<UpdateGuardrailPolicyValueResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "guardrails.updateGuardrailPolicyValue");
        const value = await new UpdateGuardrailPolicyValue({
          policies: policyCatalogueRepository(),
        }).execute({ ...input, now: now() });
        return { ok: true, value } as const;
      },
      { method: "PUT", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listPolicyOverridesAction(): Promise<
  ActionResult<readonly PolicyOverrideDirectoryRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "guardrails.listPolicyOverrides");
      const { overrides } = await new ListPolicyOverrides({
        overrides: policyOverrideDirectoryRepository(),
      }).execute();
      return { ok: true, value: overrides } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
