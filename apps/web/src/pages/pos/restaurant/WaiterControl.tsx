import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Lock, LogOut, UserRound } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { setPosOperator, usePosOperator } from "@/lib/pos-operator";
import { cn } from "@/lib/utils";

// docs/POS_PLAN.md P3: a waiter signs in on the shared till with their PIN; what they ring up
// (orders, tabs) carries their name until they sign out.
export function WaiterControl({ className }: { className?: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const operator = usePosOperator();
  const [dialog, setDialog] = useState<"signIn" | "setPin" | null>(null);
  // A token from another company is not this company's waiter.
  const mine = operator && operator.companyId === activeCompanyId ? operator : null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {mine ? (
        <>
          <span className="flex min-w-0 items-center gap-1 text-sm font-medium" data-testid="pos-operator">
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-28 truncate sm:max-w-none">{t("rest.waiter.signedIn", { name: mine.name })}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPosOperator(null)}>
            <LogOut className="size-4" /> <span className="sr-only sm:not-sr-only">{t("rest.waiter.signOut")}</span>
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setDialog("signIn")}>
          <UserRound className="size-4" /> {t("rest.waiter")}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setDialog("setPin")} aria-label={t("rest.waiter.setPin")} title={t("rest.waiter.setPin")}>
        <KeyRound className="size-4" />
      </Button>
      {dialog === "signIn" && <PinSignInDialog onClose={() => setDialog(null)} />}
      {dialog === "setPin" && <SetPinDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

const PIN_PATTERN = /^\d{4,8}$/;

function PinSignInDialog({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("rest.waiter.signIn")} size="sm">
      <PinSignInForm onSignedIn={onClose} onCancel={onClose} />
    </FormDialog>
  );
}

// The PIN form: on the lock screen and in the waiter dialog.
function PinSignInForm({ onSignedIn, onCancel }: { onSignedIn?: () => void; onCancel?: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signIn = useMutation({
    mutationFn: () => apiClient.posPinSignIn(companyId, { pin }),
    onSuccess: (op) => {
      setPosOperator({ companyId, userId: op.userId, name: op.name, token: op.token, expiresAt: op.expiresAt });
      onSignedIn?.();
    },
    onError: (err: unknown) => {
      setPin("");
      setError(getApiErrorMessage(err, t("rest.waiter.wrongPin")));
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        if (PIN_PATTERN.test(pin)) signIn.mutate();
      }}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Label htmlFor="waiter-pin">{t("rest.waiter.pin")}</Label>
      <Input
        id="waiter-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        maxLength={8}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        className="h-12 text-center text-2xl tracking-[0.5em]"
      />
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={signIn.isPending}>{t("common.cancel")}</Button>}
        <Button type="submit" className={onCancel ? undefined : "w-full"} disabled={!PIN_PATTERN.test(pin) || signIn.isPending}>{t("rest.waiter.signIn")}</Button>
      </div>
    </form>
  );
}

// docs/POS_TILL_ACCESS.md (user request 2026-11-24): without a PIN the till is not shown. The
// device's own login opens this page; the person working it signs in with their PIN.
export function TillLock() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-6" data-testid="till-lock">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <Lock className="size-5" />
          </span>
          <h2 className="text-lg font-semibold">{t("till.lock.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("till.lock.hint")}</p>
        </div>
        <PinSignInForm />
        <p className="text-center text-xs text-muted-foreground">{t("till.lock.noPin")}</p>
      </div>
    </div>
  );
}

// The signed-in member's own PIN (the account the till runs under, not the waiter's token).
function SetPinDialog({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => apiClient.setMyPosPin(activeCompanyId as string, { pin }),
    onSuccess: () => setSaved(true),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = PIN_PATTERN.test(pin);
  const mismatch = again !== "" && again !== pin;
  return (
    <FormDialog open onOpenChange={(open) => !open && !save.isPending && onClose()} title={t("rest.waiter.setPin")} size="sm">
      {saved ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("rest.waiter.pinSaved")}</p>
          <div className="flex justify-end">
            <Button autoFocus onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError(null);
            if (valid && again === pin) save.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t("rest.waiter.setPin.hint")}</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Label htmlFor="new-pin">{t("rest.waiter.newPin")}</Label>
          <Input id="new-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="tracking-[0.4em]" />
          <Label htmlFor="new-pin-again">{t("rest.waiter.newPinAgain")}</Label>
          <Input id="new-pin-again" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={again}
            aria-invalid={mismatch || undefined} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} className="tracking-[0.4em]" />
          {mismatch && <p className="text-sm text-destructive">{t("rest.waiter.pinMismatch")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!valid || again !== pin || save.isPending}>{t("common.save")}</Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
