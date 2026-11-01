import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { DepartmentResponse, EmployeeDetailResponse, SaveEmployeeRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { EmployeePicker } from "@/components/EmployeePicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { employeeWarningLabel } from "@/lib/hr-enums";
import { EmployeeAnnualStatement } from "@/pages/hr/EmployeeAnnualStatement";
import { EmployeeContracts } from "@/pages/hr/EmployeeContracts";
import { EmployeePartnerAccess } from "@/pages/hr/EmployeePartnerAccess";
import { EmployeeLoansPanel } from "@/pages/payroll/EmployeeLoans";

const SECTIONS = ["personal", "employment", "pay", "contracts", "partners", "loans", "statement"] as const;
type Section = (typeof SECTIONS)[number];
/** Sections edited through the one employee form (and its single Save button). */
const FORM_SECTIONS: Section[] = ["personal", "employment", "pay"];
// docs/USER_ACCESS_PLAN.md: salary history, loans and the annual income statement are pay data.
const PAY_SECTIONS: Section[] = ["contracts", "loans", "statement"];

export function EmployeeDetail() {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const { activeCompanyId } = useCompany();
  const isNew = id === "new";

  const employeeQuery = useQuery({
    queryKey: ["employee", activeCompanyId, id],
    queryFn: () => apiClient.getEmployee(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !!id && !isNew,
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments", activeCompanyId],
    queryFn: () => apiClient.listDepartments(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  useTabMeta({
    title: isNew ? intl.formatMessage({ id: "hr.employees.new" }) : employeeQuery.data?.name,
  });

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const back = (
    <Link className="text-sm text-muted-foreground hover:underline" to="/employees">
      &larr; {intl.formatMessage({ id: "hr.employee.backToList" })}
    </Link>
  );

  if (!isNew && employeeQuery.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(employeeQuery.error, intl.formatMessage({ id: "hr.employee.loadError" }))}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!isNew && !employeeQuery.data) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <EmployeeEditor
        key={employeeQuery.data?.id ?? "new"}
        companyId={activeCompanyId}
        employee={isNew ? null : (employeeQuery.data ?? null)}
        departments={departmentsQuery.data ?? []}
      />
    </div>
  );
}

interface FormState {
  firstName: string;
  lastName: string;
  personalNumber: string;
  birthDate: string;
  email: string;
  phone: string;
  address: string;
  departmentId: string;
  jobTitle: string;
  managerId: string;
  hireDate: string;
  terminationDate: string;
  isActive: boolean;
  isPrimaryEmployer: boolean;
  pensionExempt: boolean;
  receivePayslipsByEmail: boolean;
  preferredLanguage: string;
  commissionPlanId: string;
  monthlyGrossSalary: string;
  iban: string;
  bankName: string;
}

function initialState(employee: EmployeeDetailResponse | null): FormState {
  return {
    // Employees created before the HR module only have `name`; seed first name from it.
    firstName: employee ? (employee.firstName ?? (employee.lastName ? "" : employee.name)) : "",
    lastName: employee?.lastName ?? "",
    personalNumber: employee?.personalNumber ?? "",
    birthDate: employee?.birthDate ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    address: employee?.address ?? "",
    departmentId: employee?.departmentId ?? "",
    jobTitle: employee?.jobTitle ?? "",
    managerId: employee?.managerId ?? "",
    hireDate: employee?.hireDate ?? "",
    terminationDate: employee?.terminationDate ?? "",
    isActive: employee?.isActive ?? true,
    isPrimaryEmployer: employee?.isPrimaryEmployer ?? true,
    pensionExempt: employee?.pensionExempt ?? false,
    receivePayslipsByEmail: employee?.receivePayslipsByEmail ?? false,
    preferredLanguage: employee?.preferredLanguage ?? "sq",
    commissionPlanId: employee?.commissionPlanId ?? "",
    monthlyGrossSalary: employee ? String(employee.monthlyGrossSalary) : "",
    iban: employee?.iban ?? "",
    bankName: employee?.bankName ?? "",
  };
}

function EmployeeEditor({
  companyId,
  employee,
  departments,
}: {
  companyId: string;
  employee: EmployeeDetailResponse | null;
  departments: DepartmentResponse[];
}) {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite, canSee, isStaff } = useMyAccess();
  const canSeePay = canSee("payroll");
  const isNew = employee === null;
  const readOnly = !canWrite("hr");

  const requestedSection = searchParams.get("section") as Section | null;
  const section: Section =
    requestedSection && SECTIONS.includes(requestedSection) && (!isNew || FORM_SECTIONS.includes(requestedSection))
      ? requestedSection
      : "personal";
  function setSection(next: Section) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "personal") params.delete("section");
        else params.set("section", next);
        return params;
      },
      { replace: true },
    );
  }

  const initial = useMemo(() => initialState(employee), [employee]);
  const [form, setForm] = useState<FormState>(initial);
  const commissionPlansQuery = useQuery({
    queryKey: ["commissionPlans", companyId],
    queryFn: () => apiClient.listCommissionPlans(companyId),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useTabMeta({ dirty });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const department = departments.find((d) => d.id === (employee?.departmentId ?? ""));

  const saveMutation = useMutation({
    mutationFn: (request: SaveEmployeeRequest) =>
      employee ? apiClient.updateEmployee(companyId, employee.id, request) : apiClient.createEmployee(companyId, request),
    onSuccess: async (result) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      await queryClient.invalidateQueries({ queryKey: ["departments", companyId] });
      if (isNew) {
        toast.success(intl.formatMessage({ id: "toast.employeeCreated" }));
        navigate(`/employees/${result.id}`);
        return;
      }
      toast.success(intl.formatMessage({ id: "toast.employeeSaved" }));
      queryClient.setQueryData(["employee", companyId, result.id], result);
      setForm(initialState(result));
      setSaved(true);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, intl.formatMessage({ id: "hr.employee.saveError" }))),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    saveMutation.mutate({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
      personalNumber: form.personalNumber.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      birthDate: form.birthDate || undefined,
      hireDate: form.hireDate || undefined,
      terminationDate: form.terminationDate || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      // Staff may not move anyone between departments (the API forbids it) — send it unchanged.
      departmentId: isStaff ? employee?.departmentId : form.departmentId || undefined,
      managerId: form.managerId || undefined,
      // The login link is made from Settings → Members, never here; keep whatever it is.
      userId: employee?.userId,
      iban: form.iban.replace(/\s+/g, "") || undefined,
      bankName: form.bankName.trim() || undefined,
      monthlyGrossSalary: Number(form.monthlyGrossSalary),
      isPrimaryEmployer: form.isPrimaryEmployer,
      pensionExempt: form.pensionExempt,
      isActive: form.isActive,
      receivePayslipsByEmail: form.receivePayslipsByEmail,
      preferredLanguage: form.preferredLanguage,
      commissionPlanId: form.commissionPlanId || undefined,
    });
  }

  const title = employee?.name ?? intl.formatMessage({ id: "hr.employees.new" });
  const inForm = FORM_SECTIONS.includes(section);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{title}</CardTitle>
              {employee &&
                (employee.isActive ? (
                  <Badge variant="success">{intl.formatMessage({ id: "common.active" })}</Badge>
                ) : (
                  <Badge variant="cancelled">{intl.formatMessage({ id: "common.inactive" })}</Badge>
                ))}
              {employee?.warnings.map((code) => (
                <Badge key={code} variant="warning">
                  {employeeWarningLabel(code, intl)}
                </Badge>
              ))}
            </div>
            {employee && (
              <CardDescription>
                {[employee.jobTitle, employee.departmentName].filter(Boolean).join(" · ") || " "}
              </CardDescription>
            )}
          </div>
          {employee && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.employee.currentSalary" })}</p>
              <p className="text-lg font-semibold tabular-nums">{employee.currentSalary.toFixed(2)} €</p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {SECTIONS.filter((s) => canSeePay || !PAY_SECTIONS.includes(s)).map((s) => {
            const unavailable = isNew && !FORM_SECTIONS.includes(s);
            return (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={section === s ? "default" : "outline"}
                disabled={unavailable}
                title={unavailable ? intl.formatMessage({ id: "hr.employee.saveFirst" }) : undefined}
                onClick={() => setSection(s)}
              >
                {intl.formatMessage({ id: `hr.employee.section.${s}` })}
              </Button>
            );
          })}
        </div>

        {inForm && (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {saved && !dirty && (
              <Alert>
                <AlertDescription>{intl.formatMessage({ id: "hr.employee.saved" })}</AlertDescription>
              </Alert>
            )}

            {section === "personal" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field id="emp-first-name" label={intl.formatMessage({ id: "hr.employee.firstName" })}>
                  <Input id="emp-first-name" required disabled={readOnly} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
                </Field>
                <Field id="emp-last-name" label={intl.formatMessage({ id: "hr.employee.lastName" })}>
                  <Input id="emp-last-name" disabled={readOnly} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
                </Field>
                <Field
                  id="emp-personal-number"
                  label={intl.formatMessage({ id: "hr.employee.personalNumber" })}
                  hint={intl.formatMessage({ id: "hr.employee.personalNumberHint" })}
                >
                  <Input
                    id="emp-personal-number"
                    inputMode="numeric"
                    pattern="\d{10}"
                    maxLength={10}
                    className="tabular-nums"
                    disabled={readOnly}
                    value={form.personalNumber}
                    onChange={(e) => set("personalNumber", e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
                <Field id="emp-birth-date" label={intl.formatMessage({ id: "hr.employee.birthDate" })}>
                  <Input id="emp-birth-date" type="date" disabled={readOnly} value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
                </Field>
                <Field id="emp-email" label={intl.formatMessage({ id: "common.email" })}>
                  <Input id="emp-email" type="email" disabled={readOnly} value={form.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field id="emp-phone" label={intl.formatMessage({ id: "hr.employee.phone" })}>
                  <Input id="emp-phone" type="tel" disabled={readOnly} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </Field>
                <div className="sm:col-span-3">
                  <Field id="emp-address" label={intl.formatMessage({ id: "hr.employee.address" })}>
                    <Input id="emp-address" disabled={readOnly} value={form.address} onChange={(e) => set("address", e.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {section === "employment" && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field
                    id="emp-department"
                    label={intl.formatMessage({ id: "hr.employee.department" })}
                    hint={isStaff ? intl.formatMessage({ id: "hr.employee.departmentStaffHint" }) : undefined}
                  >
                    <Select
                      id="emp-department"
                      disabled={readOnly || isStaff}
                      value={form.departmentId}
                      onValueChange={(v) => set("departmentId", v)}
                      placeholder={intl.formatMessage({ id: "common.notSet" })}
                      options={departments.map((d) => ({
                        value: d.id,
                        label: `${d.code} — ${d.name}`,
                      }))}
                    />
                  </Field>
                  <Field id="emp-job-title" label={intl.formatMessage({ id: "hr.employee.jobTitle" })}>
                    <Input id="emp-job-title" disabled={readOnly} value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
                  </Field>
                  <Field id="emp-manager" label={intl.formatMessage({ id: "hr.employee.manager" })}>
                    <EmployeePicker
                      id="emp-manager"
                      companyId={companyId}
                      disabled={readOnly}
                      excludeId={employee?.id}
                      value={form.managerId}
                      selectedName={employee && form.managerId === employee.managerId ? employee.managerName : undefined}
                      emptyLabel={intl.formatMessage({ id: "common.notSet" })}
                      onChange={(id) => set("managerId", id)}
                    />
                  </Field>
                  <Field id="emp-hire-date" label={intl.formatMessage({ id: "hr.employee.hireDate" })}>
                    <Input id="emp-hire-date" type="date" disabled={readOnly} value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
                  </Field>
                  <Field id="emp-termination-date" label={intl.formatMessage({ id: "hr.employee.terminationDate" })}>
                    <Input
                      id="emp-termination-date"
                      type="date"
                      disabled={readOnly}
                      min={form.hireDate || undefined}
                      value={form.terminationDate}
                      onChange={(e) => set("terminationDate", e.target.value)}
                    />
                  </Field>
                  <Field
                    id="emp-login"
                    label={intl.formatMessage({ id: "hr.employee.linkedLogin" })}
                    hint={intl.formatMessage({ id: "hr.employee.linkedLoginHint" })}
                  >
                    <Input id="emp-login" readOnly disabled value={employee?.userEmail ?? intl.formatMessage({ id: "hr.employee.noLogin" })} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={readOnly} checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                    {intl.formatMessage({ id: "common.active" })}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={form.isPrimaryEmployer}
                      onChange={(e) => set("isPrimaryEmployer", e.target.checked)}
                    />
                    {intl.formatMessage({ id: "hr.employee.primaryEmployer" })}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={readOnly} checked={form.pensionExempt} onChange={(e) => set("pensionExempt", e.target.checked)} />
                    {intl.formatMessage({ id: "hr.employee.pensionExempt" })}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={form.receivePayslipsByEmail}
                      onChange={(e) => set("receivePayslipsByEmail", e.target.checked)}
                    />
                    {intl.formatMessage({ id: "hr.employee.receivePayslipsByEmail" })}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    {intl.formatMessage({ id: "hr.employee.preferredLanguage" })}
                    <select
                      className="h-7 rounded-md border bg-transparent px-1 text-sm"
                      disabled={readOnly}
                      value={form.preferredLanguage}
                      onChange={(e) => set("preferredLanguage", e.target.value)}
                    >
                      <option value="sq">Shqip</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.employee.primaryEmployerHint" })}</p>
              </div>
            )}

            {section === "pay" && employee?.payDataHidden && (
              <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "hr.employee.payDataHidden" })}</p>
            )}

            {section === "pay" && !employee?.payDataHidden && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  id="emp-salary"
                  label={intl.formatMessage({ id: "hr.employee.monthlyGrossSalary" })}
                  hint={intl.formatMessage({ id: "hr.employee.monthlyGrossSalaryHint" })}
                >
                  <Input
                    id="emp-salary"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    className="text-right tabular-nums"
                    disabled={readOnly}
                    value={form.monthlyGrossSalary}
                    onChange={(e) => set("monthlyGrossSalary", e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field id="emp-iban" label={intl.formatMessage({ id: "hr.employee.iban" })} hint={intl.formatMessage({ id: "hr.employee.ibanHint" })}>
                  <Input id="emp-iban" className="font-mono" disabled={readOnly} value={form.iban} onChange={(e) => set("iban", e.target.value.toUpperCase())} />
                </Field>
                <Field id="emp-bank" label={intl.formatMessage({ id: "hr.employee.bankName" })}>
                  <Input id="emp-bank" disabled={readOnly} value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
                </Field>
                <Field id="emp-commission" label={intl.formatMessage({ id: "hr.employee.commissionPlan" })} hint={intl.formatMessage({ id: "hr.employee.commissionPlanHint" })}>
                  <select
                    id="emp-commission"
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                    disabled={readOnly}
                    value={form.commissionPlanId}
                    onChange={(e) => set("commissionPlanId", e.target.value)}
                  >
                    <option value="">{intl.formatMessage({ id: "hr.employee.noCommission" })}</option>
                    {(commissionPlansQuery.data ?? [])
                      .filter((p) => p.isActive || p.id === form.commissionPlanId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            )}

            {!readOnly && (
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={saveMutation.isPending || !form.firstName.trim() || !form.monthlyGrossSalary}>
                  {saveMutation.isPending
                    ? intl.formatMessage({ id: "common.saving" })
                    : intl.formatMessage({ id: isNew ? "hr.employees.create" : "common.save" })}
                </Button>
                {isNew ? (
                  <Button type="button" variant="outline" onClick={() => navigate("/employees")} disabled={saveMutation.isPending}>
                    {intl.formatMessage({ id: "common.cancel" })}
                  </Button>
                ) : (
                  dirty && (
                    <Button type="button" variant="outline" onClick={() => setForm(initial)} disabled={saveMutation.isPending}>
                      {intl.formatMessage({ id: "hr.employee.discardChanges" })}
                    </Button>
                  )
                )}
                {isNew && <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "hr.employee.requiredHint" })}</span>}
              </div>
            )}
          </form>
        )}

        {employee && section === "contracts" && <EmployeeContracts companyId={companyId} employee={employee} readOnly={readOnly} />}
        {employee && section === "partners" && (
          <EmployeePartnerAccess companyId={companyId} employee={employee} department={department} readOnly={readOnly || isStaff} />
        )}
        {employee && section === "loans" && <EmployeeLoansPanel companyId={companyId} employeeId={employee.id} />}
        {employee && section === "statement" && <EmployeeAnnualStatement companyId={companyId} employeeId={employee.id} />}
      </CardContent>
    </Card>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
