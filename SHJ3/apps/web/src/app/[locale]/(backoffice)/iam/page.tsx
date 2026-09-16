import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { ListTeamsWithLiveMembership } from "../../../../modules/iam/application/list-teams-with-live-membership.js";
import { ListUsers } from "../../../../modules/iam/application/list-users.js";
import { GetSecurityPolicy } from "../../../../modules/iam/application/get-security-policy.js";
import { PermissionDeniedError, isAllowed } from "../../../../modules/iam/domain/permissions.js";
import type { UserRosterRow } from "../../../../modules/iam/application/list-users.js";
import type { TeamRosterRow } from "../../../../modules/iam/application/list-teams-with-live-membership.js";
import type { Permission } from "../../../../modules/iam/domain/permissions.js";
import type { SecurityPolicyRow } from "../../../../modules/iam/ports/security-policy-repository.js";
import type {
  PermissionCatalogEntry,
  Role,
} from "../../../../modules/iam/ports/role-repository.js";
import {
  identityProvider,
  roleRepository,
  securityPolicyRepository,
  teamRepository,
  userRepository,
} from "./composition.js";
import { IamScreen } from "./iam-screen.js";
import {
  createCustomRoleAction,
  createTeamAction,
  editUserAction,
  inviteUserAction,
  listTotpStatusAction,
  loadUserEditContextAction,
  reactivateUserAction,
  removeUserAction,
  resetStaffTotpAction,
  suspendUserAction,
  updateRolePermissionsAction,
  updateSecurityPolicyAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly users: readonly UserRosterRow[];
      readonly teams: readonly TeamRosterRow[];
      readonly roles: readonly Role[];
      readonly permissionCatalog: readonly PermissionCatalogEntry[];
      readonly matrix: Readonly<Record<string, readonly Permission[]>>;
      /** `null` when the signed-in principal lacks `security:manage` — the Security tab renders its own permission-denied panel in that case, same page-level gate shape as every other restricted tab. */
      readonly securityPolicy: SecurityPolicyRow | null;
      readonly totpStatus: Readonly<Record<string, boolean>>;
    };

/**
 * `/iam` (B9: Users, Teams, Roles & permissions) — the first real `(backoffice)` screen.
 *
 * ## Real, server-side permission gating — not the sidebar's hiding
 *
 * `requirePermission` runs here, inside `withStaffAuth`'s bound tenant context, before any
 * of this route's own data is read. Architecture.md §9's RBAC row: "the server check is the
 * real one; the client check only hides what the user cannot use" — the `(backoffice)`
 * layout's nav item is visible regardless of role, exactly as that row expects.
 *
 * ## Every real query happens inside `withStaffAuth`'s handler, never after it returns
 *
 * `getPlatformDb()`/`getTenantDb()` both require an ambient `TenantContext` bound via
 * `runWithTenant` — which only exists for the duration of `withStaffAuth`'s own callback
 * (see that module's doc comment on why no ambient binding survives past it). So every use
 * case call below happens *inside* the handler passed to `withStaffAuth`, and the resolved
 * `PageData` — plain data, no live repository handles — is what crosses back out to be
 * rendered. Getting this ordering wrong is exactly the mistake that would make this page
 * throw `MissingTenantContextError` on every real request.
 */
export default async function IamPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("iam");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "users:manage", "iam.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const tenant = principal.tenant;
      const [usersResult, teamsResult, roles, permissionCatalog, matrix] = await Promise.all([
        new ListUsers({
          users: userRepository(),
          teams: teamRepository(),
          roles: roleRepository(),
        }).execute({
          tenant,
        }),
        new ListTeamsWithLiveMembership({
          teams: teamRepository(),
          users: userRepository(),
        }).execute({ tenant }),
        roleRepository().list(),
        roleRepository().listPermissionCatalog(),
        roleRepository().permissionMatrix(),
      ]);

      const canManageSecurity = isAllowed(principal.permissions, "security:manage");
      const [securityPolicy, totpStatusByUserId] = canManageSecurity
        ? await Promise.all([
            new GetSecurityPolicy({ securityPolicy: securityPolicyRepository() }).execute({
              now: new Date(),
            }),
            identityProvider().listTotpEnrolmentStatus(usersResult.rows.map((row) => row.id)),
          ])
        : [null, new Map<string, boolean>()];

      return {
        kind: "ok",
        users: usersResult.rows,
        teams: teamsResult.rows,
        roles,
        permissionCatalog,
        matrix,
        securityPolicy,
        totpStatus: Object.fromEntries(totpStatusByUserId),
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/iam`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <IamScreen
        users={pageData.users}
        teams={pageData.teams}
        roles={pageData.roles}
        permissionCatalog={pageData.permissionCatalog}
        matrix={pageData.matrix}
        securityPolicy={pageData.securityPolicy}
        totpStatus={pageData.totpStatus}
        actions={{
          inviteUser: inviteUserAction,
          editUser: editUserAction,
          loadUserEditContext: loadUserEditContextAction,
          suspendUser: suspendUserAction,
          reactivateUser: reactivateUserAction,
          removeUser: removeUserAction,
          createTeam: createTeamAction,
          createCustomRole: createCustomRoleAction,
          updateRolePermissions: updateRolePermissionsAction,
          updateSecurityPolicy: updateSecurityPolicyAction,
          listTotpStatus: listTotpStatusAction,
          resetStaffTotp: resetStaffTotpAction,
        }}
      />
    </div>
  );
}
