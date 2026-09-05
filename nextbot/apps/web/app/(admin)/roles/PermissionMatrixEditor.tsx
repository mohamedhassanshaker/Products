"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import type { PermissionLevelValue, PermissionMatrix, RbacModuleValue } from "@nextbot/contracts";
import { RBAC_MODULE_LABELS, RBAC_MODULE_ORDER } from "./rbac-module-labels";

const LEVELS: PermissionLevelValue[] = ["None", "Read", "Write"];

/**
 * The role editor's per-module Read/Write/None permission matrix (FR-ADM-02 / screen
 * inventory B.8.1: "permission matrix across modules with Read/Write/None per
 * module"). One row per `RbacModuleValue`, a `Select` cell per row (not raw radio
 * buttons — `docs/design/UX_GUIDELINES.md` §4.3's "too much visual noise at matrix
 * scale" guidance for the Tool Permission matrix applies identically here), text
 * label always present (never color-only, per the baseline rule).
 *
 * Not React Hook Form-driven (matches the plan's guidance for this component): the
 * matrix lives in the parent's local `useState` (`RoleFormModal`), so this stays a
 * bare controlled component rather than wrapping RHF's `Form`/`FormField` around it.
 */
export function PermissionMatrixEditor({
  matrix,
  onChange,
  disabled,
}: {
  matrix: PermissionMatrix;
  onChange: (module: RbacModuleValue, level: PermissionLevelValue) => void;
  disabled?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Module</TableHead>
          <TableHead>Access</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {RBAC_MODULE_ORDER.map((module) => (
          <TableRow key={module}>
            <TableCell>{RBAC_MODULE_LABELS[module]}</TableCell>
            <TableCell>
              <Select
                disabled={disabled}
                value={matrix[module] ?? "None"}
                onValueChange={(v) => onChange(module, v as PermissionLevelValue)}
              >
                <SelectTrigger
                  className="w-[140px]"
                  aria-label={`${RBAC_MODULE_LABELS[module]} access level`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Builds a matrix with every module defaulted to `"None"` — the safe starting point
 * for a brand-new custom role (fail-closed: nothing is granted until explicitly set). */
export function emptyPermissionMatrix(): PermissionMatrix {
  const result = {} as PermissionMatrix;
  for (const module of RBAC_MODULE_ORDER) result[module] = "None";
  return result;
}
