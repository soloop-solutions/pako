import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AccountV2WriteFields } from "@/api/accounts-v2-client";
import {
  CIT_DEDUCTIBILITY_OPTIONS,
  CitDeductibility,
  CompanyProfile,
  NORMAL_BALANCE_OPTIONS,
  SUBLEDGER_TYPE_OPTIONS,
  accountStatementLabel,
  companyProfileLabels,
  deriveAccountType,
  deriveStatement,
  groupLabel,
  toggleProfileBit,
  type AccountV2,
} from "@/lib/account-v2";
import { accountSubTypeLabel, accountTypeLabel } from "@/lib/ledger-enums";

export interface GroupOption {
  accountClass: number;
  group: number;
}

interface AccountFormProps {
  mode: "create" | "edit";
  groupOptions: GroupOption[];
  initial?: AccountV2;
  defaultGroup?: GroupOption;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: AccountV2WriteFields & { code?: string }) => void;
  onCancel: () => void;
}

const PROFILE_TOGGLES = [
  { bit: CompanyProfile.Import, labelKey: "chartOfAccounts.profile.import" },
  { bit: CompanyProfile.Mfg, labelKey: "chartOfAccounts.profile.mfg" },
  { bit: CompanyProfile.Serv, labelKey: "chartOfAccounts.profile.serv" },
  { bit: CompanyProfile.Payroll, labelKey: "chartOfAccounts.profile.payroll" },
  { bit: CompanyProfile.IfrsPlus, labelKey: "chartOfAccounts.profile.ifrsPlus" },
];

