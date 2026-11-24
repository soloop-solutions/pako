import { useEffect, useState } from "react";
import type { DesktopTillNetworkBridge, TillNetworkStatus } from "@pako/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TILL_NETWORK_KEY, useTillNetwork } from "@/lib/tillNetwork";

// Desktop "Allow tills on this network": this PC serves the till and the kitchen display to
// tablets on the shop network, all on this PC's one database. Tablets connect with a one-use link
// from POS setup → Devices. Unlimited tills.
function Panel({ bridge, status, canManage }: { bridge: DesktopTillNetworkBridge; status: TillNetworkStatus; canManage: boolean }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(status.enabled);
  const [port, setPort] = useState(String(status.port));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Open Settings" from a device link lands here (/settings#tills).
  useEffect(() => {
    if (window.location.hash === "#tills") document.getElementById("tills")?.scrollIntoView?.({ block: "start" });
  }, []);

  useEffect(() => {
    setEnabled(status.enabled);
    setPort(String(status.port));
  }, [status.enabled, status.port]);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;
  const dirty = enabled !== status.enabled || (enabled && portNumber !== status.port);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.setTillNetwork({ enabled, port: enabled ? portNumber : status.port });
      if (result.ok) queryClient.setQueryData(TILL_NETWORK_KEY, result.status);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="tills">
      <CardHeader>
        <CardTitle>{t("pos.tillNetwork.title")}</CardTitle>
        <CardDescription>{t("pos.tillNetwork.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(error ?? status.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? status.error}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="till-network"
            checked={enabled}
            disabled={!canManage || busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Label htmlFor="till-network">{t("pos.tillNetwork.allow")}</Label>
        </div>
        {enabled && (
          <div className="flex max-w-xs flex-col gap-1">
            <Label htmlFor="till-port">{t("pos.tillNetwork.port")}</Label>
            <Input
              id="till-port"
              inputMode="numeric"
              value={port}
              disabled={!canManage || busy}
              aria-invalid={!portValid}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            />
            {!portValid && <p className="text-xs text-destructive">{t("pos.tillNetwork.portInvalid")}</p>}
          </div>
        )}
        {status.running && (
          <div className="flex flex-col gap-1 text-sm" data-testid="till-network-urls">
            <span className="text-muted-foreground">{t("pos.tillNetwork.running")}</span>
            {status.urls.length === 0 ? (
              <span className="text-warning-foreground">{t("pos.tillNetwork.noNetwork")}</span>
            ) : (
              <ul className="font-mono text-xs">
                {status.urls.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {enabled && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            <li>{t("pos.tillNetwork.noteConnect")}</li>
            <li>{t("pos.tillNetwork.noteAwake")}</li>
            <li>{t("pos.tillNetwork.noteFirewall")}</li>
          </ul>
        )}
        {canManage && (
          <div>
            <Button type="button" disabled={!dirty || busy || (enabled && !portValid)} onClick={() => void save()}>
              {busy ? t("pos.tillNetwork.applying") : t("pos.tillNetwork.apply")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DesktopTillNetworkPanel({ canManage }: { canManage: boolean }) {
  const { bridge, status } = useTillNetwork();
  if (!bridge || !status) return null;
  return <Panel bridge={bridge} status={status} canManage={canManage} />;
}
