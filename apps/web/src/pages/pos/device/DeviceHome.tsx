import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChefHat, Monitor, PlugZap, RotateCw, ScanLine, Store } from "lucide-react";
import { useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useFeatures } from "@/hooks/useFeatures";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { setPosOperator } from "@/lib/pos-operator";
import { lastDeviceScreen, rememberDeviceScreen, useMyPosDevice } from "@/lib/posDevice";

// docs/POS_TILL_ACCESS.md §7: the only page of a till device besides the screens it opens — pick
// a till or a kitchen display. Opening the app reopens the last one. There is no way from here
// into the rest of Pako; disconnecting the device needs a manager's PIN.
export function DeviceHome() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const location = useLocation();
  const { device } = useMyPosDevice();
  const { activeCompany, activeCompanyId } = useCompany();
  const { hasFeature } = useFeatures();
  const registers = (usePosRegisters().data ?? []).filter((r) => r.isActive);
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive);
  const kitchen = hasFeature("hospitality");
  const menu = useQuery({
    queryKey: ["posMenu", activeCompanyId],
    queryFn: () => apiClient.getPosMenu(activeCompanyId as string),
    enabled: !!activeCompanyId && kitchen,
    staleTime: 5 * 60_000,
  });
  const centers = (menu.data?.centers ?? []).filter((c) => c.isActive);
  const [disconnecting, setDisconnecting] = useState(false);

  const open = (path: string) => {
    rememberDeviceScreen(path);
    navigate(path);
  };

  // Started fresh (the app opened at "/"): straight back to the screen this device runs.
  const reopen = (location.state as { reopen?: boolean } | null)?.reopen === true;
  useEffect(() => {
    const last = lastDeviceScreen();
    if (reopen && last) navigate(last, { replace: true });
  }, [reopen, navigate]);

  const last = lastDeviceScreen();
  const kitchenScreens = stores.flatMap((s) => [
    { key: `${s.id}-all`, label: t("device.home.allStations", { store: s.name }), path: `/pos/kds?store=${s.id}` },
    ...centers.filter((c) => !c.storeId || c.storeId === s.id).map((c) => ({
      key: `${s.id}-${c.id}`, label: `${c.name} · ${s.name}`, path: `/pos/kds?store=${s.id}&center=${c.id}`,
    })),
  ]);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex items-center gap-3 border-b bg-card px-6 py-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <Monitor className="size-4" />
        </span>
        <div className="flex flex-col">
          <span className="font-semibold" data-testid="device-name">{device?.name}</span>
          <span className="text-xs text-muted-foreground">{activeCompany?.name}</span>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto gap-1 text-muted-foreground" onClick={() => setDisconnecting(true)}>
          <PlugZap className="size-4" /> {t("device.home.disconnect")}
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        {last && (
          <Button size="lg" className="h-14 gap-2 self-start text-base" onClick={() => navigate(last)}>
            <RotateCw className="size-4" /> {t("device.home.continue")}
          </Button>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("device.home.tills")}</h2>
          {registers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("device.home.noTills")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {registers.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open(`/pos/till/${r.id}`)}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary"
                >
                  <Store className="size-6 text-primary" />
                  <span className="flex flex-col">
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.code}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {kitchen && kitchenScreens.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("device.home.kitchen")}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {kitchenScreens.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => open(k.path)}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary"
                >
                  <ChefHat className="size-6 text-primary" />
                  <span className="font-semibold">{k.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {hasFeature("events") && (
          <section className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => open("/pos/scan")}
              className="flex items-center gap-3 self-start rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary"
            >
              <ScanLine className="size-6 text-primary" />
              <span className="font-semibold">{t("device.home.scanner")}</span>
            </button>
          </section>
        )}
      </main>

      {disconnecting && <DisconnectDialog onClose={() => setDisconnecting(false)} />}
    </div>
  );
}

const PIN_PATTERN = /^\d{4,8}$/;

// A manager confirms with their PIN; the device is then switched off and signed out.
function DisconnectDialog({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const disconnect = useMutation({
    mutationFn: async () => {
      const op = await apiClient.posPinSignIn(companyId, { pin });
      setPosOperator({ companyId, userId: op.userId, name: op.name, token: op.token, expiresAt: op.expiresAt });
      try {
        await apiClient.disconnectThisPosDevice(companyId);
      } finally {
        setPosOperator(null);
      }
    },
    onSuccess: () => {
      logout();
      navigate("/login", { replace: true });
    },
    onError: (err: unknown) => {
      setPin("");
      setError(getApiErrorMessage(err, t("rest.waiter.wrongPin")));
    },
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !disconnect.isPending && onClose()} title={t("device.home.disconnect")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (PIN_PATTERN.test(pin)) disconnect.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("device.home.disconnect.hint")}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="manager-pin">{t("device.home.managerPin")}</Label>
        <Input id="manager-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="h-12 text-center text-2xl tracking-[0.5em]" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={disconnect.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" variant="destructive" disabled={!PIN_PATTERN.test(pin) || disconnect.isPending}>{t("device.home.disconnect")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
