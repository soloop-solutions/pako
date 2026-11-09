import { useEffect, useRef, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountGroupResponse, AccountResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CIT_DEDUCTIBILITY_OPTIONS,
  CitDeductibility,
  CompanyProfile,
  NORMAL_BALANCE_OPTIONS,
  SUBLEDGER_TYPE_OPTIONS,
  SubledgerType,
  accountClassFromCode,
  accountGroupFromCode,
  accountGroupLabel,
  accountStatementLabel,
  companyProfileLabels,
  deriveAccountSubType,
  deriveAccountType,
  deriveStatement,
  toggleProfileBit,
} from "@/lib/account-v2";
import { accountSubTypeLabel, accountTypeLabel } from "@/lib/ledger-enums";

export interface AccountFormFields {
  code: string;
  name: string;
  nameSq: string | undefined;
  accountType: number;
  accountSubType: number;
  isReconcilable: boolean;
  class: number;
  group: number;
  statement: number;
  normalBalance: number;
  subledger: number;
  isControl: boolean;
  isPostable: boolean;
  defaultVatCode: string | undefined;
  citDeductibility: number;
  citLimitRule: string | undefined;
  profiles: number;
}

interface AccountFormProps {
  mode: "create" | "edit";
  groupOptions: AccountGroupResponse[];
  groupsById: Map<string, AccountGroupResponse>;
  initial?: AccountResponse;
  defaultGroup?: AccountGroupResponse;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: AccountFormFields) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const PROFILE_TOGGLES = [
  { bit: CompanyProfile.Import, labelKey: "chartOfAccounts.profile.import" },
  { bit: CompanyProfile.Mfg, labelKey: "chartOfAccounts.profile.mfg" },
  { bit: CompanyProfile.Serv, labelKey: "chartOfAccounts.profile.serv" },
  { bit: CompanyProfile.Payroll, labelKey: "chartOfAccounts.profile.payroll" },
  { bit: CompanyProfile.IfrsPlus, labelKey: "chartOfAccounts.profile.ifrsPlus" },
];

function findInitialGroup(initial: AccountResponse | undefined, groupOptions: AccountGroupResponse[]): AccountGroupResponse | undefined {
  if (!initial?.groupId) return undefined;
  return groupOptions.find((g) => g.id === initial.groupId);
}

