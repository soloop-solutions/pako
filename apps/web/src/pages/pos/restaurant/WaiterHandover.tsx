import { useState } from "react";
import type { WaiterSummaryResponse } from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// docs/POS_PLAN.md §6.2: the waiter's cash bag, settled at shift end. Every figure is the
// server's (WaiterSummaryResponse); the amount handed over is typed, and a mismatch with what the
// server expects only asks for a reason — the difference itself is the server's.
export function WaiterHandover({ sessionId }: { sessionId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompanyId();
  const queryClient = useQueryClient();
  const key = ["posSessionWaiters", activeCompanyId, sessionId];
  const waiters = useQuery({
    queryKey: key,
    queryFn: () => apiClient.listPosSessionWaiters(activeCompanyId, sessionId),
    staleTime: 0,
    retry: false,
  });
  const list = waiters.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="waiter-handover">
      <h3 className="text-sm font-semibold">{t("rest.handover.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("rest.handover.description")}</p>
      {list.map((w) => (
        <WaiterRow key={w.waiterUserId} waiter={w} sessionId={sessionId} onSettled={(all) => queryClient.setQueryData(key, all)} />
      ))}
    </section>
  );
}

function useCompanyId() {
  const { activeCompanyId } = useCompany();
  return { activeCompanyId: activeCompanyId as string };
}

function WaiterRow({ waiter, sessionId, onSettled }: {
  waiter: WaiterSummaryResponse;
  sessionId: string;
  onSettled: (all: WaiterSummaryResponse[]) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompanyId();
  const [handed, setHanded] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const settle = useMutation({
    mutationFn: () =>
      apiClient.settlePosWaiter(activeCompanyId, sessionId, {
        waiterUserId: waiter.waiterUserId, handed: Number(handed), ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (all) => {
      setError(null);
      onSettled(all);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const typed = handed.trim();
  const value = Number(typed);
  const valid = typed !== "" && Number.isFinite(value) && value >= 0;
  // A comparison with the server's figure, nothing worked out.
  const differs = valid && value !== waiter.cashExpected;
  const s = waiter.settlement;
  const cell = (label: string, amount: string, strong = false) => (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{amount}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 border-t pt-2 text-sm" data-testid="waiter-row">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{waiter.waiterName}</span>
        {s && (
          <Badge variant={s.difference === 0 ? "success" : "warning"}>
            {t("rest.handover.settled", { handed: money(s.handed), difference: money(s.difference) })}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-right sm:grid-cols-6">
        {cell(t("rest.handover.orders"), String(waiter.orders))}
        {cell(t("rest.handover.netSales"), money(waiter.netSales))}
        {cell(t("rest.handover.cash"), money(waiter.cash))}
        {cell(t("rest.handover.other"), money(waiter.otherTenders))}
        {cell(t("rest.handover.tips"), money(waiter.tips))}
        {cell(t("rest.handover.expected"), money(waiter.cashExpected), true)}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!s && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("rest.handover.handed", { name: waiter.waiterName })}
            placeholder={t("rest.handover.handedPlaceholder")}
            type="number"
            min={0}
            step="0.01"
            value={handed}
            onChange={(e) => setHanded(e.target.value)}
            className="h-8 w-32 text-right tabular-nums"
          />
          {differs && (
            <Input
              aria-label={t("rest.handover.reason")}
              placeholder={t("rest.handover.reason")}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 min-w-48 flex-1"
            />
          )}
          <Button size="sm" disabled={!valid || (differs && !reason.trim()) || settle.isPending} onClick={() => settle.mutate()}>
            {t("rest.handover.confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}