export function AccountForm({ mode, groupOptions, initial, defaultGroup, submitting, error, onSubmit, onCancel }: AccountFormProps) {
  const intl = useIntl();

  const [group, setGroup] = useState<GroupOption | undefined>(
    initial ? { accountClass: initial.class ?? 0, group: initial.group ?? 0 } : defaultGroup ?? groupOptions[0],
  );
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [nameSq, setNameSq] = useState(initial?.nameSq ?? "");
  const [normalBalance, setNormalBalance] = useState<number>(initial?.normalBalance ?? 0);
  const [subledger, setSubledger] = useState<number>(initial?.subledger ?? 0);
  const [isPostable, setIsPostable] = useState(initial?.isPostable ?? true);
  const [isControl, setIsControl] = useState(initial?.isControl ?? false);
  const [defaultVatCode, setDefaultVatCode] = useState(initial?.defaultVatCode ?? "");
  const [citDeductibility, setCitDeductibility] = useState<number>(initial?.citDeductibility ?? CitDeductibility.Na);
  const [citLimitRule, setCitLimitRule] = useState(initial?.citLimitRule ?? "");
  const [profiles, setProfiles] = useState<number>(initial?.profiles ?? CompanyProfile.Core);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!group && groupOptions.length > 0) setGroup(defaultGroup ?? groupOptions[0]);
  }, [group, groupOptions, defaultGroup]);

  const derivedAccountType = group ? deriveAccountType(group.accountClass, normalBalance) : null;
  const derivedStatement = derivedAccountType != null ? deriveStatement(derivedAccountType) : null;

  function validateCode(value: string): string | null {
    if (mode === "edit") return null;
    if (!group) return intl.formatMessage({ id: "chartOfAccounts.form.groupRequired" });
    if (!/^\d{3,10}$/.test(value)) return intl.formatMessage({ id: "chartOfAccounts.form.codeFormat" });
    const prefix = String(group.group).padStart(2, "0");
    if (!value.startsWith(prefix)) {
      return intl.formatMessage({ id: "chartOfAccounts.form.codePrefixMismatch" }, { prefix });
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateCode(code);
    setCodeError(err);
    if (err) return;

    onSubmit({
      code: mode === "create" ? code.trim() : undefined,
      name,
      nameSq: nameSq.trim() || null,
      normalBalance,
      subledger,
      isPostable,
      isControl,
      defaultVatCode: defaultVatCode.trim() || null,
      citDeductibility,
      citLimitRule: citDeductibility === CitDeductibility.Limit ? citLimitRule.trim() || null : null,
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
        <div className="flex flex-col gap-1">
          <Label>{intl.formatMessage({ id: "chartOfAccounts.form.group" })}</Label>
          {mode === "create" ? (
            <Select
              value={group ? `${group.accountClass}.${group.group}` : ""}
              onChange={(e) => {
                const [cls, grp] = e.target.value.split(".").map(Number);
                setGroup({ accountClass: cls, group: grp });
              }}
              required
            >
              {groupOptions.map((g) => (
                <option key={`${g.accountClass}.${g.group}`} value={`${g.accountClass}.${g.group}`}>
                  {groupLabel(g.accountClass, g.group, intl)}
                </option>
              ))}
            </Select>
          ) : (
            <Input readOnly disabled value={group ? groupLabel(group.accountClass, group.group, intl) : ""} />
          )}
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.form.groupHint" })}</p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="account-code">{intl.formatMessage({ id: "common.code" })}</Label>
          <Input
            id="account-code"
            value={code}
            disabled={mode === "edit"}
            required
            placeholder={group ? `${String(group.group).padStart(2, "0")}0100` : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError(null);
            }}
          />
          {mode === "edit" && <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.form.codeImmutable" })}</p>}
          {codeError && <p className="text-xs text-destructive">{codeError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="account-name">{intl.formatMessage({ id: "chartOfAccounts.form.name" })}</Label>
          <Input id="account-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="account-name-sq">{intl.formatMessage({ id: "chartOfAccounts.form.nameSq" })}</Label>
          <Input id="account-name-sq" value={nameSq} onChange={(e) => setNameSq(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label>{intl.formatMessage({ id: "chartOfAccounts.form.normalBalance" })}</Label>
          <Select value={String(normalBalance)} onChange={(e) => setNormalBalance(Number(e.target.value))} required>
            {NORMAL_BALANCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {intl.formatMessage({ id: o.labelKey })}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label>{intl.formatMessage({ id: "chartOfAccounts.subledger" })}</Label>
          <Select value={String(subledger)} onChange={(e) => setSubledger(Number(e.target.value))}>
            {SUBLEDGER_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {intl.formatMessage({ id: o.labelKey })}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="account-vat">{intl.formatMessage({ id: "chartOfAccounts.vatCode" })}</Label>
          <Input
            id="account-vat"
            value={defaultVatCode}
            onChange={(e) => setDefaultVatCode(e.target.value)}
            placeholder={intl.formatMessage({ id: "chartOfAccounts.form.vatCodePlaceholder" })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>{intl.formatMessage({ id: "chartOfAccounts.citTreatment" })}</Label>
          <Select value={String(citDeductibility)} onChange={(e) => setCitDeductibility(Number(e.target.value))}>
            {CIT_DEDUCTIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {intl.formatMessage({ id: o.labelKey })}
              </option>
            ))}
          </Select>
        </div>

        {citDeductibility === CitDeductibility.Limit && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="account-cit-rule">{intl.formatMessage({ id: "chartOfAccounts.form.citLimitRule" })}</Label>
            <Input
              id="account-cit-rule"
              value={citLimitRule}
              onChange={(e) => setCitLimitRule(e.target.value)}
              placeholder={intl.formatMessage({ id: "chartOfAccounts.form.citLimitRulePlaceholder" })}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPostable} onChange={(e) => setIsPostable(e.target.checked)} />
          {intl.formatMessage({ id: "chartOfAccounts.postable" })}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isControl} onChange={(e) => setIsControl(e.target.checked)} />
          {intl.formatMessage({ id: "chartOfAccounts.control" })}
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.form.controlHint" })}</p>

      <div className="flex flex-col gap-1">
        <Label>{intl.formatMessage({ id: "chartOfAccounts.form.profiles" })}</Label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked disabled />
            {intl.formatMessage({ id: "chartOfAccounts.profile.core" })}
          </label>
          {PROFILE_TOGGLES.map(({ bit, labelKey }) => (
            <label key={bit} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
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
            {accountSubTypeLabel(subledger === 5 ? 3 : subledger === 6 ? 4 : 0, intl)}
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
