import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { DepartmentPermissions, DepartmentResponse, EmployeeDetailResponse, SaveDepartmentRequest } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AccessLevel,
  accessLevelLabel,
  accessLevelValues,
  PartnerScope,
  partnerScopeLabel,
  partnerScopeValues,
  permissionModuleLabel,
  permissionModules,
  type PermissionModule,
} from "@/lib/hr-enums";
import { cn } from "@/lib/utils";

const EMPTY_PERMISSIONS: DepartmentPermissions = {
  sales: AccessLevel.None,
  purchases: AccessLevel.None,
  partners: AccessLevel.None,
  accounting: AccessLevel.None,
  reports: AccessLevel.None,
  hr: AccessLevel.None,
};

/**
 * Module × access-level radio matrix. With partner scope "Assigned only" the API never grants
 * Accounting (a general ledger filtered by partner hides its contra lines), so that row is locked
 * at None.
 */
export function PermissionMatrix({
  permissions,
  partnerScope,
  disabled,
  onChange,
}: {
  permissions: DepartmentPermissions;
  partnerScope: number;
  disabled?: boolean;
  onChange: (module: PermissionModule, level: number) => void;
}) {
  const intl = useIntl();
  const assignedOnly = partnerScope === PartnerScope.Assigned;

  return (
    <div className="rounded-md border">
      <Table aria-label={intl.formatMessage({ id: "hr.department.permissions" })}>
        <TableHeader>
          <TableRow className="h-[30px] hover:bg-transparent">
            <TableHead>{intl.formatMessage({ id: "hr.department.module" })}</TableHead>
            {accessLevelValues.map((level) => (
              <TableHead key={level} className="w-24 text-center">
                {accessLevelLabel(level, intl)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {permissionModules.map((module) => {
            const rowLocked = module === "accounting" && assignedOnly;
            const current = rowLocked ? AccessLevel.None : permissions[module];
            return (
              <TableRow key={module} className={cn("h-[30px]", rowLocked && "text-muted-foreground")} data-testid={`permission-row-${module}`}>
                <TableCell className="py-1">
                  {permissionModuleLabel(module, intl)}
                  {rowLocked && <span className="ml-2 text-[11px]">{intl.formatMessage({ id: "hr.department.accountingLocked" })}</span>}
                </TableCell>
                {accessLevelValues.map((level) => (
                  <TableCell key={level} className="py-1 text-center">
                    <input
                      type="radio"
                      name={`permission-${module}`}
                      aria-label={`${permissionModuleLabel(module, intl)}: ${accessLevelLabel(level, intl)}`}
                      checked={current === level}
                      disabled={disabled || rowLocked}
                      onChange={() => onChange(module, level)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface DepartmentFormProps {
  mode: "create" | "edit";
  initial?: DepartmentResponse;
  departments: DepartmentResponse[];
  employees: EmployeeDetailResponse[];
  readOnly: boolean;
  submitting: boolean;
  deleting?: boolean;
  error: string | null;
  onSubmit: (request: SaveDepartmentRequest) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function DepartmentForm({
  mode,
  initial,
  departments,
  employees,
  readOnly,
  submitting,
  deleting = false,
  error,
  onSubmit,
  onDelete,
  onCancel,
}: DepartmentFormProps) {
  const intl = useIntl();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [managerEmployeeId, setManagerEmployeeId] = useState(initial?.managerEmployeeId ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [partnerScope, setPartnerScope] = useState<number>(initial?.partnerScope ?? PartnerScope.All);
  const [permissions, setPermissions] = useState<DepartmentPermissions>({ ...EMPTY_PERMISSIONS, ...initial?.permissions });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A department can't be its own parent; the API also refuses deeper cycles.
  const parentOptions = departments.filter((d) => d.id !== initial?.id);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      parentId: parentId || undefined,
      managerEmployeeId: managerEmployeeId || undefined,
      // Cost centers have no real endpoint yet (src/api/cost-centers-client.ts is a mock); keep
      // whatever the department already has rather than clearing it.
      costCenterId: initial?.costCenterId,
      permissions: {
        ...permissions,
        accounting: partnerScope === PartnerScope.Assigned ? AccessLevel.None : permissions.accounting,
      },
      partnerScope,
      isActive,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="department-code">{intl.formatMessage({ id: "common.code" })}</Label>
          <Input id="department-code" required disabled={readOnly} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="department-name">{intl.formatMessage({ id: "common.name" })}</Label>
          <Input id="department-name" required disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="department-parent">{intl.formatMessage({ id: "hr.department.parent" })}</Label>
          <Select id="department-parent" disabled={readOnly} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "hr.department.noParent" })}</option>
            {parentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="department-manager">{intl.formatMessage({ id: "hr.department.manager" })}</Label>
          <Select id="department-manager" disabled={readOnly} value={managerEmployeeId} onChange={(e) => setManagerEmployeeId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "common.notSet" })}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={readOnly} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {intl.formatMessage({ id: "common.active" })}
      </label>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{intl.formatMessage({ id: "hr.department.permissions" })}</h3>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.department.permissionsHint" })}</p>
          <PermissionMatrix
            permissions={permissions}
            partnerScope={partnerScope}
            disabled={readOnly}
            onChange={(module, level) => setPermissions((prev) => ({ ...prev, [module]: level }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{intl.formatMessage({ id: "hr.department.partnerScope" })}</h3>
          {partnerScopeValues.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="department-partner-scope"
                disabled={readOnly}
                checked={partnerScope === scope}
                onChange={() => setPartnerScope(scope)}
              />
              {partnerScopeLabel(scope, intl)}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.department.partnerScopeHint" })}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <Button type="submit" disabled={submitting || !code.trim() || !name.trim()}>
            {submitting
              ? intl.formatMessage({ id: "common.saving" })
              : intl.formatMessage({ id: mode === "create" ? "hr.departments.create" : "common.save" })}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting || deleting}>
          {intl.formatMessage({ id: readOnly ? "hr.common.close" : "common.cancel" })}
        </Button>
        {!readOnly && mode === "edit" && onDelete && (
          <div className="ml-auto flex items-center gap-2">
            {confirmingDelete ? (
              <>
                <span className="text-sm text-muted-foreground">{intl.formatMessage({ id: "hr.departments.deleteConfirm" })}</span>
                <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
                  {intl.formatMessage({ id: "common.delete" })}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
                  {intl.formatMessage({ id: "common.cancel" })}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
                {intl.formatMessage({ id: "common.delete" })}
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
