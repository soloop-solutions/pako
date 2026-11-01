import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, LogOut, UserRound } from "lucide-react";
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
          <span className="flex items-center gap-1 text-sm font-medium" data-testid="pos-operator">
            <UserRound className="size-4 text-muted-foreground" /> {t("rest.waiter.signedIn", { name: mine.name })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPosOperator(null)}>
            <LogOut className="size-4" /> {t("rest.waiter.signOut")}
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
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signIn = useMutation({
    mutationFn: () => apiClient.posPinSignIn(companyId, { pin }),
    onSuccess: (op) => {
      setPosOperator({ companyId, userId: op.userId, name: op.name, token: op.token, expiresAt: op.expiresAt });
      onClose();
    },
    onError: (err: unknown) => {
      setPin("");
      setError(getApiErrorMessage(err, t("rest.waiter.wrongPin")));
    },
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && !signIn.isPending && onClose()} title={t("rest.waiter.signIn")} size="sm">
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
          <Button type="button" variant="outline" onClick={onClose} disabled={signIn.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!PIN_PATTERN.test(pin) || signIn.isPending}>{t("rest.waiter.signIn")}</Button>
        </div>
      </form>
    </FormDialog>
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
