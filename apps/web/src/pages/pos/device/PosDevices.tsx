import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PosDeviceLinkResponse, PosDeviceResponse } from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Link2, Pencil, Plus, Unplug } from "lucide-react";
import QRCode from "qrcode";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { SectionHeader } from "@/components/list/PageHeader";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { deviceConnectUrl } from "@/lib/posDevice";
import { useTillNetwork } from "@/lib/tillNetwork";

const devicesKey = (companyId: string | null) => ["posDevices", companyId];

// docs/POS_TILL_ACCESS.md §7 (user request 2026-11-24): the administrator adds each till or kitchen
// screen as a device and connects it with a one-use link or QR code. A device shows only the till
// and the kitchen display; disconnecting it signs it out at once.
export function PosDevicesCard() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [link, setLink] = useState<PosDeviceLinkResponse | null>(null);
  const [naming, setNaming] = useState<PosDeviceResponse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: devicesKey(activeCompanyId),
    queryFn: () => apiClient.listPosDevices(companyId),
    enabled: !!activeCompanyId,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: devicesKey(activeCompanyId) });

  const newLink = useMutation({
    mutationFn: (device: PosDeviceResponse) => apiClient.createPosDeviceLink(companyId, device.id),
    onMutate: () => setError(null),
    onSuccess: (l) => setLink(l),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
    onSettled: refresh,
  });
  const disconnect = useMutation({
    mutationFn: (device: PosDeviceResponse) => apiClient.disconnectPosDevice(companyId, device.id),
    onMutate: () => setError(null),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
    onSettled: refresh,
  });

  const columns = useMemo<ColumnDef<PosDeviceResponse>[]>(
    () => [
      { accessorKey: "name", header: t("pos.devices.name") },
      {
        id: "status",
        header: t("pos.devices.status"),
        accessorFn: (d) => (d.connected ? 0 : d.active ? 1 : 2),
        cell: ({ row }) =>
          row.original.connected ? (
            <Badge variant="outline" className="border-success-border bg-success text-success-foreground">{t("pos.devices.connected")}</Badge>
          ) : row.original.active ? (
            <Badge variant="secondary">{t("pos.devices.waiting")}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground line-through">{t("pos.devices.disconnected")}</Badge>
          ),
      },
      {
        accessorKey: "lastSeenAt",
        header: t("pos.devices.lastSeen"),
        cell: ({ row }) =>
          row.original.lastSeenAt ? (
            <span className="tabular-nums">{intl.formatDate(row.original.lastSeenAt, { dateStyle: "short", timeStyle: "short" })}</span>
          ) : (
            "—"
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title={t("pos.devices")}
          description={t("pos.devices.description")}
          actions={
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setNaming("new")}>
              <Plus className="size-3.5" /> {t("pos.devices.add")}
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId="pos-devices"
          columns={columns}
          data={devices.data ?? []}
          rowCount={devices.data?.length ?? 0}
          isLoading={devices.isPending}
          getRowId={(d) => d.id}
          emptyMessage={t("pos.devices.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          rowActions={(device) => (
            <>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={newLink.isPending} onClick={() => newLink.mutate(device)}>
                <Link2 className="size-3.5" /> {t("pos.devices.newLink")}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={() => setNaming(device)}>
                <Pencil className="size-3.5" /> {t("pos.devices.rename")}
              </Button>
              {device.active && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-xs text-destructive"
                  disabled={disconnect.isPending}
                  onClick={() => confirm(t("pos.devices.disconnect.confirm", { name: device.name }), () => disconnect.mutate(device))}
                >
                  <Unplug className="size-3.5" /> {t("pos.devices.disconnect")}
                </Button>
              )}
            </>
          )}
        />
      </CardContent>

      {naming && (
        <NameDialog
          device={naming === "new" ? null : naming}
          onClose={() => setNaming(null)}
          onSaved={(created) => {
            setNaming(null);
            if (created) setLink(created);
            void refresh();
          }}
        />
      )}
      {link && <LinkDialog link={link} onClose={() => setLink(null)} />}
    </Card>
  );
}

function NameDialog({ device, onClose, onSaved }: {
  device: PosDeviceResponse | null;
  onClose: () => void;
  onSaved: (created: PosDeviceLinkResponse | null) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [name, setName] = useState(device?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (device) {
        await apiClient.renamePosDevice(companyId, device.id, { name: name.trim() });
        return null;
      }
      return apiClient.createPosDevice(companyId, { name: name.trim() });
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t(device ? "pos.devices.rename" : "pos.devices.add")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (name.trim()) save.mutate();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="device-name">{t("pos.devices.name")}</Label>
        <Input id="device-name" autoFocus maxLength={80} value={name} placeholder={t("pos.devices.name.placeholder")} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!name.trim() || save.isPending}>{t(device ? "common.save" : "pos.devices.createLink")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// The connect link, once: as a QR code to scan on the device and as an address to type or copy.
function LinkDialog({ link, onClose }: { link: PosDeviceLinkResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const tills = useTillNetwork();
  if (tills.desktop && !tills.baseUrl) {
    return (
      <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("pos.devices.link.title", { name: link.name })} size="md">
        <div className="flex flex-col gap-3" data-testid="device-link-off">
          {!tills.isPending && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span>{t(tills.bridge ? "pos.tillNetwork.linkOff" : "pos.tillNetwork.linkUnsupported")}</span>
                {tills.bridge && (
                  <Link to="/settings#tills" className="font-medium underline" onClick={onClose}>
                    {t("pos.tillNetwork.openSettings")}
                  </Link>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button autoFocus onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      </FormDialog>
    );
  }
  return <LinkDialogBody link={link} baseUrl={tills.baseUrl ?? window.location.origin} onClose={onClose} />;
}

function LinkDialogBody({ link, baseUrl, onClose }: { link: PosDeviceLinkResponse; baseUrl: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const url = deviceConnectUrl(link.code, baseUrl);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: "L" })
      .then((data) => live && setQr(data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("pos.devices.link.title", { name: link.name })} size="md">
      <div className="flex flex-col gap-3" data-testid="device-link">
        <p className="text-sm text-muted-foreground">{t("pos.devices.link.hint")}</p>
        <div className="flex justify-center">
          {qr ? <img src={qr} alt={t("pos.devices.link.qr")} className="size-56 rounded-md border bg-white p-1" /> : <div className="size-56 rounded-md border bg-muted" />}
        </div>
        <div className="flex gap-2">
          <Input readOnly value={url} aria-label={t("pos.devices.link.address")} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button
            type="button"
            variant="outline"
            className="gap-1"
            onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
          >
            <Copy className="size-3.5" /> {t(copied ? "pos.devices.link.copied" : "pos.devices.link.copy")}
          </Button>
        </div>
        {link.pairCode && (
          <div className="flex flex-col items-center gap-1 rounded-md border bg-muted/40 p-2">
            <span className="text-xs text-muted-foreground">{t("pos.devices.link.pairCode")}</span>
            <span className="font-mono text-2xl font-bold tracking-widest" data-testid="device-pair-code">{link.pairCode}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("pos.devices.link.expires", { at: intl.formatDate(link.expiresAt, { dateStyle: "short", timeStyle: "short" }) })}
        </p>
        <div className="flex justify-end">
          <Button autoFocus onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
