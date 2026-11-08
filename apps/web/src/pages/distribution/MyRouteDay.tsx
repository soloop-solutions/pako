import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteDayStopResponse } from "@pako/shared";
import { CalendarOff, ChevronLeft, ChevronRight, MapPin, ShoppingCart } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { dateToIso, isoToDate } from "@/lib/dates";
import { currentPosition } from "@/lib/geolocation";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { RouteVisitOutcome, VISIT_OUTCOMES, isoToday } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";

function isDone(stop: RouteDayStopResponse): boolean {
  return stop.outcome != null && stop.outcome !== RouteVisitOutcome.Open;
}

function shiftDay(iso: string, delta: number): string {
  const base = isoToDate(iso) ?? new Date();
  base.setDate(base.getDate() + delta);
  return dateToIso(base);
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-semibold tnum leading-none", tone === "warning" && value > 0 && "text-warning-foreground")}>{value}</span>
    </div>
  );
}

function DaySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

// docs/POS_PLAN.md P6 — the salesperson's day on the phone: today's stops in order, what each
// customer owes, check in at the door, record what came of it, start an order.
export function MyRouteDay() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [date, setDate] = useUrlParam("date", isoToday());
  const query = useQuery({
    queryKey: ["myRouteDay", activeCompanyId, date],
    queryFn: () => apiClient.getMyRouteDay(activeCompanyId as string, date || undefined),
    enabled: !!activeCompanyId,
  });

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const routes = query.data ?? [];
  const allStops = routes.flatMap((route) => route.stops);
  const visited = allStops.filter(isDone).length;
  const blocked = allStops.filter((stop) => stop.blocked).length;
  const overdueCount = allStops.filter((stop) => stop.overdue > 0).length;
  const nextKey = (() => {
    for (const route of routes) {
      const next = [...route.stops].sort((a, b) => a.sequence - b.sequence).find((stop) => !isDone(stop));
      if (next) return `${route.routeId}-${next.partnerId}`;
    }
    return null;
  })();
  const today = isoToday();
  const percent = allStops.length === 0 ? 0 : Math.round((visited / allStops.length) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("nav.myRouteDay")}</h2>
          <p className="text-sm text-muted-foreground">{t("nav.myRouteDay.description")}</p>
        </div>
        <div className="flex items-end gap-1.5">
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("dist.day.previous")} onClick={() => setDate(shiftDay(date || today, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex flex-col gap-1">
            <Label htmlFor="day-date">{t("dist.date")}</Label>
            <Input id="day-date" type="date" required className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("dist.day.next")} onClick={() => setDate(shiftDay(date || today, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={date === today} onClick={() => setDate(today)}>
            {t("date.today")}
          </Button>
        </div>
      </div>

      {allStops.length > 0 && (
        <section aria-label={t("dist.day.summary")} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Stat label={t("dist.day.stops")} value={allStops.length} />
            <Stat label={t("dist.day.visited")} value={visited} />
            <Stat label={t("dist.day.remaining")} value={allStops.length - visited} />
            <Stat label={t("dist.day.withOverdue")} value={overdueCount} tone="warning" />
            <Stat label={t("dist.day.blockedCount")} value={blocked} tone="warning" />
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={allStops.length}
            aria-valuenow={visited}
            aria-label={t("dist.day.visited")}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
        </section>
      )}

      {query.isPending && <DaySkeleton />}
      {query.isError && <p className="text-sm text-destructive" role="alert">{getApiErrorMessage(query.error, t("dist.day.loadError"))}</p>}
      {!query.isPending && !query.isError && routes.length === 0 && (
        <EmptyState
          icon={CalendarOff}
          title={t("dist.day.empty")}
          description={t("dist.day.emptyHint")}
          actions={
            <>
              {date !== today && (
                <Button type="button" size="sm" onClick={() => setDate(today)}>
                  {t("dist.day.goToday")}
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link to="/distribution/routes">{t("dist.day.openRoutes")}</Link>
              </Button>
            </>
          }
        />
      )}
      {routes.map((route) => {
        const routeDone = route.stops.filter(isDone).length;
        return (
          <Card key={route.routeId}>
            <CardHeader>
              <CardTitle>{route.name}</CardTitle>
              <CardDescription>
                {intl.formatMessage({ id: "dist.day.stopCount" }, { count: route.stops.length })}
                {" · "}
                {intl.formatMessage({ id: "dist.day.routeProgress" }, { done: routeDone, total: route.stops.length })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[...route.stops].sort((a, b) => a.sequence - b.sequence).map((stop) => (
                <StopCard
                  key={`${stop.partnerId}-${stop.visitId ?? ""}`}
                  stop={stop}
                  routeId={route.routeId}
                  date={date}
                  isNext={nextKey === `${route.routeId}-${stop.partnerId}`}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StopCard({ stop, routeId, date, isNext }: { stop: RouteDayStopResponse; routeId: string; date: string; isNext: boolean }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [outcome, setOutcome] = useState<number>(stop.outcome ?? RouteVisitOutcome.Open);
  const [collected, setCollected] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["myRouteDay", activeCompanyId, date] });

  const checkIn = useMutation({
    mutationFn: async () => {
      const position = await currentPosition();
      return apiClient.checkInRouteVisit(activeCompanyId as string, {
        partnerId: stop.partnerId,
        routeId,
        latitude: position?.latitude,
        longitude: position?.longitude,
        accuracyMeters: position?.accuracy,
      });
    },
    onSuccess: async (visit) => {
      setMessage({ text: t(visit.latitude == null ? "dist.visit.checkedInNoPosition" : "dist.visit.checkedIn"), error: false });
      await refresh();
    },
    onError: (err: unknown) => setMessage({ text: getApiErrorMessage(err, t("dist.visit.checkInError")), error: true }),
  });
  const record = useMutation({
    mutationFn: (checkOut: boolean) => apiClient.updateRouteVisit(activeCompanyId as string, stop.visitId as string, {
      outcome,
      collected: collected.trim() === "" ? 0 : Number(collected.replace(",", ".")),
      notes: notes.trim() || undefined,
      checkOut,
    }),
    onSuccess: async () => {
      setMessage({ text: t("dist.visit.saved"), error: false });
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["routeVisits", activeCompanyId] });
    },
    onError: (err: unknown) => setMessage({ text: getApiErrorMessage(err, t("dist.visit.saveError")), error: true }),
  });

  const checkedIn = !!stop.visitId;
  const done = isDone(stop);
  if (done && !expanded) {
    return (
      <article className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2" aria-label={stop.partnerName}>
        <p className="text-sm text-muted-foreground">
          <span className="mr-1 tnum">{stop.sequence}.</span>
          {stop.partnerName}
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="success">{t(`dist.visit.outcome.${stop.outcome}`)}</Badge>
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setExpanded(true)}>
            {t("dist.day.details")}
          </button>
        </div>
      </article>
    );
  }
  return (
    <article
      className={cn("flex flex-col gap-3 rounded-lg border p-3", done && "bg-muted/40", isNext && "border-primary ring-1 ring-primary/40")}
      aria-label={stop.partnerName}
      aria-current={isNext ? "step" : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            <span className="mr-1 text-muted-foreground tnum">{stop.sequence}.</span>
            {stop.partnerName}
          </p>
          {stop.notes && <p className="text-xs text-muted-foreground">{stop.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {isNext && <Badge variant="info">{t("dist.day.nextStop")}</Badge>}
          {stop.blocked && <Badge variant="destructive">{t("dist.credit.blocked")}</Badge>}
          {stop.overdue > 0 && <Badge variant="warning">{t("dist.stop.overdue", { amount: formatAmount(stop.overdue) })}</Badge>}
          {stop.outstanding > 0 && <Badge variant="outline">{t("dist.stop.outstanding", { amount: formatAmount(stop.outstanding) })}</Badge>}
          {done && <Badge variant="success">{t(`dist.visit.outcome.${stop.outcome}`)}</Badge>}
        </div>
      </div>

      {!checkedIn ? (
        canWrite("sales") && (
          <Button className="h-11 w-full sm:w-fit" disabled={checkIn.isPending} onClick={() => checkIn.mutate()}>
            <MapPin className="size-4" />
            {t("dist.visit.checkIn")}
          </Button>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t("dist.visit.outcome")}>
            {VISIT_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn(
                  "h-10 rounded-md border px-2 text-sm font-medium",
                  outcome === o ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                )}
              >
                {t(`dist.visit.outcome.${o}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`collected-${stop.visitId}`}>{t("dist.visit.collected")}</Label>
              <Input id={`collected-${stop.visitId}`} inputMode="decimal" className="text-right tnum" value={collected}
                onChange={(e) => setCollected(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`notes-${stop.visitId}`}>{t("dist.visit.notes")}</Label>
              <Textarea id={`notes-${stop.visitId}`} rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" variant="outline" disabled={!canWrite("sales")}
              onClick={() => navigate(`/sales-orders/new?partner=${stop.partnerId}&visit=${stop.visitId}`)}>
              <ShoppingCart className="size-4" />
              {t("dist.visit.newOrder")}
            </Button>
            <Button className="h-10" variant="outline" disabled={record.isPending || outcome === RouteVisitOutcome.Open} onClick={() => record.mutate(false)}>
              {t("dist.visit.save")}
            </Button>
            <Button className="h-10" disabled={record.isPending || outcome === RouteVisitOutcome.Open} onClick={() => record.mutate(true)}>
              {t("dist.visit.checkOut")}
            </Button>
          </div>
        </div>
      )}
      {message && <p className={cn("text-sm", message.error ? "text-destructive" : "text-muted-foreground")} role="status">{message.text}</p>}
    </article>
  );
}