export function AccountForm({ mode, groupOptions, groupsById, initial, defaultGroup, submitting, error, onSubmit, onCancel, onDirtyChange }: AccountFormProps) {
  const intl = useIntl();

  const [group, setGroup] = useState<AccountGroupResponse | undefined>(
    findInitialGroup(initial, groupOptions) ?? defaultGroup ?? groupOptions[0],
  );
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");

  const initialNameRef = useRef(initial?.name ?? "");
  useEffect(() => {
    onDirtyChange?.(name !== initialNameRef.current);
  }, [name, onDirtyChange]);
  const [nameSq, setNameSq] = useState(initial?.nameSq ?? "");
  const [normalBalance, setNormalBalance] = useState<number>(initial?.normalBalance ?? 0);
  const [subledger, setSubledger] = useState<number>(initial?.subledger ?? 0);
  const [isPostable, setIsPostable] = useState(initial?.isPostable ?? true);
  const [isControl, setIsControl] = useState(initial?.isControl ?? false);
  const [defaultVatCode, setDefaultVatCode] = useState(initial?.defaultVatCode ?? "");
  const [citDeductibility, setCitDeductibility] = useState<number>(initial?.citDeductibility ?? CitDeductibility.Na);
  const [citLimitRule, setCitLimitRule] = useState(initial?.citLimitRule ?? "");
  const [profiles, setProfiles] = useState<number>(initial?.profiles ?? CompanyProfile.Core);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!group && groupOptions.length > 0) setGroup(defaultGroup ?? groupOptions[0]);
  }, [group, groupOptions, defaultGroup]);

  const groupClass = group ? accountClassFromCode(group.codePrefixStart) : null;
  const previewGroup = group ? accountGroupFromCode(group.codePrefixStart) : null;
  const derivedAccountType = groupClass != null ? deriveAccountType(code.trim(), groupClass, previewGroup, normalBalance) : null;
  const derivedStatement = derivedAccountType != null ? deriveStatement(derivedAccountType) : null;

  // Account codes are always 6 digits in this chart, matching AccountGroup's own CodePrefixStart/
  // CodePrefixEnd (backend/Pako.Domain/Ledger/AccountGroupResolver.cs compares them ordinally as
  // plain strings) — a code of any other length would come back with no groupId at all, so this
  // is checked here rather than letting an account silently land outside every group's tree.
  function validateCode(value: string): string | null {
    if (mode === "edit") return null;
    if (!group) return intl.formatMessage({ id: "chartOfAccounts.form.groupRequired" });
    if (!/^\d{6}$/.test(value)) return intl.formatMessage({ id: "chartOfAccounts.form.codeFormat" });
    if (value < group.codePrefixStart || value > group.codePrefixEnd) {
      return intl.formatMessage(
        { id: "chartOfAccounts.form.codePrefixMismatch" },
        { start: group.codePrefixStart, end: group.codePrefixEnd },
      );
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string | null> = {};
    errors.code = validateCode(code);
    errors.name = name.trim() ? null : intl.formatMessage({ id: "chartOfAccounts.form.nameRequired" });
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    const accountClass = group ? accountClassFromCode(group.codePrefixStart) : null;
    const accountGroup = group ? accountGroupFromCode(group.codePrefixStart) : null;
    if (accountClass == null || accountGroup == null) return;

    const accountType = deriveAccountType(code.trim(), accountClass, accountGroup, normalBalance);

    onSubmit({
      code: code.trim(),
      name,
      nameSq: nameSq.trim() || undefined,
      accountType,
      accountSubType: deriveAccountSubType(subledger),
      isReconcilable: subledger === SubledgerType.Partner,
      class: accountClass,
      group: accountGroup,
      statement: deriveStatement(accountType),
      normalBalance,
      subledger,
      isControl,
      isPostable,
      defaultVatCode: defaultVatCode.trim() || undefined,
      citDeductibility,
      citLimitRule: citDeductibility === CitDeductibility.Limit ? citLimitRule.trim() || undefined : undefined,
      profiles,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label={intl.formatMessage({ id: "chartOfAccounts.form.group" })}
          hint={intl.formatMessage({ id: "chartOfAccounts.form.groupHint" })}
        >
          {mode === "create" ? (
            <Select
              value={group?.id ?? ""}
              onValueChange={(v) => setGroup(groupOptions.find((g) => g.id === v))}
              options={groupOptions.map((g) => ({
                value: g.id,
                label: accountGroupLabel(g, groupsById, intl),
              }))}
            />
          ) : (
            <Input readOnly disabled value={group ? accountGroupLabel(group, groupsById, intl) : ""} />
          )}
        </FormField>

        <FormField
          label={intl.formatMessage({ id: "common.code" })}
          htmlFor="account-code"
          error={fieldErrors.code}
          hint={mode === "edit" ? intl.formatMessage({ id: "chartOfAccounts.form.codeImmutable" }) : undefined}
        >
          <Input
            id="account-code"
            value={code}
            disabled={mode === "edit"}
            required
            aria-invalid={!!fieldErrors.code}
            placeholder={group ? group.codePrefixStart : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              setFieldErrors((prev) => ({ ...prev, code: null }));
            }}
          />
        </FormField>

        <FormField
          label={intl.formatMessage({ id: "chartOfAccounts.form.name" })}
          htmlFor="account-name"
          required
          error={fieldErrors.name}
        >
          <Input
            id="account-name"
            required
            value={name}
            aria-invalid={!!fieldErrors.name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, name: null }));
            }}
          />
        </FormField>

        <FormField
          label={intl.formatMessage({ id: "chartOfAccounts.form.nameSq" })}
          htmlFor="account-name-sq"
        >
          <Input id="account-name-sq" value={nameSq} onChange={(e) => setNameSq(e.target.value)} />
        </FormField>

        <FormField label={intl.formatMessage({ id: "chartOfAccounts.form.normalBalance" })}>
          <Select
            value={String(normalBalance)}
            onValueChange={(v) => setNormalBalance(Number(v))}
            options={NORMAL_BALANCE_OPTIONS.map((o) => ({
              value: String(o.value),
              label: intl.formatMessage({ id: o.labelKey }),
            }))}
          />
        </FormField>

        <FormField label={intl.formatMessage({ id: "chartOfAccounts.subledger" })}>
          <Select
            value={String(subledger)}
            onValueChange={(v) => setSubledger(Number(v))}
            options={SUBLEDGER_TYPE_OPTIONS.map((o) => ({
              value: String(o.value),
              label: intl.formatMessage({ id: o.labelKey }),
            }))}
          />
        </FormField>

        <FormField
          label={intl.formatMessage({ id: "chartOfAccounts.vatCode" })}
          htmlFor="account-vat"
        >
          <Input
            id="account-vat"
            value={defaultVatCode}
            onChange={(e) => setDefaultVatCode(e.target.value)}
            placeholder={intl.formatMessage({ id: "chartOfAccounts.form.vatCodePlaceholder" })}
          />
        </FormField>

        <FormField label={intl.formatMessage({ id: "chartOfAccounts.citTreatment" })}>
          <Select
            value={String(citDeductibility)}
            onValueChange={(v) => setCitDeductibility(Number(v))}
            options={CIT_DEDUCTIBILITY_OPTIONS.map((o) => ({
              value: String(o.value),
              label: intl.formatMessage({ id: o.labelKey }),
            }))}
          />
        </FormField>

        {citDeductibility === CitDeductibility.Limit && (
          <FormField
            label={intl.formatMessage({ id: "chartOfAccounts.form.citLimitRule" })}
            htmlFor="account-cit-rule"
            className="sm:col-span-2"
          >
            <Input
              id="account-cit-rule"
              value={citLimitRule}
              onChange={(e) => setCitLimitRule(e.target.value)}
              placeholder={intl.formatMessage({ id: "chartOfAccounts.form.citLimitRulePlaceholder" })}
            />
          </FormField>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isPostable} onChange={(e) => setIsPostable(e.target.checked)} />
          {intl.formatMessage({ id: "chartOfAccounts.postable" })}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isControl} onChange={(e) => setIsControl(e.target.checked)} />
          {intl.formatMessage({ id: "chartOfAccounts.control" })}
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.form.controlHint" })}</p>

      <div className="flex flex-col gap-1">
        <Label>{intl.formatMessage({ id: "chartOfAccounts.form.profiles" })}</Label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked disabled />
            {intl.formatMessage({ id: "chartOfAccounts.profile.core" })}
          </label>
          {PROFILE_TOGGLES.map(({ bit, labelKey }) => (
            <label key={bit} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={(profiles & bit) === bit}
                onChange={() => setProfiles((p) => toggleProfileBit(p, bit))}
              />
              {intl.formatMessage({ id: labelKey })}
            </label>
          ))}
        </div>
      </div>

      {group && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{intl.formatMessage({ id: "chartOfAccounts.form.inheritedTitle" })}</p>
          <p>
            {intl.formatMessage({ id: "common.type" })}: {derivedAccountType != null ? accountTypeLabel(derivedAccountType, intl) : "—"} ·{" "}
            {intl.formatMessage({ id: "chartOfAccounts.statement" })}: {derivedStatement != null ? accountStatementLabel(derivedStatement, intl) : "—"} ·{" "}
            {intl.formatMessage({ id: "chartOfAccounts.subType" })}:{" "}
            {accountSubTypeLabel(deriveAccountSubType(subledger), intl)}
          </p>
          <p className="mt-1">{companyProfileLabels(profiles, intl).join(" · ")}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: mode === "create" ? "chartOfAccounts.form.create" : "common.save" })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
      </div>
    </form>
  );
}
