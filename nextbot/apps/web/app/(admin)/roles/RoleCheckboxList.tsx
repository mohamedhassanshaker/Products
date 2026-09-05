"use client";

import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Label } from "@nextbot/ui/components/ui/label";

export interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
}

/**
 * Shared role multi-select used by both the "invite user" (create) and "change
 * roles" (reassignment) forms — a plain checkbox list rather than a multi-`Select`,
 * since the tenant's role count is small (six system + a handful of custom roles)
 * and every option should be scannable at a glance without opening a dropdown.
 *
 * Each `Checkbox` is wrapped in a `Label` (no separate `htmlFor`/`id` pairing
 * needed — a native `<label>` wrapping its control associates them implicitly,
 * and `label.tsx`'s own `flex items-center gap-2` styling keeps the checkbox and
 * its text visually aligned) so the accessible name is exactly the role's display
 * name (plus " (System)" where applicable), matching what `UsersTable.test.tsx`'s
 * `getByLabelText("Read-Only (System)")` assertion expects.
 */
export function RoleCheckboxList({
  roles,
  selected,
  onChange,
}: {
  roles: RoleOption[];
  selected: string[];
  onChange: (roleIds: string[]) => void;
}) {
  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">No roles available yet — create one from the Roles tab first.</p>;
  }

  function toggle(roleId: string, checked: boolean) {
    onChange(checked ? [...selected, roleId] : selected.filter((id) => id !== roleId));
  }

  return (
    <div className="flex flex-col gap-2">
      {roles.map((role) => (
        <Label key={role.id}>
          <Checkbox
            checked={selected.includes(role.id)}
            onCheckedChange={(checked) => toggle(role.id, checked === true)}
          />
          {role.name}
          {role.isSystem ? " (System)" : ""}
        </Label>
      ))}
    </div>
  );
}
