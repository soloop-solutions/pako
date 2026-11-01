import { useMemo, useRef, useState } from "react";
import type {
  FloorPlanResponse,
  ItemCategoryResponse,
  PosBootstrapResponse,
  PosCatalogItemResponse,
  PosMenuResponse,
  PosOrderResponse,
  TabLineResponse,
  TabResponse,
  TabSplitResponse,
} from "@pako/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRightLeft, Ban, BedDouble, Check, ChefHat, Combine, FileText, MoveRight, Pencil, Send, Wallet, X,
} from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { TabKind, TabLineState, TabState, tabLineStateKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { AgePrompt, DoneDialog, PaymentDialog, ValuePrompt } from "@/pages/pos/Till";
import { ChargeToRoomDialog } from "@/pages/pos/restaurant/ChargeToRoom";
import { TabSummaryButton } from "@/pages/pos/restaurant/FloorPlan";
import { ComboPicker, ModifierPicker, type ComboChoice } from "@/pages/pos/restaurant/ItemPickers";
import { PreBillDialog } from "@/pages/pos/restaurant/PreBill";
import { PayTabDialog } from "@/pages/pos/restaurant/TabPay";
import { chargeableToRoom, tabKindLabelKey, type TabPayment } from "@/pages/pos/restaurant/tab-utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

/** What is being added, as far as it is known yet; each prompt fills in one piece. */
interface AddRequest {
  item: PosCatalogItemResponse;
  ageVerified?: boolean;
  quantity?: number;
  unitPrice?: number;
  modifierIds?: string[];
  comboChoices?: ComboChoice[];
}
type AddStep = "age" | "weight" | "price" | "modifiers" | "combo";

const LINE_BADGE: Record<number, "outline" | "info" | "cancelled" | "warning"> = {
  [TabLineState.Pending]: "outline",
  [TabLineState.Sent]: "info",
  [TabLineState.Voided]: "cancelled",
  [TabLineState.Requested]: "warning",
};

type Dialog = "pay" | "transfer" | "merge" | "move" | "cancel" | "prebill" | "room" | null;

// docs/POS_PLAN.md §6.2 / P3: one tab — the menu on the left, what the table ordered on the right,
// grouped by course. Every figure (line gross, total, paid, due) is the server's.
export function TabView({ boot, sessionId, tabId, catalog, menu, plan, onBack }: {
  boot: PosBootstrapResponse;
  sessionId: string;
  tabId: string;
  catalog: PosCatalogItemResponse[];
  menu: PosMenuResponse | undefined;
  plan: FloorPlanResponse | undefined;
  onBack: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const { canApprove } = useMyAccess();

  const tabKey = ["posTab", companyId, tabId];
  const tabQuery = useQuery({ queryKey: tabKey, queryFn: () => apiClient.getPosTab(companyId, tabId) });
  const tab = tabQuery.data;

  const [notice, setNotice] = useState<string | null>(null);
  const [course, setCourse] = useState(1);
  const [seat, setSeat] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ step: AddStep; request: AddRequest } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<TabLineResponse | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [prebill, setPrebill] = useState<TabResponse | null>(null);
  // Paying: the split (kept while its parts are paid), the payment in the dialog, the coupon done.
  const [split, setSplit] = useState<TabSplitResponse | null>(null);
  const [paidParts, setPaidParts] = useState<number[]>([]);
  const [paying, setPaying] = useState<TabPayment | null>(null);
  const [done, setDone] = useState<PosOrderResponse | null>(null);
  // One ClientUuid per payment (D11): kept across a failed attempt, renewed once it is recorded.
  const uuids = useRef<Record<string, string>>({});

  function applied(next: TabResponse) {
    queryClient.setQueryData(tabKey, next);
    void queryClient.invalidateQueries({ queryKey: ["posFloorPlan", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["posOpenTabs", companyId] });
    setNotice(null);
    // Merged away, moved empty, cancelled or paid: back to the floor.
    if (next.state === TabState.Closed || next.state === TabState.Cancelled) onBack();
  }
  const fail = (err: unknown) => setNotice(getApiErrorMessage(err, t("pos.saveError")));
  function act<A>(fn: (a: A) => Promise<TabResponse>) {
    return { mutationFn: fn, onSuccess: applied, onError: fail };
  }

  const addLine = useMutation(act((r: AddRequest) => apiClient.addPosTabLines(companyId, tabId, {
    lines: [{
      itemId: r.item.id, quantity: r.quantity ?? 1, course,
      ...(seat != null ? { seat } : {}),
      ...(r.unitPrice != null ? { unitPrice: r.unitPrice } : {}),
      ...(r.modifierIds?.length ? { modifierIds: r.modifierIds } : {}),
      ...(r.comboChoices?.length ? { comboChoices: r.comboChoices } : {}),
      ...(r.ageVerified ? { ageVerified: true } : {}),
    }],
  })));
  const send = useMutation(act((c: number | undefined) => apiClient.sendPosTab(companyId, tabId, c)));
  const answer = useMutation(act((accept: boolean) => apiClient.answerPosTabRequests(companyId, tabId, accept)));
  const preBill = useMutation({
    mutationFn: () => apiClient.preBillPosTab(companyId, tabId),
    onSuccess: (next: TabResponse) => {
      applied(next);
      setPrebill(next);
    },
    onError: fail,
  });

  const groupsFor = (item: PosCatalogItemResponse) => (menu?.modifierGroups ?? []).filter((g) => g.isActive && g.itemIds.includes(item.id));
  const slotsFor = (item: PosCatalogItemResponse) => menu?.combos?.[item.id] ?? [];

  // Each missing piece opens its prompt, which comes back here with the answer.
  function proceed(request: AddRequest) {
    const { item } = request;
    if (item.price == null && !item.openPrice) {
      setNotice(t("till.noPrice", { item: item.name }));
      return;
    }
    const checked = request.ageVerified || tab?.lines.some((l) => l.itemId === item.id && l.state !== TabLineState.Voided);
    if ((item.minimumAge ?? 0) > 0 && !checked) setAdding({ step: "age", request });
    else if (item.sellByWeight && request.quantity == null) setAdding({ step: "weight", request: { ...request, ageVerified: checked || undefined } });
    else if (item.openPrice && request.unitPrice == null) setAdding({ step: "price", request: { ...request, ageVerified: checked || undefined } });
    else if (groupsFor(item).length > 0 && request.modifierIds == null) setAdding({ step: "modifiers", request: { ...request, ageVerified: checked || undefined } });
    else if (slotsFor(item).length > 0 && request.comboChoices == null) setAdding({ step: "combo", request: { ...request, ageVerified: checked || undefined } });
    else {
      setAdding(null);
      addLine.mutate({ ...request, ageVerified: checked || undefined });
    }
  }

  if (tabQuery.isPending) return <p className="p-6 text-muted-foreground">{t("common.loading")}</p>;
  if (!tab)
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(tabQuery.error, t("pos.saveError"))}</AlertDescription>
        </Alert>
        <Button className="mt-4" variant="outline" onClick={onBack}>{t("rest.floorPlan")}</Button>
      </div>
    );

  const open = tab.state === TabState.Open || tab.state === TabState.PreBilled;
  const pending = tab.lines.filter((l) => l.state === TabLineState.Pending);
  const pendingCourses = [...new Set(pending.map((l) => l.course))].sort((a, b) => a - b);
  const requested = tab.lines.some((l) => l.state === TabLineState.Requested);
  const hasPayable = tab.lines.some((l) => (l.state === TabLineState.Pending || l.state === TabLineState.Sent) && l.remaining > 0);
  const busy = addLine.isPending || send.isPending || answer.isPending || preBill.isPending;
  const seats = Math.max(tab.covers, 4);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_30rem]">
      <MenuPanel catalog={catalog} onPick={(item) => proceed({ item })} disabled={!open || busy} />

      <section className="flex min-h-0 flex-col">
        <div className="flex flex-col gap-1 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onBack} aria-label={t("rest.floorPlan")}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="font-semibold" data-testid="tab-title">
              {tab.number}
              {tab.tableName ? ` · ${tab.tableName}` : ""}
              {tab.name ? ` · ${tab.name}` : ""}
            </span>
            <Badge variant="outline">{t(tabKindLabelKey(tab.kind))}</Badge>
            {tab.state === TabState.PreBilled && <Badge variant="warning">{t("rest.state.preBilled")}</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{t("rest.waiterName", { name: tab.waiterName })}</span>
            {tab.kind === TabKind.DineIn && <span>{t("rest.coversCount", { count: tab.covers })}</span>}
            {tab.deliveryPhone && <span>{tab.deliveryPhone}</span>}
            {tab.deliveryAddress && <span>{tab.deliveryAddress}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">{t("rest.course")}</span>
            {[1, 2, 3, 4].map((c) => (
              <Button key={c} size="xs" variant={course === c ? "default" : "outline"} onClick={() => setCourse(c)} aria-label={t("rest.courseN", { course: c })}>
                {c}
              </Button>
            ))}
            <span className="ml-2 text-muted-foreground">{t("rest.seat")}</span>
            <Button size="xs" variant={seat == null ? "default" : "outline"} onClick={() => setSeat(null)}>—</Button>
            {Array.from({ length: seats }, (_, i) => i + 1).map((s) => (
              <Button key={s} size="xs" variant={seat === s ? "default" : "outline"} onClick={() => setSeat(s)} aria-label={t("rest.seatN", { seat: s })}>
                {s}
              </Button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {notice && (
            <Alert variant="destructive" className="m-2 w-auto">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          <TabLines
            tab={tab}
            selected={selected}
            onSelect={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            editing={editing}
            onEdit={setEditing}
            onVoid={setVoiding}
            onApplied={applied}
            onError={fail}
          />
        </div>

        <div className="flex flex-col gap-2 border-t p-3">
          {tab.taxes.map((x) => (
            <div key={x.taxLetter} className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{t("till.vat")} {x.taxLetter} {intl.formatNumber(x.taxRate, { style: "percent", maximumFractionDigits: 2 })}</span>
              <span>{money(x.tax)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm tabular-nums">
            <span>{t("till.total")} {money(tab.total)}</span>
            {tab.paid !== 0 && <span>{t("rest.paid")} {money(tab.paid)}</span>}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold">{t("rest.due")}</span>
            <span className="text-3xl font-bold tabular-nums" data-testid="tab-view-due">{money(tab.due)}</span>
          </div>
          {requested && (
            <div className="flex items-center gap-2 rounded-md border border-red-500 px-2 py-1.5 text-sm">
              <span className="mr-auto">{t("rest.requests")}</span>
              <Button size="sm" disabled={busy} onClick={() => answer.mutate(true)}>
                <Check className="size-4" /> {t("rest.requests.accept")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer.mutate(false)}>
                <X className="size-4" /> {t("rest.requests.reject")}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!open || pending.length === 0 || busy} onClick={() => send.mutate(undefined)}>
              <Send className="size-4" /> {t("rest.send")}
            </Button>
            {pendingCourses.length > 1 &&
              pendingCourses.map((c) => (
                <Button key={c} variant="outline" disabled={busy} onClick={() => send.mutate(c)}>
                  <ChefHat className="size-4" /> {t("rest.fireCourse", { course: c })}
                </Button>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!open} onClick={() => setDialog("transfer")}>
              <ArrowRightLeft className="size-4" /> {t("rest.transfer")}
            </Button>
            <Button size="sm" variant="outline" disabled={!open} onClick={() => setDialog("merge")}>
              <Combine className="size-4" /> {t("rest.merge")}
            </Button>
            <Button size="sm" variant="outline" disabled={!open || selected.length === 0} onClick={() => setDialog("move")}>
              <MoveRight className="size-4" /> {t("rest.move", { count: selected.length })}
            </Button>
            <Button size="sm" variant="outline" disabled={!open || busy || !hasPayable} onClick={() => preBill.mutate()}>
              <FileText className="size-4" /> {t("rest.prebill")}
            </Button>
            <Button size="sm" variant="outline" disabled={!open} onClick={() => setDialog("cancel")}>
              <Ban className="size-4" /> {t("rest.cancelTab")}
            </Button>
            {/* P5: the unpaid lines go to a checked-in guest's folio. */}
            {chargeableToRoom(tab.kind) && (
              <Button size="sm" variant="outline" disabled={!open || busy || !hasPayable} onClick={() => setDialog("room")}>
                <BedDouble className="size-4" /> {t("hotel.chargeToRoom")}
              </Button>
            )}
          </div>
          <Button className="h-12 text-lg" disabled={!open || !hasPayable || busy} onClick={() => setDialog("pay")}>
            <Wallet className="size-5" /> {t("rest.payTab")}
          </Button>
        </div>
      </section>

      {adding?.step === "age" && (
        <AgePrompt item={adding.request.item} onYes={() => proceed({ ...adding.request, ageVerified: true })} onNo={() => setAdding(null)} />
      )}
      {(adding?.step === "weight" || adding?.step === "price") && (
        <ValuePrompt
          kind={adding.step}
          item={adding.request.item}
          onValue={(value) => proceed(adding.step === "weight" ? { ...adding.request, quantity: value } : { ...adding.request, unitPrice: value })}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding?.step === "modifiers" && (
        <ModifierPicker
          item={adding.request.item}
          groups={groupsFor(adding.request.item)}
          onPick={(modifierIds) => proceed({ ...adding.request, modifierIds })}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding?.step === "combo" && (
        <ComboPicker
          item={adding.request.item}
          slots={slotsFor(adding.request.item)}
          catalog={catalog}
          onPick={(comboChoices) => proceed({ ...adding.request, comboChoices })}
          onCancel={() => setAdding(null)}
        />
      )}
      {voiding && (
        <VoidDialog
          tab={tab}
          line={voiding}
          canApprove={canApprove("pos")}
          onClose={() => setVoiding(null)}
          onDone={(next) => {
            setVoiding(null);
            applied(next);
          }}
        />
      )}
      {dialog === "transfer" && (
        <TransferDialog tab={tab} plan={plan} onClose={() => setDialog(null)} onDone={(next) => {
          setDialog(null);
          applied(next);
        }} />
      )}
      {(dialog === "merge" || dialog === "move") && (
        <OtherTabDialog
          tab={tab}
          mode={dialog}
          lineIds={selected}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDialog(null);
            setSelected([]);
            applied(next);
          }}
        />
      )}
      {dialog === "cancel" && (
        <CancelTabDialog tab={tab} onClose={() => setDialog(null)} onDone={(next) => {
          setDialog(null);
          applied(next);
        }} />
      )}
      {dialog === "room" && (
        <ChargeToRoomDialog
          tab={tab}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void queryClient.invalidateQueries({ queryKey: tabKey });
            void queryClient.invalidateQueries({ queryKey: ["posFloorPlan", companyId] });
            void queryClient.invalidateQueries({ queryKey: ["posOpenTabs", companyId] });
            onBack();
          }}
        />
      )}
      {prebill && <PreBillDialog tab={prebill} boot={boot} onClose={() => setPrebill(null)} />}
      {dialog === "pay" && (
        <PayTabDialog
          tab={tab}
          registerId={boot.register.id}
          split={split}
          paidParts={paidParts}
          onSplit={(s) => {
            setSplit(s);
            setPaidParts([]);
          }}
          onPay={(payment) => {
            setDialog(null);
            setPaying(payment);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {paying && (
        <PaymentDialog
          boot={boot}
          sessionId={sessionId}
          clientUuid={(uuids.current[paying.key] ??= crypto.randomUUID())}
          lines={paying.lines}
          extras={{}}
          total={paying.total}
          tabId={tab.id}
          allowTip
          onClose={() => {
            setPaying(null);
            setDialog("pay");
          }}
          onDone={(order) => {
            delete uuids.current[paying.key];
            if (paying.part != null) setPaidParts((p) => [...p, paying.part as number]);
            setPaying(null);
            setDone(order);
            void queryClient.invalidateQueries({ queryKey: tabKey });
            void queryClient.invalidateQueries({ queryKey: ["posFloorPlan", companyId] });
          }}
        />
      )}
      {done && (
        <DoneDialog
          boot={boot}
          order={done}
          onClose={async () => {
            setDone(null);
            // The tab after this payment, as the server has it: closed goes back to the floor, a
            // split with parts left goes back to the parts.
            const next = await queryClient.fetchQuery({ queryKey: tabKey, queryFn: () => apiClient.getPosTab(companyId, tabId), staleTime: 0 });
            if (next.state === TabState.Closed || next.state === TabState.Cancelled) {
              setSplit(null);
              setPaidParts([]);
              onBack();
            } else if (split) setDialog("pay");
          }}
        />
      )}
    </div>
  );
}

// ---- The menu ----

function MenuPanel({ catalog, onPick, disabled }: { catalog: PosCatalogItemResponse[]; onPick: (item: PosCatalogItemResponse) => void; disabled: boolean }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ["itemCategories", activeCompanyId],
    queryFn: () => apiClient.listItemCategories(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 5 * 60_000,
  });
  const sellable = useMemo(() => catalog.filter((i) => i.price != null || i.openPrice), [catalog]);
  // Only the categories that have something on the menu, in the menu's order of first appearance.
  const shown = useMemo(() => {
    const ids = [...new Set(sellable.map((i) => i.categoryId).filter((x): x is string => !!x))];
    const names = new Map((categories.data ?? []).map((c: ItemCategoryResponse) => [c.id, c.name]));
    return ids.map((id) => ({ id, name: names.get(id) ?? "…" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [sellable, categories.data]);
  const items = useMemo(() => {
    const q = term.trim().toLowerCase();
    return sellable
      .filter((i) => (q ? i.name.toLowerCase().includes(q) || String(i.code) === q || i.barcodes.includes(q) : !category || i.categoryId === category))
      .slice(0, 120);
  }, [sellable, term, category]);

  return (
    <section className="flex min-h-0 flex-col gap-3 border-r p-4">
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("rest.menu.search")} aria-label={t("rest.menu.search")} className="h-11 text-lg" />
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={category == null ? "default" : "outline"} onClick={() => setCategory(null)}>{t("rest.menu.all")}</Button>
          {shown.map((c) => (
            <Button key={c.id} size="sm" variant={category === c.id ? "default" : "outline"} onClick={() => setCategory(c.id)}>
              {c.name}
            </Button>
          ))}
        </div>
      )}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4" data-testid="menu-tiles">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(item)}
            className="flex min-h-20 flex-col justify-between rounded-md border p-2 text-left hover:bg-accent focus-visible:outline-2 disabled:opacity-50"
          >
            <span className="line-clamp-2 text-sm font-medium">{item.name}</span>
            <span className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>#{item.code}</span>
              <span className="text-sm font-semibold text-foreground">{item.price == null ? "—" : money(item.price)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- The lines ----

function TabLines({ tab, selected, onSelect, editing, onEdit, onVoid, onApplied, onError }: {
  tab: TabResponse;
  selected: string[];
  onSelect: (lineId: string) => void;
  editing: string | null;
  onEdit: (lineId: string | null) => void;
  onVoid: (line: TabLineResponse) => void;
  onApplied: (tab: TabResponse) => void;
  onError: (err: unknown) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const parents = tab.lines.filter((l) => !l.parentLineId);
  const courses = [...new Set(parents.map((l) => l.course))].sort((a, b) => a - b);
  if (parents.length === 0) return <p className="p-6 text-center text-muted-foreground">{t("rest.tab.empty")}</p>;
  return (
    <div className="flex flex-col">
      {courses.map((c) => (
        <div key={c} data-testid="course-group">
          <div className="sticky top-0 z-10 bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("rest.courseN", { course: c })}
          </div>
          <ul className="divide-y">
            {parents.filter((l) => l.course === c).map((l) => (
              <TabLineRow
                key={l.id}
                tab={tab}
                line={l}
                choices={tab.lines.filter((x) => x.parentLineId === l.id)}
                selected={selected.includes(l.id)}
                onSelect={() => onSelect(l.id)}
                editing={editing === l.id}
                onEdit={(on) => onEdit(on ? l.id : null)}
                onVoid={() => onVoid(l)}
                onApplied={onApplied}
                onError={onError}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TabLineRow({ tab, line: l, choices, selected, onSelect, editing, onEdit, onVoid, onApplied, onError }: {
  tab: TabResponse;
  line: TabLineResponse;
  /** A combo's choices, shown indented under it. */
  choices: TabLineResponse[];
  selected: boolean;
  onSelect: () => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onVoid: () => void;
  onApplied: (tab: TabResponse) => void;
  onError: (err: unknown) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const voided = l.state === TabLineState.Voided;
  const pending = l.state === TabLineState.Pending;
  const movable = !voided && l.paidQuantity === 0 && l.state !== TabLineState.Requested;
  const voidable = (pending || l.state === TabLineState.Sent) && l.paidQuantity === 0;
  return (
    <li className={cn("flex flex-col gap-0.5 px-3 py-1.5", voided && "text-muted-foreground")} data-testid="tab-line" data-state={tabLineStateKey(l.state)}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          aria-label={t("rest.line.select", { item: l.description })}
          disabled={!movable}
          checked={selected}
          onChange={onSelect}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn("flex flex-wrap items-center gap-1 text-sm font-medium", voided && "line-through")}>
            {l.description}
            <Badge variant={LINE_BADGE[l.state] ?? "outline"}>{t(`rest.line.${tabLineStateKey(l.state)}`)}</Badge>
            {l.seat != null && <Badge variant="secondary">{t("rest.seatN", { seat: l.seat })}</Badge>}
            {l.paidQuantity > 0 && <Badge variant="success">{t("rest.line.paid", { qty: intl.formatNumber(l.paidQuantity) })}</Badge>}
          </span>
          {l.modifiers && <span className="text-xs text-muted-foreground" data-testid="line-modifiers">{l.modifiers}</span>}
          {l.note && <span className="text-xs italic text-muted-foreground">“{l.note}”</span>}
          {voided && l.voidReason && <span className="text-xs text-destructive">{t("rest.line.voidReason", { reason: l.voidReason })}</span>}
          {choices.map((c) => (
            <span key={c.id} className={cn("pl-4 text-xs", c.state === TabLineState.Voided && "line-through")} data-testid="combo-child">
              ↳ {c.description}
            </span>
          ))}
        </div>
        <div className="flex flex-col items-end">
          <span className={cn("text-sm font-semibold tabular-nums", voided && "line-through")}>{money(l.gross)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {intl.formatNumber(l.quantity)} × {money(l.unitPrice)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {pending && (
            <Button size="xs" variant="ghost" aria-label={t("rest.line.edit", { item: l.description })} onClick={() => onEdit(!editing)}>
              <Pencil className="size-3" />
            </Button>
          )}
          {voidable && (
            <Button size="xs" variant="ghost" aria-label={t("rest.line.void", { item: l.description })} onClick={onVoid}>
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>
      {editing && pending && <LineEditor tab={tab} line={l} onClose={() => onEdit(false)} onApplied={onApplied} onError={onError} />}
    </li>
  );
}

function LineEditor({ tab, line, onClose, onApplied, onError }: {
  tab: TabResponse;
  line: TabLineResponse;
  onClose: () => void;
  onApplied: (tab: TabResponse) => void;
  onError: (err: unknown) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [qty, setQty] = useState(String(line.quantity));
  const [seat, setSeat] = useState(line.seat != null ? String(line.seat) : "");
  const [course, setCourse] = useState(String(line.course));
  const [note, setNote] = useState(line.note ?? "");
  const save = useMutation({
    mutationFn: () =>
      apiClient.updatePosTabLine(activeCompanyId as string, tab.id, line.id, {
        quantity: Number(qty), course: Number(course) || 1, ...(seat.trim() ? { seat: Number(seat) } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (next) => {
      onApplied(next);
      onClose();
    },
    onError,
  });
  const valid = Number(qty) > 0 && /^\d+$/.test(course.trim()) && (seat.trim() === "" || /^\d+$/.test(seat.trim()));
  return (
    <form
      className="mt-1 grid grid-cols-[repeat(3,minmax(0,5rem))_1fr_auto] items-end gap-2 rounded-md border bg-muted/40 p-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <label className="flex flex-col gap-0.5">
        {t("till.qty")}
        <Input type="number" min={0.001} step="any" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} className="h-7 text-right tabular-nums" />
      </label>
      <label className="flex flex-col gap-0.5">
        {t("rest.seat")}
        <Input inputMode="numeric" value={seat} onChange={(e) => setSeat(e.target.value)} className="h-7 text-right tabular-nums" />
      </label>
      <label className="flex flex-col gap-0.5">
        {t("rest.course")}
        <Input inputMode="numeric" value={course} onChange={(e) => setCourse(e.target.value)} className="h-7 text-right tabular-nums" />
      </label>
      <label className="flex flex-col gap-0.5">
        {t("rest.note")}
        <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className="h-7" />
      </label>
      <span className="flex gap-1">
        <Button type="button" size="xs" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" size="xs" disabled={!valid || save.isPending}>{t("common.save")}</Button>
      </span>
    </form>
  );
}

// ---- Dialogs ----

// Voiding needs a reason; voiding what the kitchen already has needs a manager (Pos: Approve) —
// the server refuses otherwise, and its message is shown as it is.
function VoidDialog({ tab, line, canApprove, onClose, onDone }: {
  tab: TabResponse;
  line: TabLineResponse;
  canApprove: boolean;
  onClose: () => void;
  onDone: (tab: TabResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => apiClient.voidPosTabLine(activeCompanyId as string, tab.id, line.id, { reason: reason.trim() }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const sent = line.state === TabLineState.Sent;
  return (
    <FormDialog open onOpenChange={(o) => !o && !run.isPending && onClose()} title={t("rest.void.title", { item: line.description })} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (reason.trim()) run.mutate();
        }}
      >
        {sent && <p className="text-sm text-muted-foreground">{t(canApprove ? "rest.void.storno" : "rest.void.needsManager")}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="void-reason">{t("rest.void.reason")}</Label>
        <Input id="void-reason" autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={run.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" variant="destructive" disabled={!reason.trim() || run.isPending}>{t("rest.void.confirm")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function TransferDialog({ tab, plan, onClose, onDone }: {
  tab: TabResponse;
  plan: FloorPlanResponse | undefined;
  onClose: () => void;
  onDone: (tab: TabResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (tableId: string | undefined) => apiClient.transferPosTab(activeCompanyId as string, tab.id, { tableId }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !run.isPending && onClose()} title={t("rest.transfer.title", { number: tab.number })} size="md">
      <div className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {(plan?.floors ?? []).map((f) => (
          <div key={f.id} className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{f.name}</span>
            <div className="flex flex-wrap gap-2">
              {f.tables.map((x) => (
                <Button
                  key={x.id}
                  variant={x.tabs.length === 0 ? "outline" : "secondary"}
                  disabled={x.id === tab.tableId || run.isPending}
                  onClick={() => run.mutate(x.id)}
                >
                  {x.name}
                  {x.tabs.length > 0 && <span className="text-xs text-muted-foreground">· {t("rest.table.status.open")}</span>}
                </Button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          {tab.tableId && (
            <Button variant="outline" className="mr-auto" disabled={run.isPending} onClick={() => run.mutate(undefined)}>{t("rest.transfer.noTable")}</Button>
          )}
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// Merge: bring another tab's unpaid lines onto this one. Move: send the chosen lines to another tab.
function OtherTabDialog({ tab, mode, lineIds, onClose, onDone }: {
  tab: TabResponse;
  mode: "merge" | "move";
  lineIds: string[];
  onClose: () => void;
  onDone: (tab: TabResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [error, setError] = useState<string | null>(null);
  const tabs = useQuery({
    queryKey: ["posOpenTabs", companyId, tab.storeId],
    queryFn: () => apiClient.listOpenPosTabs(companyId, tab.storeId),
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: (otherId: string) =>
      mode === "merge"
        ? apiClient.mergePosTab(companyId, tab.id, { fromTabId: otherId })
        : apiClient.movePosTabLines(companyId, tab.id, { lineIds, toTabId: otherId }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const others = (tabs.data ?? []).filter((x) => x.id !== tab.id);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && !run.isPending && onClose()}
      title={t(mode === "merge" ? "rest.merge.title" : "rest.move.title", { number: tab.number, count: lineIds.length })}
      size="sm"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t(mode === "merge" ? "rest.merge.hint" : "rest.move.hint")}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {tabs.isPending ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : others.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rest.otherTabs.none")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {others.map((x) => (
              <li key={x.id}>
                <TabSummaryButton tab={x} onClick={() => !run.isPending && run.mutate(x.id)} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

function CancelTabDialog({ tab, onClose, onDone }: { tab: TabResponse; onClose: () => void; onDone: (tab: TabResponse) => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => apiClient.cancelPosTab(activeCompanyId as string, tab.id),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !run.isPending && onClose()} title={t("rest.cancelTab.title", { number: tab.number })} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t("rest.cancelTab.hint")}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>{t("common.cancel")}</Button>
          <Button variant="destructive" disabled={run.isPending} onClick={() => run.mutate()}>{t("rest.cancelTab.confirm")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
