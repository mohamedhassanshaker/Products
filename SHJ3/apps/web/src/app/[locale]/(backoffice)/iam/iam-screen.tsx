"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { UserRosterRow } from "../../../../modules/iam/application/list-users.js";
import type { TeamRosterRow } from "../../../../modules/iam/application/list-teams-with-live-membership.js";
import type { Permission } from "../../../../modules/iam/domain/permissions.js";
import type {
  PermissionCatalogEntry,
  Role,
} from "../../../../modules/iam/ports/role-repository.js";
import type { SecurityPolicyRow } from "../../../../modules/iam/ports/security-policy-repository.js";
import { UsersTab } from "./users-tab.js";
import { TeamsTab } from "./teams-tab.js";
import { RolesTab } from "./roles-tab.js";
import { SecurityTab } from "./security-tab.js";
import type {
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

/** Every Server Action the tabs below call — one prop object, so a new tab does not need a new page.tsx wiring point. */
export interface IamScreenActions {
  readonly inviteUser: typeof inviteUserAction;
  readonly editUser: typeof editUserAction;
  readonly loadUserEditContext: typeof loadUserEditContextAction;
  readonly suspendUser: typeof suspendUserAction;
  readonly reactivateUser: typeof reactivateUserAction;
  readonly removeUser: typeof removeUserAction;
  readonly createTeam: typeof createTeamAction;
  readonly createCustomRole: typeof createCustomRoleAction;
  readonly updateRolePermissions: typeof updateRolePermissionsAction;
  readonly updateSecurityPolicy: typeof updateSecurityPolicyAction;
  readonly listTotpStatus: typeof listTotpStatusAction;
  readonly resetStaffTotp: typeof resetStaffTotpAction;
}

export interface IamScreenProps {
  readonly users: readonly UserRosterRow[];
  readonly teams: readonly TeamRosterRow[];
  readonly roles: readonly Role[];
  readonly permissionCatalog: readonly PermissionCatalogEntry[];
  readonly matrix: Readonly<Record<string, readonly Permission[]>>;
  readonly securityPolicy: SecurityPolicyRow | null;
  readonly totpStatus: Readonly<Record<string, boolean>>;
  readonly actions: IamScreenActions;
}

/**
 * B9's three tabs, URL-synced (`?tab=`) via `SubTabBar`'s own `urlParam` mechanism
 * (design-system.md's "deep-linkable per Phase F" requirement) — checked directly before
 * assuming it: `SkinEditor`'s five *sections* switch via plain internal component state,
 * not URL sync, which is a different, narrower case (one editor, no cross-linking need).
 * B9 tab 3 (Roles & permissions) genuinely needs deep-linkability — a support agent
 * walking someone through a permission problem needs to link straight to "the roles tab".
 *
 * ## Why there is no client-side cache of server data here
 *
 * All three datasets (`users`/`teams`/`roles`/`matrix`) are the props this Server Component
 * page fetched. Every mutation (invite, edit, remove, add team, add role) calls its Server
 * Action, then `router.refresh()` (inside each tab component) — which re-runs `page.tsx`'s
 * own data fetch, including `ListTeamsWithLiveMembership`. That is what makes B9 tab 2's
 * "membership chips are derived live from the Users tab" true across a real team
 * reassignment: nothing here caches or duplicates membership state that could go stale:
 * every visible row is server-fetched, refreshed on demand, never client-derived. The
 * exception is B9 tab 3's own permission-matrix grid, which owns its interaction state
 * internally (`PermissionMatrix`'s own documented `defaultValue`-seeds-once contract) and
 * reports changes back through `onCellsChange`/`confirmChange` — `RolesTab` composes that
 * exactly as built, never re-implementing its state machine.
 */
export function IamScreen({
  users,
  teams,
  roles,
  permissionCatalog,
  matrix,
  securityPolicy,
  totpStatus,
  actions,
}: IamScreenProps): React.ReactElement {
  const t = useTranslations("iam");

  const tabs = React.useMemo(
    () => [
      { value: "users", label: t("tabs.users") },
      { value: "teams", label: t("tabs.teams") },
      { value: "roles", label: t("tabs.roles") },
      { value: "security", label: t("tabs.security") },
    ],
    [t],
  );

  const teamOptions = React.useMemo(
    () => teams.map((row) => ({ id: row.team.id, name: row.team.name })),
    [teams],
  );
  const roleOptions = React.useMemo(
    () => roles.map((role) => ({ key: role.key, displayName: role.displayName })),
    [roles],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="users">
        <UsersTab
          rows={users}
          teamOptions={teamOptions}
          roleOptions={roleOptions}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="teams">
        <TeamsTab rows={teams} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="roles">
        <RolesTab
          roles={roles}
          permissionCatalog={permissionCatalog}
          matrix={matrix}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="security">
        <SecurityTab users={users} policy={securityPolicy} totpStatus={totpStatus} actions={actions} />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
