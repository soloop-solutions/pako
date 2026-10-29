import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { AccountGroupResponse, AccountResponse } from "@pako/shared";

import { Badge } from "@/components/ui/badge";
import { CitDeductibility, citDeductibilityLabel } from "@/lib/account-v2";
import { accountTypeLabel } from "@/lib/ledger-enums";

// ---------------------------------------------------------------------------
// Statement-type buckets derived from the account's `class` field (1-7).
// The five buckets match the standard financial-statement grouping used in
// Kosovo's Plani Kontabel v2.0.
// ---------------------------------------------------------------------------

type StatementBucket = "assets" | "liabilities" | "equity" | "revenue" | "expenses" | "other";

const BUCKET_ORDER: StatementBucket[] = ["assets", "liabilities", "equity", "revenue", "expenses", "other"];

const BUCKET_I18N: Record<StatementBucket, string> = {
  assets: "chartOfAccounts.tree.assets",
  liabilities: "chartOfAccounts.tree.liabilities",
  equity: "chartOfAccounts.tree.equity",
  revenue: "chartOfAccounts.tree.revenue",
  expenses: "chartOfAccounts.tree.expenses",
  other: "chartOfAccounts.tree.other",
};

const BUCKET_COLORS: Record<StatementBucket, string> = {
  assets: "border-l-blue-500",
  liabilities: "border-l-amber-500",
  equity: "border-l-emerald-500",
  revenue: "border-l-green-500",
  expenses: "border-l-red-500",
  other: "border-l-gray-400",
};

const BUCKET_BG: Record<StatementBucket, string> = {
  assets: "bg-blue-50 dark:bg-blue-950/30",
  liabilities: "bg-amber-50 dark:bg-amber-950/30",
  equity: "bg-emerald-50 dark:bg-emerald-950/30",
  revenue: "bg-green-50 dark:bg-green-950/30",
  expenses: "bg-red-50 dark:bg-red-950/30",
  other: "bg-gray-50 dark:bg-gray-950/30",
};

function classToBucket(cls: number | undefined | null): StatementBucket {
  if (cls === 1) return "assets";
  if (cls === 2) return "liabilities";
  if (cls === 3) return "equity";
  if (cls === 4) return "revenue";
  if (cls === 5 || cls === 6 || cls === 7) return "expenses";
  return "other";
}

// ---------------------------------------------------------------------------
// Build tree structure: Bucket -> Group -> Account[]
// ---------------------------------------------------------------------------

interface GroupNode {
  groupId: string;
  label: string;
  accounts: AccountResponse[];
}

interface BucketNode {
  bucket: StatementBucket;
  groups: GroupNode[];
  totalAccounts: number;
}

