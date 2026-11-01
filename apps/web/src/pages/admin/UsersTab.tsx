import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, UserPlus } from "lucide-react";
import type { CompanyUserResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { EmployeePicker } from "@/components/EmployeePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/FormDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const statusVariant: Record<string, "success" | "cancelled" | "warning" | "outline"> = {
  Active: "success",
  Deactivated: "cancelled",
  Invited: "warning",
  Expired: "outline",
};

interface AccessForm {
  email: string;
  fullName: string;
  administrator: boolean;
  roleId: string;
  employeeId: string;
}

// docs/USER_ACCESS_PLAN.md: who can sign in to this company and with which role. Invitations are
// emailed, and the link is also shown here to pass on directly.
export function UsersTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const usersKey = ["admin", "users", companyId] as const;
  const [dialog, setDialog] = useState<{ mode: "invite" } | { mode: "edit"; user: CompanyUserResponse } | null>(null);
  const [form, setForm] = useState<AccessForm>({ email: "", fullName: "", administrator: false, roleId: "", employeeId: "" });
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({ queryKey: usersKey, queryFn: () => apiClient.listCompanyUsers(companyId) });
  const rolesQuery = useQuery({ queryKey: ["admin", "roles", companyId], queryFn: () => apiClient.listCompanyRoles(companyId) });
  const roles = rolesQuery.data ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersKey });
    void queryClient.invalidateQueries({ queryKey: ["admin", "roles", companyId] });
  };
  const fail = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: fallback })));

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiClient.inviteCompanyUser(companyId, {
        email: form.email.trim(),
        fullName: form.fullName.trim() || undefined,
        administrator: form.administrator,
        roleId: form.administrator ? undefined : form.roleId || undefined,
        employeeId: form.employeeId || undefined,
      }),
    onSuccess: (result) => {
      setError(null);
      setDialog(null);
      setLink({ title: intl.formatMessage({ id: "admin.users.inviteSent" }, { email: result.user.email }), url: result.inviteUrl });
      refresh();
    },
    onError: fail("admin.users.inviteError"),
  });

  const updateMutation = useMutation({
    mutationFn: (membershipId: string) =>
      apiClient.updateCompanyUser(companyId, membershipId, {
        administrator: form.administrator,
        roleId: form.administrator ? undefined : form.roleId || undefined,
        employeeId: form.employeeId || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setDialog(null);
      refresh();
    },
    onError: fail("admin.users.saveError"),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ user, action }: { user: CompanyUserResponse; action: string }) => {
      switch (action) {
        case "deactivate":
          return apiClient.deactivateCompanyUser(companyId, user.membershipId!);
        case "activate":
          return apiClient.activateCompanyUser(companyId, user.membershipId!);
        case "remove":
          return apiClient.removeCompanyUser(companyId, user.membershipId!);
        case "revoke":
          return apiClient.revokeCompanyInvitation(companyId, user.invitationId!);
        case "resend": {
          const result = await apiClient.resendCompanyInvitation(companyId, user.invitationId!);
          setLink({ title: intl.formatMessage({ id: "admin.users.inviteSent" }, { email: user.email }), url: result.inviteUrl });
          return;
        }
        case "reset": {
          const result = await apiClient.sendCompanyUserPasswordReset(companyId, user.membershipId!);
          setLink({ title: intl.formatMessage({ id: "admin.users.resetSent" }, { email: user.email }), url: result.resetUrl });
          return;
        }
      }
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail("admin.users.actionError"),
  });

  function confirmThen(user: CompanyUserResponse, action: string, messageId: string) {
    if (window.confirm(intl.formatMessage({ id: messageId }, { email: user.email }))) actionMutation.mutate({ user, action });
  }

  function openInvite() {
    setError(null);
    setForm({ email: "", fullName: "", administrator: false, roleId: roles.find((r) => r.builtInKey === "employee")?.id ?? "", employeeId: "" });
    setDialog({ mode: "invite" });
  }

  function openEdit(user: CompanyUserResponse) {
    setError(null);
    setForm({ email: user.email, fullName: user.fullName ?? "", administrator: user.access === "Administrator", roleId: user.roleId ?? "", employeeId: user.employeeId ?? "" });
    setDialog({ mode: "edit", user });
  }

  const accessLabel = (user: CompanyUserResponse) =>
    user.access === "Role" ? user.roleName ?? "—" : intl.formatMessage({ id: `admin.access.${user.access}` });

  const columns = useMemo<ColumnDef<CompanyUserResponse>[]>(
    () => [
      {
        id: "person",
        header: intl.formatMessage({ id: "admin.users.person" }),
        accessorFn: (row) => row.fullName ?? row.email,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">
              {row.original.fullName ?? row.original.email}
              {row.original.isYou && <span className="ml-1 text-xs text-muted-foreground">({intl.formatMessage({ id: "admin.users.you" })})</span>}
            </span>
            {row.original.fullName && <span className="text-xs text-muted-foreground">{row.original.email}</span>}
          </div>
        ),
      },
      { id: "access", header: intl.formatMessage({ id: "admin.users.access" }), accessorFn: (row) => accessLabel(row), meta: { groupable: true } },
      { accessorKey: "employeeName", header: intl.formatMessage({ id: "me.leave.employee" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        accessorKey: "status",
        header: intl.formatMessage({ id: "me.payslips.status" }),
        cell: ({ getValue }) => (
          <Badge variant={statusVariant[getValue() as string] ?? "outline"}>{intl.formatMessage({ id: `admin.status.${getValue() as string}` })}</Badge>
        ),
      },
      {
        id: "lastSeen",
        header: intl.formatMessage({ id: "admin.users.lastLogin" }),
        accessorFn: (row) => row.lastLoginAt ?? row.invitedAt,
        cell: ({ row }) =>
          row.original.lastLoginAt
            ? intl.formatDate(row.original.lastLoginAt, { dateStyle: "medium" })
            : row.original.invitedAt
              ? intl.formatMessage({ id: "admin.users.invitedOn" }, { date: intl.formatDate(row.original.invitedAt, { dateStyle: "medium" }) })
              : "—",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const user = row.original;
          if (!canManage || user.isFirmMember) {
            return user.isFirmMember ? <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.users.managedByFirm" })}</span> : null;
          }
          if (user.invitationId) {
            return (
              <div className="flex justify-end gap-1">
                <Button size="xs" variant="ghost" onClick={() => actionMutation.mutate({ user, action: "resend" })}>
                  {intl.formatMessage({ id: "admin.users.resend" })}
                </Button>
                <Button size="xs" variant="ghost" className="text-destructive" onClick={() => confirmThen(user, "revoke", "admin.users.revokeConfirm")}>
                  {intl.formatMessage({ id: "admin.users.revoke" })}
                </Button>
              </div>
            );
          }
          return (
            <div className="flex justify-end gap-1">
              <Button size="xs" variant="outline" onClick={() => openEdit(user)}>
                {intl.formatMessage({ id: "admin.users.changeAccess" })}
              </Button>
              {!user.isYou && (
                <Button size="xs" variant="ghost" onClick={() => actionMutation.mutate({ user, action: "reset" })}>
                  {intl.formatMessage({ id: "admin.users.resetPassword" })}
                </Button>
              )}
              {!user.isYou &&
                (user.status === "Active" ? (
                  <Button size="xs" variant="ghost" onClick={() => confirmThen(user, "deactivate", "admin.users.deactivateConfirm")}>
                    {intl.formatMessage({ id: "admin.users.deactivate" })}
                  </Button>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => actionMutation.mutate({ user, action: "activate" })}>
                    {intl.formatMessage({ id: "admin.users.activate" })}
                  </Button>
                ))}
              {!user.isYou && (
                <Button size="xs" variant="ghost" className="text-destructive" onClick={() => confirmThen(user, "remove", "admin.users.removeConfirm")}>
                  {intl.formatMessage({ id: "admin.users.remove" })}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, canManage, roles],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    if ((dialog.mode === "invite" && !form.email.trim()) || (!form.administrator && !form.roleId)) {
      setError(intl.formatMessage({ id: "admin.users.missingFields" }));
      return;
    }
    if (dialog.mode === "invite") inviteMutation.mutate();
    else updateMutation.mutate(dialog.user.membershipId!);
  }

  const users = usersQuery.data ?? [];
  const selectedRole = roles.find((r) => r.id === form.roleId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "admin.users.hint" })}</p>
        {canManage && (
          <Button size="sm" onClick={openInvite}>
            <UserPlus className="size-4" />
            {intl.formatMessage({ id: "admin.users.invite" })}
          </Button>
        )}
      </div>

      {error && !dialog && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {link && (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>{link.title}</span>
            {/* The API returns the link only while email isn't really sent; otherwise it went by email. */}
            {link.url && (
            <span className="flex items-center gap-2">
              <Input readOnly value={link.url} aria-label={intl.formatMessage({ id: "admin.users.link" })} className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(link.url)}>
                <Copy className="size-4" />
                {intl.formatMessage({ id: "admin.users.copyLink" })}
              </Button>
            </span>
            )}
            {link.url && <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.users.linkHint" })}</span>}
          </AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId="admin-users"
        columns={columns}
        data={users}
        rowCount={users.length}
        isLoading={usersQuery.isPending}
        getRowId={(row) => row.membershipId ?? row.invitationId ?? row.email}
        getRowClassName={(row) => (row.status === "Deactivated" || row.status === "Expired" ? "text-muted-foreground" : undefined)}
        emptyMessage={intl.formatMessage({ id: "admin.users.empty" })}
        manualFiltering={false}
        manualSorting={false}
        manualGrouping={false}
      />

      <FormDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.mode === "edit"
          ? intl.formatMessage({ id: "admin.users.editTitle" }, { name: dialog.user.fullName ?? dialog.user.email })
          : intl.formatMessage({ id: "admin.users.invite" })}
        description={intl.formatMessage({ id: dialog?.mode === "edit" ? "admin.users.editHint" : "admin.users.inviteHint" })}
        size="sm"
      >
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {dialog?.mode === "invite" && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="invite-email">{intl.formatMessage({ id: "common.email" })}</Label>
                  <Input id="invite-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="invite-name">{intl.formatMessage({ id: "admin.users.fullName" })}</Label>
                  <Input id="invite-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </div>
              </>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{intl.formatMessage({ id: "admin.users.access" })}</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-0.5" checked={form.administrator} onChange={() => setForm({ ...form, administrator: true })} />
                <span>
                  {intl.formatMessage({ id: "admin.access.Administrator" })}
                  <span className="block text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.roles.administratorHint" })}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-0.5" checked={!form.administrator} onChange={() => setForm({ ...form, administrator: false })} />
                <span className="flex grow flex-col gap-1">
                  {intl.formatMessage({ id: "admin.users.withRole" })}
                  <select
                    aria-label={intl.formatMessage({ id: "admin.users.role" })}
                    className={cn("h-9 rounded-md border bg-transparent px-2 text-sm", form.administrator && "opacity-50")}
                    disabled={form.administrator}
                    value={form.roleId}
                    onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                  >
                    <option value="">{intl.formatMessage({ id: "admin.users.chooseRole" })}</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {selectedRole?.description && !form.administrator && (
                    <span className="text-xs text-muted-foreground">{selectedRole.description}</span>
                  )}
                </span>
              </label>
            </fieldset>
            <div className="flex flex-col gap-1">
              <Label htmlFor="access-employee">{intl.formatMessage({ id: "admin.users.employee" })}</Label>
              <EmployeePicker
                companyId={companyId}
                id="access-employee"
                value={form.employeeId}
                onChange={(id) => setForm({ ...form, employeeId: id })}
                selectedName={dialog?.mode === "edit" ? dialog.user.employeeName ?? undefined : undefined}
                emptyLabel={intl.formatMessage({ id: "admin.users.noEmployee" })}
                withoutLogin
              />
              <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "admin.users.employeeHint" })}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending || updateMutation.isPending}>
                {intl.formatMessage({ id: dialog?.mode === "edit" ? "common.save" : "admin.users.sendInvite" })}
              </Button>
            </div>
          </form>
      </FormDialog>
    </div>
  );
}
