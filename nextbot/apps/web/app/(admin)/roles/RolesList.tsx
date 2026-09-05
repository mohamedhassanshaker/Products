"use client";

import { useCallback, useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { fetchJson } from "../../../src/lib/fetch-json";
import { UsersTable, type UserListItem } from "./UsersTable";
import { RolesTable, type RoleListItem } from "./RolesTable";
import { SsoGroupMappingSection } from "./SsoGroupMappingSection";

/**
 * The "Users & Roles" Admin Console screen (FR-ADM-02 / screen inventory B.8.1).
 * Previously this rendered only a read-only list of the six seeded system roles with
 * an explicit "out of scope" disclosure — this completes it: a real user table
 * (name, email, role(s), last login, MFA status), invite/create-user with role
 * assignment at creation, a role editor with the full per-module permission matrix
 * (+ the `mfaRequired` toggle), role reassignment for existing users, and an honest
 * "not yet configured" SSO group-mapping placeholder (real SAML/OAuth2 isn't wired
 * up anywhere in this codebase — see `SsoGroupMappingSection`'s own doc comment).
 *
 * Both the user list and the role list are fetched here (not per-tab) so role data
 * can be shared between the Users tab's role-assignment controls and the Roles tab's
 * own table without a duplicate fetch.
 */
export function RolesList({ canWrite }: { canWrite: boolean }) {
  const [users, setUsers] = useState<UserListItem[] | null>(null);
  const [roles, setRoles] = useState<RoleListItem[] | null>(null);
  // QA Defect U3: same silent-403-as-empty-list bug QA found on Connectors/Tool
  // Catalog was present here too — fixed the same way. A 403 on *either* fetch
  // fails the whole screen closed (both surfaces are gated by the same
  // `users_roles` module, so a 403 on one implies the other would 403 too).
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const [usersResult, rolesResult] = await Promise.all([
      fetchJson<{ users: UserListItem[] }>("/api/v1/admin/users"),
      fetchJson<{ roles: RoleListItem[] }>("/api/v1/admin/roles"),
    ]);
    if (usersResult.kind === "forbidden" || rolesResult.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (usersResult.kind === "ok") setUsers(usersResult.data.users ?? []);
    if (rolesResult.kind === "ok") setRoles(rolesResult.data.roles ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <AccessDeniedState moduleLabel="Users & Roles" />;

  return (
    <div className="p-6">
      <h1 className="mb-6 font-heading text-lg font-semibold">Users &amp; Roles</h1>
      {!users || !roles ? (
        <Skeleton className="h-64 w-full" role="status" aria-label="Loading users and roles" />
      ) : (
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger id="roles-list-tab-users" panelId="roles-list-panel-users" value="users">Users</TabsTrigger>
            <TabsTrigger id="roles-list-tab-roles" panelId="roles-list-panel-roles" value="roles">Roles</TabsTrigger>
            <TabsTrigger id="roles-list-tab-sso" panelId="roles-list-panel-sso" value="sso">SSO</TabsTrigger>
          </TabsList>
          <TabsContent id="roles-list-panel-users" value="users">
            <UsersTable users={users} roles={roles} canWrite={canWrite} onRefresh={load} />
          </TabsContent>
          <TabsContent id="roles-list-panel-roles" value="roles">
            <RolesTable roles={roles} canWrite={canWrite} onRefresh={load} />
          </TabsContent>
          <TabsContent id="roles-list-panel-sso" value="sso">
            <SsoGroupMappingSection />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
