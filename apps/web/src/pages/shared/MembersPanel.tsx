import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { MemberResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import {
  CLIENT_STAFF,
  CLIENT_VIEWER,
  companyMemberRoleValues,
  firmMemberRoleValues,
  isCompanyAdminRole,
  isFirmAdminRole,
  membershipRoleLabel,
} from "@/lib/membership-enums";

type MembersPanelProps = {
  scope: "company" | "firm";
  scopeId: string;
};

export function MembersPanel({ scope, scopeId }: MembersPanelProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const roleValues = scope === "company" ? companyMemberRoleValues : firmMemberRoleValues;

  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  // Company scope defaults to Viewer (the least-privileged non-HR role); Staff is opt-in because it
  // also needs an employee picked.
  const [role, setRole] = useState(scope === "company" ? CLIENT_VIEWER : roleValues[roleValues.length - 1]);
  const [employeeId, setEmployeeId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const isStaffRole = scope === "company" && role === CLIENT_STAFF;

  // HR module: a Staff member is linked to an employee record, and only employees with no login yet
  // can be picked. 200 is the API's page-size ceiling.
  const unlinkedEmployeesQuery = useQuery({
    queryKey: ["employees", scopeId, "unlinked"],
    queryFn: async () => {
      const result = await apiClient.listEmployees(scopeId, 1, 200, undefined, "name", undefined, false);
      return result.items.filter((e) => !e.userId);
    },
    enabled: isStaffRole,
  });
  const unlinkedEmployees = unlinkedEmployeesQuery.data ?? [];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = scope === "company" ? await apiClient.membersAll(scopeId) : await apiClient.membersAll2(scopeId);
      setMembers(result);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "members.loadError" })));
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      if (scope === "company") {
        await apiClient.members(scopeId, { email: email.trim(), role, employeeId: isStaffRole ? employeeId : undefined });
      } else {
        await apiClient.members2(scopeId, { email: email.trim(), role });
      }
      setEmail("");
      setEmployeeId("");
      if (isStaffRole) await unlinkedEmployeesQuery.refetch();
      await refresh();
    } catch (err) {
      setAddError(getApiErrorMessage(err, intl.formatMessage({ id: "members.addError" })));
    } finally {
      setAdding(false);
    }
  }

  const currentMembership = members.find((m) => m.userId === auth?.userId);
  const isAdmin = currentMembership
    ? scope === "company"
      ? isCompanyAdminRole(currentMembership.role)
      : isFirmAdminRole(currentMembership.role)
    : false;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && members.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "members.loadingMembers" })}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{intl.formatMessage({ id: "members.email" })}</TableHead>
            <TableHead>{intl.formatMessage({ id: "members.role" })}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.membershipId}>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{membershipRoleLabel(member.role, intl)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!loading && members.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "members.noMembers" })}</p>}

      {isAdmin && (
        <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleAdd}>
          {addError && (
            <Alert variant="destructive" className="sm:basis-full">
              <AlertDescription>{addError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor={`${scope}-${scopeId}-member-email`}>{intl.formatMessage({ id: "members.email" })}</Label>
            <Input
              id={`${scope}-${scopeId}-member-email`}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${scope}-${scopeId}-member-role`}>{intl.formatMessage({ id: "members.role" })}</Label>
            <Select
              id={`${scope}-${scopeId}-member-role`}
              className="w-40"
              value={String(role)}
              onValueChange={(v) => setRole(Number(v))}
              options={roleValues.map((value) => ({
                value: String(value),
                label: membershipRoleLabel(value, intl),
              }))}
            />
          </div>
          {isStaffRole && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${scope}-${scopeId}-member-employee`}>{intl.formatMessage({ id: "hr.members.employee" })}</Label>
              <Select
                id={`${scope}-${scopeId}-member-employee`}
                className="w-56"
                value={employeeId}
                onValueChange={(v) => setEmployeeId(v)}
                placeholder={intl.formatMessage({
                  id: unlinkedEmployeesQuery.isPending
                    ? "common.loading"
                    : unlinkedEmployees.length === 0
                      ? "hr.members.noUnlinkedEmployees"
                      : "hr.members.selectEmployee",
                })}
                options={unlinkedEmployees.map((employee) => ({
                  value: employee.id,
                  label: employee.name,
                }))}
              />
            </div>
          )}
          <Button type="submit" disabled={adding || email.trim().length === 0 || (isStaffRole && !employeeId)}>
            {adding ? intl.formatMessage({ id: "members.adding" }) : intl.formatMessage({ id: "members.addMember" })}
          </Button>
        </form>
      )}
    </div>
  );
}
