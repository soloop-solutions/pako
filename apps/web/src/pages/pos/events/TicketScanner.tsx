import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ScanTicketResponse } from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, CameraOff } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";
import { VENUE_TIME_ZONE } from "@/pages/pos/hotel/hotel-utils";

/** How long a verdict stays on screen before the scanner is ready for the next guest. */
const CLEAR_AFTER_MS = 3500;

// The browser's barcode reader (Chrome/Android, Safari 17+); not in TypeScript's DOM types yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
const detectorCtor = (): BarcodeDetectorCtor | undefined =>
  (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

type Verdict =
  | { kind: "valid"; ticketType?: string }
  | { kind: "used"; ticketType?: string; usedAt?: string }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

const VERDICT_CLASS: Record<Verdict["kind"], string> = {
  valid: "bg-emerald-600 text-white",
  used: "bg-orange-500 text-white",
  invalid: "bg-red-600 text-white",
  error: "bg-red-900 text-white",
};

function toVerdict(r: ScanTicketResponse): Verdict {
  if (r.result === "Valid") return { kind: "valid", ticketType: r.ticketType };
  if (r.result === "AlreadyUsed") return { kind: "used", ticketType: r.ticketType, usedAt: r.usedAt };
  return { kind: "invalid" };
}

// docs/POS_PLAN.md §6.5 / P5: the door. Full screen like the kitchen display; the event is a URL
// param (?event=…). A handheld scanner types the ticket's code into the focused field and presses
// Enter; where the browser can read barcodes the camera does it instead. Each code lets one person
// in once — the server decides, and says so in a colour the doorman sees from a metre away.
export function TicketScanner() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") ?? "";
  const [code, setCode] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRead = useRef<{ code: string; at: number } | null>(null);
  const canUseCamera = !!detectorCtor() && !!navigator.mediaDevices?.getUserMedia;

  const events = useQuery({
    queryKey: ["posTicketedEvents", companyId],
    queryFn: () => apiClient.listPosTicketedEvents(companyId),
    enabled: !!activeCompanyId,
    refetchInterval: 30_000,
  });
  const list = (events.data ?? []).filter((e) => e.isActive || e.id === eventId);
  const event = list.find((e) => e.id === eventId);

  // One active event: take it.
  useEffect(() => {
    if (!eventId && list.length === 1) setParams({ event: list[0].id }, { replace: true });
  }, [eventId, list, setParams]);

  // A verdict clears itself; the field takes the next code.
  useEffect(() => {
    if (!verdict) return;
    const timer = setTimeout(() => setVerdict(null), CLEAR_AFTER_MS);
    return () => clearTimeout(timer);
  }, [verdict]);
  useEffect(() => {
    if (!verdict) inputRef.current?.focus();
  }, [verdict, eventId]);

  const scan = useMutation({
    mutationFn: (value: string) => apiClient.scanPosTicket(companyId, eventId, { code: value }),
    onSuccess: (r) => {
      setVerdict(toVerdict(r));
      void queryClient.invalidateQueries({ queryKey: ["posTicketedEvents", companyId] });
    },
    onError: (err: unknown) => setVerdict({ kind: "error", message: getApiErrorMessage(err, t("pos.saveError")) }),
    onSettled: () => {
      setCode("");
      inputRef.current?.focus();
    },
  });
  const submitCode = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || !eventId || scan.isPending) return;
      scan.mutate(value);
    },
    [eventId, scan],
  );

  // Camera scanning: read a frame every 300 ms; the same code twice in a row is one guest.
  useEffect(() => {
    if (!camera) return;
    const Ctor = detectorCtor();
    if (!Ctor) return;
    const detector = new Ctor({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        void video.play();
        timer = setInterval(() => {
          if (video.readyState < 2) return;
          detector.detect(video).then((codes) => {
            const value = codes[0]?.rawValue?.trim();
            if (!value) return;
            const now = Date.now();
            if (lastRead.current && lastRead.current.code === value && now - lastRead.current.at < CLEAR_AFTER_MS) return;
            lastRead.current = { code: value, at: now };
            submitCode(value);
          }, () => undefined);
        }, 300);
      })
      .catch(() => {
        setCameraError(t("hotel.scan.cameraError"));
        setCamera(false);
      });
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, submitCode]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submitCode(code);
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => navigate("/pos/tickets")} aria-label={t("till.exit")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-semibold">{t("hotel.scan.title")}</h1>
        <div className="w-72">
          <Select
            value={eventId}
            onValueChange={(v) => setParams({ event: v }, { replace: true })}
            placeholder={t("hotel.scan.pickEvent")}
            options={list.map((e) => ({
              value: e.id,
              label: `${e.name} · ${intl.formatDate(e.startsAt, { timeZone: VENUE_TIME_ZONE, dateStyle: "short", timeStyle: "short" })}`,
            }))}
          />
        </div>
        {event && (
          <span className="ml-auto text-sm tabular-nums text-muted-foreground" data-testid="scan-counts">
            {t("hotel.scan.counts", { used: event.used, sold: event.sold, capacity: event.capacity })}
          </span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center gap-4 p-4">
        <form onSubmit={onSubmit} className="flex w-full max-w-xl gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={code}
            disabled={!eventId}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => {
              // A scanner types into whatever has focus: keep it here unless a control took it.
              setTimeout(() => {
                if (document.activeElement === document.body) inputRef.current?.focus();
              }, 0);
            }}
            placeholder={eventId ? t("hotel.scan.placeholder") : t("hotel.scan.pickEvent")}
            aria-label={t("hotel.scan.code")}
            className="h-14 text-center font-mono text-2xl tracking-widest"
            autoComplete="off"
          />
          {canUseCamera && (
            <Button
              type="button"
              variant={camera ? "default" : "outline"}
              className="h-14"
              disabled={!eventId}
              onClick={() => {
                setCameraError(null);
                setCamera((c) => !c);
              }}
              aria-label={t(camera ? "hotel.scan.cameraOff" : "hotel.scan.cameraOn")}
            >
              {camera ? <CameraOff className="size-6" /> : <Camera className="size-6" />}
            </Button>
          )}
        </form>
        {cameraError && <p className="text-sm text-destructive">{cameraError}</p>}
        {camera && <video ref={videoRef} className="max-h-64 rounded-md border" muted playsInline />}

        <div
          className={cn(
            "flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 rounded-xl text-center transition-colors",
            verdict ? VERDICT_CLASS[verdict.kind] : "border-2 border-dashed text-muted-foreground",
          )}
          role="status"
          aria-live="assertive"
          data-testid="scan-verdict"
          data-verdict={verdict?.kind ?? "idle"}
        >
          {!verdict ? (
            <p className="text-xl">{scan.isPending ? t("common.loading") : t("hotel.scan.ready")}</p>
          ) : verdict.kind === "valid" ? (
            <>
              <p className="text-7xl font-black tracking-wide">{t("hotel.scan.valid")}</p>
              {verdict.ticketType && <p className="text-3xl font-semibold">{verdict.ticketType}</p>}
            </>
          ) : verdict.kind === "used" ? (
            <>
              <p className="text-6xl font-black tracking-wide">{t("hotel.scan.used")}</p>
              {verdict.ticketType && <p className="text-2xl font-semibold">{verdict.ticketType}</p>}
              {verdict.usedAt && (
                <p className="text-2xl" data-testid="scan-used-at">
                  {t("hotel.scan.usedAt", { time: intl.formatTime(verdict.usedAt, { timeZone: VENUE_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
                </p>
              )}
            </>
          ) : verdict.kind === "invalid" ? (
            <>
              <p className="text-7xl font-black tracking-wide">{t("hotel.scan.invalid")}</p>
              <p className="text-xl">{t("hotel.scan.invalid.hint")}</p>
            </>
          ) : (
            <p className="text-2xl font-semibold">{verdict.message}</p>
          )}
        </div>
      </main>
    </div>
  );
}