function buildTree(
  accounts: AccountResponse[],
  groupsById: Map<string, AccountGroupResponse>,
  groupLabel: (g: AccountGroupResponse | undefined) => string,
): BucketNode[] {
  // Bucket -> groupId -> accounts
  const bucketMap = new Map<StatementBucket, Map<string, AccountResponse[]>>();

  for (const account of accounts) {
    const bucket = classToBucket(account.class);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
    const groupMap = bucketMap.get(bucket)!;
    const gId = account.groupId ?? "__ungrouped__";
    if (!groupMap.has(gId)) groupMap.set(gId, []);
    groupMap.get(gId)!.push(account);
  }

  const result: BucketNode[] = [];

  for (const bucket of BUCKET_ORDER) {
    const groupMap = bucketMap.get(bucket);
    if (!groupMap) continue;

    const groups: GroupNode[] = [];
    let totalAccounts = 0;

    // Sort groups by their codePrefixStart
    const sortedEntries = [...groupMap.entries()].sort((a, b) => {
      const gA = groupsById.get(a[0]);
      const gB = groupsById.get(b[0]);
      const codeA = gA?.codePrefixStart ?? "999999";
      const codeB = gB?.codePrefixStart ?? "999999";
      return codeA.localeCompare(codeB);
    });

    for (const [gId, accts] of sortedEntries) {
      const sorted = accts.slice().sort((a, b) => a.code.localeCompare(b.code));
      const group = groupsById.get(gId);
      groups.push({
        groupId: gId,
        label: groupLabel(group),
        accounts: sorted,
      });
      totalAccounts += sorted.length;
    }

    result.push({ bucket, groups, totalAccounts });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ToggleButton({
  expanded,
  onClick,
  children,
  className,
}: {
  expanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className ?? ""}`}
    >
      {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
}

function AccountRow({ account, onEdit }: { account: AccountResponse; onEdit?: (id: string) => void }) {
  const intl = useIntl();
  const inactive = !account.isActive;

  return (
    <div
      className={`flex items-center gap-3 border-b border-border/40 py-1.5 pl-12 pr-3 text-sm hover:bg-muted/50 ${
        inactive ? "text-muted-foreground/70" : ""
      }`}
    >
      <span className={`w-20 shrink-0 font-mono tabular-nums ${inactive ? "line-through" : ""}`}>{account.code}</span>
      <span className={`min-w-0 flex-1 truncate ${inactive ? "line-through" : ""}`}>
        {account.name}
        {account.nameSq && <span className="ml-1.5 text-xs text-muted-foreground">({account.nameSq})</span>}
      </span>
      <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{accountTypeLabel(account.accountType, intl)}</span>
      {account.defaultVatCode && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{account.defaultVatCode}</span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {account.isControl && <Badge variant="secondary" className="text-[10px] leading-tight">{intl.formatMessage({ id: "chartOfAccounts.control" })}</Badge>}
        {!account.isPostable && <Badge variant="outline" className="text-[10px] leading-tight">{intl.formatMessage({ id: "chartOfAccounts.header" })}</Badge>}
        {!account.isActive && <Badge variant="destructive" className="text-[10px] leading-tight">{intl.formatMessage({ id: "common.inactive" })}</Badge>}
        {account.citDeductibility === CitDeductibility.Non && (
          <Badge variant="destructive" className="text-[10px] leading-tight">{citDeductibilityLabel(account.citDeductibility, intl)}</Badge>
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(account.id)}
          className="shrink-0 text-xs text-primary hover:underline"
        >
          {intl.formatMessage({ id: "common.edit" })}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tree component
// ---------------------------------------------------------------------------

interface ChartOfAccountsTreeProps {
  accounts: AccountResponse[];
  groupsById: Map<string, AccountGroupResponse>;
  groupLabel: (g: AccountGroupResponse | undefined) => string;
  onEdit?: (id: string) => void;
}

export function ChartOfAccountsTree({ accounts, groupsById, groupLabel, onEdit }: ChartOfAccountsTreeProps) {
  const intl = useIntl();

  const tree = useMemo(() => buildTree(accounts, groupsById, groupLabel), [accounts, groupsById, groupLabel]);

  // Track expanded state: key = "bucket" or "bucket:groupId"
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Start with all buckets expanded
    return new Set(BUCKET_ORDER);
  });

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (tree.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{intl.formatMessage({ id: "chartOfAccounts.noAccounts" })}</p>;
  }

  return (
    <div className="rounded-md border">
      {tree.map((bucketNode) => {
        const bucketKey = bucketNode.bucket;
        const bucketExpanded = expanded.has(bucketKey);

        return (
          <div key={bucketKey} className={`border-l-4 ${BUCKET_COLORS[bucketNode.bucket]}`}>
            {/* Level 0: Statement type */}
            <ToggleButton
              expanded={bucketExpanded}
              onClick={() => toggle(bucketKey)}
              className={`px-3 py-2 font-semibold ${BUCKET_BG[bucketNode.bucket]}`}
            >
              <span className="flex-1">{intl.formatMessage({ id: BUCKET_I18N[bucketNode.bucket] })}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {intl.formatMessage({ id: "chartOfAccounts.tree.accountCount" }, { count: bucketNode.totalAccounts })}
              </span>
            </ToggleButton>

            {bucketExpanded &&
              bucketNode.groups.map((groupNode) => {
                const groupKey = `${bucketKey}:${groupNode.groupId}`;
                const groupExpanded = expanded.has(groupKey);

                return (
                  <div key={groupNode.groupId}>
                    {/* Level 1: Account group */}
                    <ToggleButton
                      expanded={groupExpanded}
                      onClick={() => toggle(groupKey)}
                      className="border-b border-border/30 py-1.5 pl-6 pr-3 font-medium"
                    >
                      <span className="flex-1">{groupNode.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {intl.formatMessage({ id: "chartOfAccounts.tree.accountCount" }, { count: groupNode.accounts.length })}
                      </span>
                    </ToggleButton>

                    {/* Level 2: Individual accounts */}
                    {groupExpanded &&
                      groupNode.accounts.map((account) => (
                        <AccountRow key={account.id} account={account} onEdit={onEdit} />
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
