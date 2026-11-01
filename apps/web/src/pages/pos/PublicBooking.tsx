import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiException, type PublicBookedResponse, type PublicBookingServiceResponse } from "@pako/shared";
import { ArrowLeft, CalendarCheck, CheckCircle2, Clock } from "lucide-react";
import { useIntl } from "react-intl";
import { useParams } from "react-router-dom";

// Anonymous, like the public menu: the generated client only adds a bearer token when one is
// stored, which the anonymous endpoints ignore — no raw fetch.
import { apiClient, getApiErrorMessage } from "@/api/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/payroll-enums";
import { addDays, localDate, localTime, todayLocal } from "@/lib/pos-services";

const isNotFound = (err: unknown) => err instanceof ApiException && err.status === 404;
// The server books up to 90 days ahead.
const MAX_DAYS = 90;

// docs/POS_PLAN.md P4: online booking through the store's link — outside auth and the app shell,
// mobile first. Pick a service, a day, a free time (and, optionally, the person), leave a name and
// phone; the appointment lands on the store's calendar as "online". Times are Kosovo time.
export function PublicBooking() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { token = "" } = useParams();
  const today = todayLocal();
  const [service, setService] = useState<PublicBookingServiceResponse | null>(null);
  const [date, setDate] = useState(today);
  const [resourceId, setResourceId] = useState("");
  const [start, setStart] = useState<{ at: string; resourceId?: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [booked, setBooked] = useState<PublicBookedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const store = useQuery({
    queryKey: ["publicBooking", token],
    queryFn: () => apiClient.getPublicBooking(token),
    enabled: !!token,
    retry: false,
  });
  const availability = useQuery({
    queryKey: ["publicAvailability", token, service?.itemId, date, resourceId],
    queryFn: () => apiClient.getPublicAvailability(token, service?.itemId, date, resourceId || undefined),
    enabled: !!token && !!service && !!date,
    retry: false,
  });
  // With anyone: each free time once (the server picks who); with a person: their times.
  const times = useMemo(() => {
    const seen = new Map<string, { at: string; resourceId?: string }>();
    for (const r of availability.data?.resources ?? [])
      for (const at of r.starts) if (!seen.has(at)) seen.set(at, { at, resourceId: resourceId ? r.resourceId : undefined });
    return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at));
  }, [availability.data, resourceId]);

  const book = useMutation({
    mutationFn: () =>
      apiClient.bookPublicAppointment(token, {
        itemId: (service as PublicBookingServiceResponse).itemId, start: (start as { at: string }).at, name: name.trim(), phone: phone.trim(),
        resourceId: start?.resourceId, email: email.trim() || undefined, notes: notes.trim() || undefined,
      }),
    onSuccess: (result) => {
      setError(null);
      setBooked(result);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("svc.book.error"))),
  });

  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pb-16 pt-4">{children}</div>
    </div>
  );

  if (isNotFound(store.error)) {
    return shell(
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="self-end"><LanguageSwitcher /></div>
        <h1 className="text-xl font-semibold">{t("svc.book.invalid.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("svc.book.invalid")}</p>
      </div>,
    );
  }
  if (store.error) {
    return shell(
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(store.error, t("svc.book.loadError"))}</AlertDescription>
      </Alert>,
    );
  }
  if (store.isPending) return shell(<p className="py-16 text-center text-sm text-muted-foreground">{t("common.loading")}</p>);
  const data = store.data;

  const header = (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{data.storeName}</h1>
        {data.address && <p className="text-sm text-muted-foreground">{data.address}</p>}
      </div>
      <LanguageSwitcher />
    </header>
  );

  if (booked) {
    return shell(
      <>
        {header}
        <div className="flex flex-col items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-6 text-center" role="status" data-testid="booked">
          <CheckCircle2 className="size-10 text-green-700" />
          <h2 className="text-lg font-semibold">{t("svc.book.done.title")}</h2>
          <p className="text-2xl font-bold tabular-nums">{booked.number}</p>
          <p>
            {t("svc.book.done.when", {
              date: intl.formatDate(new Date(`${localDate(booked.start)}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
              time: localTime(booked.start),
            })}
          </p>
          <p>{t("svc.book.done.with", { name: booked.resourceName })}</p>
          <p className="text-sm text-muted-foreground">{t("svc.book.done.hint")}</p>
        </div>
      </>,
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    book.mutate();
  }

  // Step 1: the service.
  if (!service) {
    return shell(
      <>
        {header}
        <h2 className="text-base font-semibold">{t("svc.book.pickService")}</h2>
        {data.services.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("svc.book.noServices")}</p>}
        <ul className="flex flex-col divide-y rounded-md border">
          {data.services.map((s) => (
            <li key={s.itemId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent"
                onClick={() => {
                  setService(s);
                  setResourceId("");
                  setStart(null);
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.name}</p>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="size-3" /> {t("svc.minutes", { n: s.durationMinutes })}
                  </p>
                </div>
                {s.price != null && <span className="text-sm font-semibold tabular-nums">{formatAmount(s.price)} €</span>}
              </button>
            </li>
          ))}
        </ul>
      </>,
    );
  }

  // Step 2–3: the day, the person, the time, then who is coming.
  return shell(
    <>
      {header}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setService(null)} aria-label={t("svc.book.back")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <p className="font-medium">{service.name}</p>
          <p className="text-sm text-muted-foreground">
            {t("svc.minutes", { n: service.durationMinutes })}
            {service.price != null ? ` · ${formatAmount(service.price)} €` : ""}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="book-date">{t("svc.book.day")}</Label>
          <Input
            id="book-date"
            type="date"
            min={today}
            max={addDays(today, MAX_DAYS)}
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setDate(e.target.value);
              setStart(null);
            }}
          />
        </div>
        {service.resources.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="book-person">{t("svc.book.person")}</Label>
            <select
              id="book-person"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={resourceId}
              onChange={(e) => {
                setResourceId(e.target.value);
                setStart(null);
              }}
            >
              <option value="">{t("svc.book.person.any")}</option>
              {service.resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("svc.book.pickTime")}</h2>
        {availability.isPending && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {availability.error && <p className="text-sm text-destructive">{getApiErrorMessage(availability.error, t("svc.book.loadError"))}</p>}
        {availability.data && times.length === 0 && <p className="text-sm text-muted-foreground">{t("svc.book.noTimes")}</p>}
        <div className="grid grid-cols-4 gap-2" data-testid="book-times">
          {times.map((x) => {
            const chosen = start?.at === x.at;
            return (
              <Button
                key={x.at}
                type="button"
                variant={chosen ? "default" : "outline"}
                className="tabular-nums"
                aria-pressed={chosen}
                onClick={() => setStart(x)}
              >
                {localTime(x.at)}
              </Button>
            );
          })}
        </div>
      </section>
      {start && (
        <form className="flex flex-col gap-3 rounded-md border p-3" onSubmit={submit}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarCheck className="size-4" />
            {t("svc.book.chosen", { date, time: localTime(start.at) })}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="book-name">{t("svc.book.name")}</Label>
            <Input id="book-name" required autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="book-phone">{t("svc.phone")}</Label>
            <Input id="book-phone" required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="book-email">{t("svc.book.email")}</Label>
            <Input id="book-email" type="email" autoComplete="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="book-notes">{t("svc.notes")}</Label>
            <Textarea id="book-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" className="h-11" disabled={!name.trim() || !phone.trim() || book.isPending}>{t("svc.book.confirm")}</Button>
        </form>
      )}
    </>,
  );
}
