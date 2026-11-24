import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MonitorSmartphone } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

// docs/POS_TILL_ACCESS.md §7: opened on a till or kitchen screen from the link (or QR code) an
// administrator made in POS setup → Devices. Connects once, then the device stays signed in.
export function DeviceConnect() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const { connectDevice } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(!!code);
  const started = useRef(false);

  function connect(value: string) {
    setWorking(true);
    setError(null);
    connectDevice(value)
      .then(() => {
        // Nothing of whoever used this browser before stays in the cache.
        queryClient.clear();
        navigate("/device", { replace: true });
      })
      .catch((err: unknown) => {
        setWorking(false);
        setError(getApiErrorMessage(err, t("device.connect.failed")));
      });
  }

  useEffect(() => {
    if (!code || started.current) return;
    // Once: the link works a single time, so a repeated call would fail after the first succeeded.
    started.current = true;
    connect(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // No link: a till PC (desktop till mode) or a screen where the link can't be opened types the
  // short code from POS setup → Devices instead.
  const pairCode = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <MonitorSmartphone className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">{t("device.connect.title")}</h1>
        {error && (
          <Alert variant="destructive" className="text-left">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {working ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("device.connect.working")}
          </p>
        ) : !code && (
          <form
            className="flex w-full flex-col gap-3 text-left"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (pairCode.length === 8) connect(pairCode);
            }}
          >
            <p className="text-sm text-muted-foreground">{t("device.connect.enterCode")}</p>
            <Label htmlFor="pair-code">{t("device.connect.code")}</Label>
            <Input
              id="pair-code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX"
              value={typed}
              maxLength={12}
              onChange={(e) => setTyped(e.target.value)}
              className="h-12 text-center font-mono text-2xl tracking-widest uppercase"
            />
            <Button type="submit" className="h-11" disabled={pairCode.length !== 8}>
              {t("device.connect.submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
