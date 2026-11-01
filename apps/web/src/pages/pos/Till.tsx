import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppointmentResponse,
  ChannelOrderResponse,
  CustomerOrderResponse,
  FleetCardResponse,
  MembershipResponse,
  NozzleResponse,
  PackageResponse,
  PartSearchResult,
  PosBootstrapResponse,
  PosCatalogItemResponse,
  PosOrderLineRequest,
  PosOrderResponse,
  PosOrderSummaryResponse,
  PosPaymentRequest,
  PosQuoteRequest,
  PosTenderPartnerResponse,
  PosTenderResponse,
  PrescriptionResponse,
  RepairTicketResponse,
  SessionReportResponse,
  SubstituteResponse,
} from "@pako/shared";
import { ApiException } from "@pako/shared";
import {
  ArrowLeft, BadgeCheck, Banknote, CalendarCheck, ClipboardList, FileBarChart, Gift, IdCard, LayoutGrid, Lock, Minus, Package, Plus, Printer, Repeat, ShieldCheck,
  Ticket, Undo2, Wrench, X,
} from "lucide-react";
import { ArrowLeftRight, CarFront, CreditCard, Fuel, Pill, ShoppingBag } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { cn } from "@/lib/utils";
import { CASH_MOVEMENT_KINDS, FiscalMode, GiftCardKind, PaymentMethodKind, PosOrderKind, RegisterProfile, cashMovementKindKey, giftCardKindKey } from "@/lib/pos-enums";
import { printCoupon } from "@/lib/pos-print";
import { CouponReceipt } from "@/pages/pos/CouponReceipt";
import { SerialPrompt, TillCustomerOrdersDialog, VariantPicker, WarrantyDialog } from "@/pages/pos/TillExtras";
import { TillMembershipDialog, TillPackageDialog } from "@/pages/pos/TillServices";
import { AppointmentState, addDays, localTime, todayLocal, utcFromLocal } from "@/lib/pos-services";
import { RestaurantBody } from "@/pages/pos/restaurant/RestaurantBody";
import { ChannelFulfilment, ChannelPayment, channelFulfilmentKey, channelPaymentKey } from "@/lib/pos-enums";
import { SelfCheckoutBody } from "@/pages/pos/specialist/SelfCheckout";
import { isPast } from "@/pages/pos/specialist/specialist-utils";
import { FleetCardDialog, LitresPrompt, NozzlePanel, SubstitutesDialog, TillPartsDialog, TillPrescriptionDialog } from "@/pages/pos/specialist/TillSpecialist";
import { WaiterControl } from "@/pages/pos/restaurant/WaiterControl";
import { WaiterHandover } from "@/pages/pos/restaurant/WaiterHandover";

/** P3: cafés and restaurants open the till on the floor plan. */
const isRestaurant = (profile: number) => profile === RegisterProfile.Cafe || profile === RegisterProfile.Restaurant;

const money = (v: number | undefined) => (v ?? 0).toFixed(2);

interface BasketLine {
  key: string;
  itemId: string;
  description: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  discountAmount: number;
  taxDefinitionId?: string;
  taxLetter: string;
  /** The cashier confirmed the customer's age for this age-restricted item (P2). */
  ageVerified?: boolean;
  /** A deposit line (P2): the key of the line it belongs to. Its quantity follows that line's. */
  parentKey?: string;
  /** Weighed, price-labelled or open-priced: its own line, never merged with another scan. */
  single?: boolean;
  /** P2: this line sells a gift card (no item) — the number to load, "" = the server issues one. */
  giftCard?: string;
  /** P2: the serial number (IMEI) of the one unit this line sells. */
  serial?: string;
  /** P2: a line of the customer order being collected — its quantity and price were agreed. */
  fromOrder?: boolean;
  /** P4: one service (an appointment's, a membership renewal): its quantity stays at one. */
  fixed?: boolean;
  /** P4: who performed the service (commission). */
  staffUserId?: string;
  /** P4: the package this session is taken from — priced and paid by the server from the package. */
  packageNumber?: string;
  /** P4: the membership this plan line renews. */
  membershipNumber?: string;
  /** P7: the prescription line this medicine is dispensed against. */
  prescriptionLineId?: string;
  /** P7: the nozzle a fuel line was pumped from (its quantity is litres). */
  nozzleId?: string;
  /** P7: the lot (batch) and expiry a GS1 code carried. */
  lot?: string;
  expiry?: string;
}

const toRequestLine = (l: BasketLine): PosOrderLineRequest => l.giftCard !== undefined ? ({
  itemId: undefined,
  description: l.description,
  quantity: 1,
  unitPrice: l.unitPrice,
  taxDefinitionId: undefined,
  discountAmount: 0,
  giftCardNumber: l.giftCard,
}) : ({
  itemId: l.itemId,
  description: l.description,
  quantity: l.quantity,
  unitPrice: l.unitPrice,
  taxDefinitionId: l.taxDefinitionId,
  discountAmount: l.discountAmount,
  ...(l.ageVerified ? { ageVerified: true } : {}),
  ...(l.serial ? { serialNumber: l.serial } : {}),
  ...(l.staffUserId ? { staffUserId: l.staffUserId } : {}),
  ...(l.packageNumber ? { packageNumber: l.packageNumber } : {}),
  ...(l.membershipNumber ? { membershipNumber: l.membershipNumber } : {}),
  ...(l.prescriptionLineId ? { prescriptionLineId: l.prescriptionLineId } : {}),
  ...(l.nozzleId ? { nozzleId: l.nozzleId } : {}),
  ...(l.lot ? { lotNumber: l.lot } : {}),
});

// Deposit lines sit right after the line they belong to, with its quantity; a deposit whose line
// is gone goes with it. Applied after every basket change so the two can't drift apart.
function syncDeposits(lines: BasketLine[]): BasketLine[] {
  const result: BasketLine[] = [];
  for (const line of lines) {
    if (line.parentKey) continue;
    result.push(line);
    for (const deposit of lines)
      if (deposit.parentKey === line.key) result.push(deposit.quantity === line.quantity ? deposit : { ...deposit, quantity: line.quantity });
  }
  return result;
}

/** What is being added to the basket, as far as it is known yet (P2 prompts fill in the rest). */
interface AddRequest {
  item: PosCatalogItemResponse;
  /** From a weight or quantity label, or typed in the weight prompt. */
  quantity?: number;
  /** From a price label (printed on it) or typed in the open-price prompt — never computed. */
  unitPrice?: number;
  ageVerified?: boolean;
  /** P2: the serial number typed in the serial prompt. */
  serial?: string;
  /** P7: from a GS1 code — the lot (batch) and its expiry date. */
  lot?: string;
  expiry?: string;
}

type Prompt = { kind: "age" | "weight" | "price" | "serial"; request: AddRequest };

/** P2: a tender offered in the payment dialog — the customer order's deposit, or exchange credit. */
interface OfferedTender {
  reference: string;
  amount: number;
}

/** A variant's template name: the variant's name without its " M / Blue" label. */
function templateTitle(variants: PosCatalogItemResponse[]): string {
  const first = variants[0];
  if (!first) return "";
  const label = first.variantLabel?.trim();
  if (label && first.name.endsWith(` ${label}`)) return first.name.slice(0, first.name.length - label.length - 1);
  return first.name;
}

/** A catalogue tile: an item, or a template standing for its variants. */
type Tile = { kind: "item"; item: PosCatalogItemResponse } | { kind: "template"; id: string; title: string; variants: PosCatalogItemResponse[] };

/** P2: what the till sends besides the lines — coupon codes, the loyalty card, points to redeem. */
type SaleExtras = Pick<PosQuoteRequest, "couponCodes" | "loyaltyCardNumber" | "redeemPoints" | "prescriptionId" | "fleetCardNumber" | "channelOrderId">;

// Tenders the till takes without a named customer (on-account needs one; not in P1).
const counterTenders = (tenders: PosTenderResponse[]) => tenders.filter((t) => t.kind !== PaymentMethodKind.OnAccount);

// docs/POS_PLAN.md §12 P1: the till. Full screen, keyboard first: the search box always has
// focus, Enter on a barcode adds the item, F9 pays. The basket is priced by the server (quote);
// the browser never adds up money.
export function Till() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { registerId = "" } = useParams();
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const { canWrite } = useMyAccess();

  const bootstrap = useQuery({
    queryKey: ["posBootstrap", companyId, registerId],
    queryFn: () => apiClient.getPosBootstrap(companyId, registerId),
    enabled: !!activeCompanyId && !!registerId,
  });
  const catalog = useQuery({
    queryKey: ["posCatalog", companyId, registerId],
    queryFn: () => apiClient.getPosCatalog(companyId, registerId),
    enabled: !!activeCompanyId && !!registerId,
    staleTime: 5 * 60_000,
  });

  if (bootstrap.isPending) return <TillShell><p className="p-6 text-muted-foreground">{t("common.loading")}</p></TillShell>;
  if (bootstrap.error || !bootstrap.data)
    return (
      <TillShell>
        <div className="p-6">
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(bootstrap.error, t("till.saleError"))}</AlertDescription>
          </Alert>
          <Button className="mt-4" variant="outline" onClick={() => navigate("/pos")}>{t("till.exit")}</Button>
        </div>
      </TillShell>
    );

  const boot = bootstrap.data;
  return (
    <TillShell>
      <TillHeader boot={boot} onExit={() => navigate("/pos")} />
      {boot.register.fiscalMode === FiscalMode.Sef || boot.register.fiscalMode === FiscalMode.Pef ? (
        <div className="p-6">
          <Alert>
            <AlertDescription>{t("till.needsStation")}</AlertDescription>
          </Alert>
        </div>
      ) : !canWrite("pos") ? (
        // Display only — the API refuses the sale anyway; a reader reaching the till by URL is told why.
        <div className="p-6">
          <Alert variant="destructive">
            <AlertDescription>{t("till.noAccess")}</AlertDescription>
          </Alert>
        </div>
      ) : !boot.session ? (
        <OpenSessionPanel boot={boot} />
      ) : boot.register.profile === RegisterProfile.SelfCheckout ? (
        // P7: a self-checkout lane — scan, pay by card; age checks call the attendant.
        <SelfCheckoutBody boot={boot} sessionId={boot.session.id} catalog={catalog.data ?? []} />
      ) : isRestaurant(boot.register.profile) ? (
        // P3: cafés and restaurants work from the floor plan and tabs; a counter sale is one tap away.
        <RestaurantBody
          boot={boot}
          sessionId={boot.session.id}
          catalog={catalog.data ?? []}
          counterSale={(onBack) => <TillBody boot={boot} sessionId={(boot.session as { id: string }).id} catalog={catalog.data ?? []} onFloorPlan={onBack} />}
        />
      ) : (
        <TillBody boot={boot} sessionId={boot.session.id} catalog={catalog.data ?? []} />
      )}
    </TillShell>
  );
}

function TillShell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh flex-col bg-background text-foreground">{children}</div>;
}

function TillHeader({ boot, onExit }: { boot: PosBootstrapResponse; onExit: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const training = boot.register.fiscalMode === FiscalMode.Training;
  return (
    <>
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="ghost" onClick={onExit} aria-label={t("till.exit")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-semibold">{t("till.title", { register: boot.register.name, store: boot.store.name })}</h1>
        <span className="text-sm text-muted-foreground">{boot.companyName}</span>
        {boot.session && <Badge variant="secondary">{t("pos.session.number")} {boot.session.number}</Badge>}
        {boot.session && <WaiterControl className="ml-auto" />}
      </header>
      {training && (
        <div className="bg-amber-400 px-4 py-1 text-center text-sm font-bold text-black" role="status">
          {t("till.training")}
        </div>
      )}
    </>
  );
}

function OpenSessionPanel({ boot }: { boot: PosBootstrapResponse }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const [float, setFloat] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => apiClient.openPosSession(activeCompanyId as string, boot.register.id, { openingFloat: Number(float) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posBootstrap", activeCompanyId, boot.register.id] }),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <form
      className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-3 rounded-lg border p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        open.mutate();
      }}
    >
      <h2 className="text-lg font-semibold">{t("till.openSession")}</h2>
      <p className="text-sm text-muted-foreground">{t("till.openSession.description")}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Label htmlFor="till-float">{t("till.openingFloat")}</Label>
      <Input id="till-float" type="number" min={0} step="0.01" autoFocus value={float} onChange={(e) => setFloat(e.target.value)} className="text-right tabular-nums" />
      <Button type="submit" disabled={open.isPending}>{t("till.openSession")}</Button>
    </form>
  );
}

function TillBody({ boot, sessionId, catalog, onFloorPlan }: {
  boot: PosBootstrapResponse;
  sessionId: string;
  catalog: PosCatalogItemResponse[];
  /** P3: a counter sale on a restaurant till goes back to the floor plan. */
  onFloorPlan?: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const { canApprove } = useMyAccess();
  const searchRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  // What the cashier is typing in a quantity or discount box, by "<line key>:qty|disc". Committed
  // on blur or Enter, so "0.5" can be typed through "0" and "0." without being refused.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | "pay" | "cash" | "return" | "x" | "close" | "coupon" | "loyalty" | "giftCard" | "warranty" | "customerOrders" | "package" | "membership"
    | "prescription" | "fleetCard" | "parts" | null
  >(null);
  // P7: the prescription this sale dispenses, the fleet card that pays for the fill, the online
  // order being checked out; the line whose substitutes are shown, the nozzle whose litres are asked.
  const [prescription, setPrescription] = useState<PrescriptionResponse | null>(null);
  const [fleetCard, setFleetCard] = useState<FleetCardResponse | null>(null);
  const [channelOrder, setChannelOrder] = useState<ChannelOrderResponse | null>(null);
  const [substituteFor, setSubstituteFor] = useState<BasketLine | null>(null);
  const [nozzle, setNozzle] = useState<NozzleResponse | null>(null);
  const forecourt = boot.register.profile === RegisterProfile.Forecourt;
  // P4: the appointment this sale checks out, or the repair it collects (from ?appointment= / ?repair=),
  // and a deposit card to load (?giftCard=).
  const [appointment, setAppointment] = useState<AppointmentResponse | null>(null);
  const [repair, setRepair] = useState<RepairTicketResponse | null>(null);
  const [giftCardPrefill, setGiftCardPrefill] = useState("");
  // P2: the template whose variants are being picked from.
  const [variantPick, setVariantPick] = useState<{ title: string; variants: PosCatalogItemResponse[] } | null>(null);
  // P2: the customer order this sale collects, and a store-credit card from an exchange — each
  // offered as a gift-card tender in the payment dialog.
  const [customerOrder, setCustomerOrder] = useState<CustomerOrderResponse | null>(null);
  const [exchangeCredit, setExchangeCredit] = useState<OfferedTender | null>(null);
  // P2: coupon codes entered, the loyalty card shown and the points the customer redeems. Sent
  // with every quote and with the order; the server decides what each is worth.
  const [codes, setCodes] = useState<string[]>([]);
  const [loyaltyNumber, setLoyaltyNumber] = useState("");
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [redeemDraft, setRedeemDraft] = useState<string | null>(null);
  // P2: the age check, weight or open price asked before an item goes into the basket.
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [done, setDone] = useState<PosOrderResponse | null>(null);
  // One ClientUuid per sale (D11). It lives here, not in the payment dialog, so cancelling and
  // paying again after a failed or lost answer reuses it and the server records the sale once.
  // Only a recorded sale or an emptied basket starts a new one.
  const [saleUuid, setSaleUuid] = useState(() => crypto.randomUUID());
  // The same for returns and cancellations: one ClientUuid per (original order, action).
  const returnUuids = useRef<{ orderId: string; byKind: Record<number, string> } | null>(null);

  const requestLines = useMemo(() => basket.map(toRequestLine), [basket]);
  // Only what is set goes on the wire.
  const extras = useMemo<SaleExtras>(() => ({
    ...(codes.length > 0 ? { couponCodes: codes } : {}),
    ...(loyaltyNumber ? { loyaltyCardNumber: loyaltyNumber } : {}),
    ...(loyaltyNumber && redeemPoints > 0 ? { redeemPoints } : {}),
    ...(prescription ? { prescriptionId: prescription.id } : {}),
    ...(fleetCard ? { fleetCardNumber: fleetCard.number } : {}),
    ...(channelOrder ? { channelOrderId: channelOrder.id } : {}),
  }), [codes, loyaltyNumber, redeemPoints, prescription, fleetCard, channelOrder]);
  const quote = useQuery({
    queryKey: ["posQuote", companyId, boot.register.id, requestLines, extras],
    queryFn: () => apiClient.quotePosBasket(companyId, boot.register.id, { lines: requestLines, ...extras }),
    enabled: basket.length > 0,
    placeholderData: keepPreviousData,
  });

  const found = useMemo(() => {
    const q = term.trim().toLowerCase();
    const sellable = catalog.filter((i) => i.price != null);
    if (!q) return sellable.slice(0, 48);
    return catalog
      .filter((i) => i.name.toLowerCase().includes(q) || String(i.code) === q || i.barcodes.some((b) => b === q))
      .slice(0, 48);
  }, [catalog, term]);

  // P2: variants of one template share a tile (the template itself isn't sold); the picker offers
  // every variant of it in the catalogue, not only the ones the search matched.
  const tiles = useMemo<Tile[]>(() => {
    const result: Tile[] = [];
    const seen = new Set<string>();
    for (const item of found) {
      const templateId = item.variantOfItemId;
      if (!templateId) {
        result.push({ kind: "item", item });
        continue;
      }
      if (seen.has(templateId)) continue;
      seen.add(templateId);
      const variants = catalog.filter((i) => i.variantOfItemId === templateId);
      result.push({ kind: "template", id: templateId, title: templateTitle(variants), variants });
    }
    return result;
  }, [found, catalog]);

  useEffect(() => {
    if (!dialog && !done && !prompt && !variantPick && !substituteFor && !nozzle) searchRef.current?.focus();
  }, [dialog, done, prompt, variantPick, substituteFor, nozzle]);

  // The scanner types into whatever has focus and ends with Enter: a tile or basket button left
  // focused would be clicked again by the next scan. Buttons skip focus on mouse down, and every
  // basket action hands it back to the search box.
  const keepSearchFocus = (e: React.MouseEvent) => e.preventDefault();
  const refocus = () => searchRef.current?.focus();

  function add(item: PosCatalogItemResponse) {
    setTerm("");
    proceed({ item });
  }

  // P2: an item goes in once everything it needs is known — the customer's age, a weight, a price.
  // Each missing piece opens its prompt, which comes back here with the answer.
  function proceed(request: AddRequest) {
    setNotice(null);
    const { item } = request;
    const priced = item.price != null || request.unitPrice != null || !!item.openPrice;
    if (!priced) {
      setNotice(t("till.noPrice", { item: item.name }));
      refocus();
      return;
    }
    // The same customer was already checked for this item in this sale.
    const checked = request.ageVerified || basket.some((l) => l.itemId === item.id && l.ageVerified);
    if ((item.minimumAge ?? 0) > 0 && !checked) setPrompt({ kind: "age", request });
    else if (item.sellByWeight && request.quantity == null) setPrompt({ kind: "weight", request: { ...request, ageVerified: checked || undefined } });
    else if (item.openPrice && request.unitPrice == null) setPrompt({ kind: "price", request: { ...request, ageVerified: checked || undefined } });
    else if (item.trackSerials && !request.serial) setPrompt({ kind: "serial", request: { ...request, ageVerified: checked || undefined } });
    else commit({ ...request, ageVerified: checked || undefined });
  }

  function commit({ item, quantity, unitPrice, ageVerified, serial, lot, expiry }: AddRequest) {
    setPrompt(null);
    // A weighed, labelled, open-priced or serial-numbered item is its own line; a plain scan adds
    // one to its line. A serial number is one unit. P7: so is a lot from a GS1 code.
    const single = quantity != null || unitPrice != null || !!item.openPrice || !!item.sellByWeight || !!serial || !!lot;
    if (expiry && isPast(expiry)) setNotice(t("spec.till.gs1.expired", { item: item.name, date: intl.formatDate(expiry) }));
    const lineQuantity = serial ? 1 : quantity;
    const deposit = item.depositItemId ? catalog.find((i) => i.id === item.depositItemId) : undefined;
    if (item.depositItemId && deposit?.price == null) setNotice(t("till.depositMissing", { item: item.name }));
    setBasketSynced((lines) => {
      const same = single ? undefined : lines.find((l) => l.itemId === item.id && l.discountAmount === 0 && !l.parentKey && !l.single);
      if (same) return lines.map((l) => (l === same ? { ...l, quantity: l.quantity + 1, ageVerified: l.ageVerified || ageVerified } : l));
      const key = crypto.randomUUID();
      const line: BasketLine = {
        key, itemId: item.id, description: item.name, unit: item.unit, unitPrice: unitPrice ?? (item.price as number),
        quantity: lineQuantity ?? 1, discountAmount: 0, taxDefinitionId: item.taxDefinitionId, taxLetter: item.taxLetter, ageVerified, single,
        ...(serial ? { serial } : {}),
        ...(lot ? { lot } : {}),
        ...(expiry ? { expiry } : {}),
      };
      const added = [...lines, line];
      if (deposit?.price != null)
        added.push({
          key: crypto.randomUUID(), itemId: deposit.id, description: deposit.name, unit: deposit.unit, unitPrice: deposit.price,
          quantity: line.quantity, discountAmount: 0, taxDefinitionId: deposit.taxDefinitionId, taxLetter: deposit.taxLetter, parentKey: key,
        });
      return added;
    });
    refocus();
  }

  function setBasketSynced(change: (lines: BasketLine[]) => BasketLine[]) {
    setBasket((lines) => syncDeposits(change(lines)));
  }

  function remove(key: string) {
    const next = syncDeposits(basket.filter((x) => x.key !== key));
    setBasket(next);
    if (next.length === 0) {
      setSaleUuid(crypto.randomUUID());
      setCustomerOrder(null);
      setAppointment(null);
      setRepair(null);
      setPrescription(null);
      setChannelOrder(null);
    } else if (prescription && !next.some((l) => l.prescriptionLineId)) setPrescription(null);
    refocus();
  }

  function resetExtras() {
    setCodes([]);
    setLoyaltyNumber("");
    setRedeemPoints(0);
    setRedeemDraft(null);
  }

  function resetSpecialist() {
    setPrescription(null);
    setFleetCard(null);
    setChannelOrder(null);
  }

  function clear() {
    setBasket([]);
    setDrafts({});
    resetExtras();
    resetSpecialist();
    setCustomerOrder(null);
    setExchangeCredit(null);
    setAppointment(null);
    setRepair(null);
    setSaleUuid(crypto.randomUUID());
    refocus();
  }

  // P2: a gift card sold — its own line, no item, quantity 1, the amount typed (never computed).
  function addGiftCard(amount: number, number: string) {
    setDialog(null);
    setBasketSynced((lines) => [
      ...lines,
      { key: crypto.randomUUID(), itemId: "", description: t("till.giftCard.line"), unit: "", unitPrice: amount, quantity: 1, discountAmount: 0, taxLetter: "", single: true, giftCard: number },
    ]);
    refocus();
  }

  // P2: a deposit on a customer order — like a gift card line, loading the order's deposit card.
  function addDeposit(order: CustomerOrderResponse, amount: number) {
    setDialog(null);
    setBasketSynced((lines) => [
      ...lines,
      {
        key: crypto.randomUUID(), itemId: "", description: t("till.customerOrders.depositLine", { number: order.number }), unit: "", unitPrice: amount,
        quantity: 1, discountAmount: 0, taxLetter: "", single: true, giftCard: order.depositCardNumber,
      },
    ]);
    refocus();
  }

  // P2: collecting a customer order — its lines at the agreed prices; the sale records the order.
  function collect(order: CustomerOrderResponse) {
    setDialog(null);
    setDrafts({});
    setBasket(
      order.lines.map((l) => {
        const item = catalog.find((i) => i.id === l.itemId);
        return {
          key: crypto.randomUUID(), itemId: l.itemId, description: l.description, unit: item?.unit ?? "", unitPrice: l.unitPrice, quantity: l.quantity,
          discountAmount: 0, taxDefinitionId: item?.taxDefinitionId, taxLetter: item?.taxLetter ?? "", single: true, fromOrder: true,
        };
      }),
    );
    setCustomerOrder(order);
    setSaleUuid(crypto.randomUUID());
    refocus();
  }

  // ---- P4: services ----

  /** A catalogue item's unit and tax for a service line the server prices. */
  const lineBase = (itemId: string) => {
    const item = catalog.find((i) => i.id === itemId);
    return { unit: item?.unit ?? "", taxDefinitionId: item?.taxDefinitionId, taxLetter: item?.taxLetter ?? "" };
  };

  // Checking out an appointment: its service at the API's price, credited to whoever performed it.
  function checkoutAppointment(a: AppointmentResponse, staffUserId: string | undefined) {
    const price = a.price ?? catalog.find((i) => i.id === a.itemId)?.price;
    if (price == null) {
      setNotice(t("till.noPrice", { item: a.serviceName }));
      return;
    }
    setBasketSynced((lines) => [
      ...lines,
      {
        key: crypto.randomUUID(), itemId: a.itemId, description: a.serviceName, ...lineBase(a.itemId), unitPrice: price, quantity: 1, discountAmount: 0,
        single: true, fixed: true, ...(staffUserId ? { staffUserId } : {}),
      },
    ]);
    setAppointment(a);
    refocus();
  }

  // Collecting a repair: its estimate lines at the agreed prices.
  function collectRepair(r: RepairTicketResponse) {
    setDrafts({});
    setBasket(
      r.lines.map((l) => ({
        key: crypto.randomUUID(), itemId: l.itemId, description: l.description, ...lineBase(l.itemId), unitPrice: l.unitPrice, quantity: l.quantity,
        discountAmount: 0, single: true, fromOrder: true,
      })),
    );
    setRepair(r);
    setSaleUuid(crypto.randomUUID());
    refocus();
  }

  // A session from a package: priced at the package's value per session (the server's figure).
  function takePackageSession(p: PackageResponse) {
    setDialog(null);
    const taken = basket.filter((l) => l.packageNumber === p.number).length;
    if (taken >= p.sessionsLeft) {
      setNotice(t("svc.till.package.usedUp", { number: p.number }));
      refocus();
      return;
    }
    setBasketSynced((lines) => [
      ...lines,
      {
        key: crypto.randomUUID(), itemId: p.serviceItemId, description: p.serviceName, ...lineBase(p.serviceItemId), unitPrice: p.unitValue, quantity: 1,
        discountAmount: 0, single: true, packageNumber: p.number,
      },
    ]);
    refocus();
  }

  // Renewing a membership: the plan item at the store's price, with the membership's number.
  function renewMembership(m: MembershipResponse) {
    setDialog(null);
    const plan = catalog.find((i) => i.id === m.planItemId);
    if (plan?.price == null) {
      setNotice(t("till.noPrice", { item: m.planName }));
      refocus();
      return;
    }
    setBasketSynced((lines) => [
      ...lines,
      {
        key: crypto.randomUUID(), itemId: plan.id, description: plan.name, unit: plan.unit, unitPrice: plan.price as number, quantity: 1, discountAmount: 0,
        taxDefinitionId: plan.taxDefinitionId, taxLetter: plan.taxLetter, single: true, fixed: true, membershipNumber: m.number,
      },
    ]);
    refocus();
  }

  // ---- P7: pharmacy, fuel, parts, online orders ----

  /** The till's catalogue entry of an item, priced — or a notice why it can't be sold. */
  function priced(itemId: string, name: string): PosCatalogItemResponse | null {
    const item = catalog.find((i) => i.id === itemId);
    if (item?.price == null) {
      setNotice(t("till.noPrice", { item: item?.name ?? name }));
      return null;
    }
    return item;
  }

  // Dispensing a prescription: a line per medicine still to give, its remaining quantity at the
  // till's price, against the prescription line (the server counts what was dispensed).
  function dispense(p: PrescriptionResponse) {
    setDialog(null);
    setNotice(null);
    const missing: string[] = [];
    const added: BasketLine[] = [];
    for (const rx of p.lines) {
      if (rx.remaining <= 0) continue;
      const item = catalog.find((i) => i.id === rx.itemId);
      if (item?.price == null) {
        missing.push(rx.itemName);
        continue;
      }
      added.push({
        key: crypto.randomUUID(), itemId: item.id, description: item.name, unit: item.unit, unitPrice: item.price, quantity: rx.remaining, discountAmount: 0,
        taxDefinitionId: item.taxDefinitionId, taxLetter: item.taxLetter, single: true, prescriptionLineId: rx.id,
      });
    }
    setBasketSynced((lines) => [...lines.filter((l) => !l.prescriptionLineId), ...added]);
    setPrescription(p);
    if (missing.length > 0) setNotice(t("spec.till.rx.noPrice", { items: missing.join(", ") }));
    else if (added.length === 0) setNotice(t("spec.till.rx.nothingLeft", { number: p.number }));
    refocus();
  }

  function dropPrescription() {
    setBasketSynced((lines) => lines.filter((l) => !l.prescriptionLineId));
    setPrescription(null);
    refocus();
  }

  // Another item with the same active ingredient takes the line's place, at the till's price.
  function substitute(line: BasketLine, sub: SubstituteResponse) {
    setSubstituteFor(null);
    const item = priced(sub.itemId, sub.name);
    if (item) {
      update(line.key, {
        itemId: item.id, description: item.name, unit: item.unit, unitPrice: item.price as number, taxDefinitionId: item.taxDefinitionId, taxLetter: item.taxLetter,
        ageVerified: undefined, lot: undefined, expiry: undefined, serial: undefined,
      });
    }
    refocus();
  }

  // A fill: the nozzle's grade at the till's price, the litres the pump shows.
  function addFuel(n: NozzleResponse, litres: number) {
    setNozzle(null);
    const item = priced(n.itemId, n.itemName);
    if (item) {
      setBasketSynced((lines) => [
        ...lines,
        {
          key: crypto.randomUUID(), itemId: item.id, description: t("spec.till.fuel.line", { grade: item.name, pump: n.pump, number: n.number }), unit: item.unit,
          unitPrice: item.price as number, quantity: litres, discountAmount: 0, taxDefinitionId: item.taxDefinitionId, taxLetter: item.taxLetter, single: true,
          nozzleId: n.id,
        },
      ]);
    }
    refocus();
  }

  function addPart(r: PartSearchResult) {
    setDialog(null);
    const item = priced(r.itemId, r.name);
    if (item) proceed({ item });
    else refocus();
  }

  // Checking out an online order: its lines at the prices the webshop charged.
  function checkoutChannelOrder(o: ChannelOrderResponse) {
    setDrafts({});
    setBasket(
      o.lines.map((l) => ({
        key: crypto.randomUUID(), itemId: l.itemId, description: l.description, ...lineBase(l.itemId), unitPrice: l.unitPrice, quantity: l.quantity,
        discountAmount: 0, single: true, fromOrder: true,
      })),
    );
    setChannelOrder(o);
    setSaleUuid(crypto.randomUUID());
    refocus();
  }

  // Deep links from the back office: ?appointment=<id>&on=<day>, ?repair=<id>, ?giftCard=<number>.
  // Each is applied once, then dropped from the URL so a reload doesn't add it again.
  const [params, setParams] = useSearchParams();
  const appointmentParam = params.get("appointment");
  const onParam = params.get("on");
  const repairParam = params.get("repair");
  const giftCardParam = params.get("giftCard");
  const channelOrderParam = params.get("channelOrder");
  const dropParams = (...names: string[]) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const n of names) next.delete(n);
        return next;
      },
      { replace: true },
    );
  const linkedAppointment = useQuery({
    queryKey: ["posTillAppointment", companyId, boot.store.id, appointmentParam, onParam],
    queryFn: async () => {
      // There is no endpoint for one appointment: its day's list (in Kosovo time) has it.
      const day = onParam && /^\d{4}-\d{2}-\d{2}$/.test(onParam) ? onParam : todayLocal();
      const [list, resources] = await Promise.all([
        apiClient.listPosAppointments(companyId, boot.store.id, utcFromLocal(day), utcFromLocal(addDays(day, 1)), undefined),
        apiClient.listPosResources(companyId, boot.store.id),
      ]);
      const found = list.find((a) => a.id === appointmentParam);
      return found ? { appointment: found, staffUserId: resources.find((r) => r.id === found.resourceId)?.userId } : null;
    },
    enabled: !!appointmentParam,
    retry: false,
    staleTime: Infinity,
  });
  const linkedRepair = useQuery({
    queryKey: ["posTillRepair", companyId, repairParam],
    queryFn: () => apiClient.getPosRepair(companyId, repairParam as string),
    enabled: !!repairParam,
    retry: false,
    staleTime: Infinity,
  });
  const linkedChannelOrder = useQuery({
    queryKey: ["posTillChannelOrder", companyId, channelOrderParam],
    queryFn: () => apiClient.getPosChannelOrder(companyId, channelOrderParam as string),
    enabled: !!channelOrderParam,
    retry: false,
    staleTime: Infinity,
  });
  const appliedLinks = useRef(new Set<string>());
  useEffect(() => {
    if (!channelOrderParam || linkedChannelOrder.isPending) return;
    const key = `c:${channelOrderParam}`;
    if (appliedLinks.current.has(key)) return;
    appliedLinks.current.add(key);
    if (linkedChannelOrder.data) {
      if (linkedChannelOrder.data.posOrderId) setNotice(t("spec.till.online.done", { number: linkedChannelOrder.data.number }));
      else checkoutChannelOrder(linkedChannelOrder.data);
    } else setNotice(getApiErrorMessage(linkedChannelOrder.error, t("spec.till.online.notFound")));
    dropParams("channelOrder");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelOrderParam, linkedChannelOrder.isPending, linkedChannelOrder.data]);
  useEffect(() => {
    if (!appointmentParam || linkedAppointment.isPending || catalog.length === 0) return;
    const key = `a:${appointmentParam}`;
    if (appliedLinks.current.has(key)) return;
    appliedLinks.current.add(key);
    const data = linkedAppointment.data;
    if (!data) setNotice(t("svc.till.appointment.notFound"));
    else if (data.appointment.state === AppointmentState.Completed || data.appointment.state === AppointmentState.Cancelled) setNotice(t("svc.till.appointment.closed", { number: data.appointment.number }));
    else checkoutAppointment(data.appointment, data.staffUserId);
    dropParams("appointment", "on");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentParam, linkedAppointment.isPending, linkedAppointment.data, catalog.length]);
  useEffect(() => {
    if (!repairParam || linkedRepair.isPending) return;
    const key = `r:${repairParam}`;
    if (appliedLinks.current.has(key)) return;
    appliedLinks.current.add(key);
    if (linkedRepair.data) collectRepair(linkedRepair.data);
    else setNotice(getApiErrorMessage(linkedRepair.error, t("svc.till.repair.notFound")));
    dropParams("repair");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairParam, linkedRepair.isPending, linkedRepair.data]);
  useEffect(() => {
    if (!giftCardParam) return;
    setGiftCardPrefill(giftCardParam);
    setDialog("giftCard");
    dropParams("giftCard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftCardParam]);

  function commitRedeem() {
    if (redeemDraft === null) return;
    const value = Number(redeemDraft);
    if (redeemDraft.trim() === "") setRedeemPoints(0);
    else if (Number.isFinite(value) && value >= 0) setRedeemPoints(value);
    setRedeemDraft(null);
  }

  function update(key: string, patch: Partial<BasketLine>) {
    setBasketSynced((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function dropDraft(id: string) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  function commitDraft(key: string, field: "quantity" | "discountAmount") {
    const id = `${key}:${field === "quantity" ? "qty" : "disc"}`;
    const draft = drafts[id];
    if (draft === undefined) return;
    const value = Number(draft);
    // A quantity must be above zero, a discount zero or more; anything else reverts.
    const valid = draft.trim() !== "" && Number.isFinite(value) && (field === "quantity" ? value > 0 : value >= 0);
    if (valid) update(key, { [field]: value });
    dropDraft(id);
  }

  function draftInput(l: BasketLine, field: "quantity" | "discountAmount") {
    const id = `${l.key}:${field === "quantity" ? "qty" : "disc"}`;
    return {
      value: drafts[id] ?? String(l[field]),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDrafts((d) => ({ ...d, [id]: e.target.value })),
      onBlur: () => commitDraft(l.key, field),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitDraft(l.key, field);
          refocus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          dropDraft(id);
        }
      },
    };
  }

  const q = quote.data;
  const quoteError = quote.error ? getApiErrorMessage(quote.error, t("till.saleError")) : null;
  // With keepPreviousData the quote on screen can be the previous basket's: until the answer for
  // this basket is in, nothing is paid against it and no line shows a figure.
  const quoteCurrent = !!q && !quote.isPlaceholderData;
  const canPay = basket.length > 0 && quoteCurrent && !quoteError && !quote.isFetching;

  // P2: a code the cached catalogue doesn't know — a PLU, an in-store weight/price/quantity label,
  // or a barcode added since the catalogue was loaded — is decoded by the server.
  async function scan(typed: string, fallback: PosCatalogItemResponse | undefined) {
    try {
      const hit = await apiClient.scanPosCode(companyId, boot.register.id, typed);
      setTerm((current) => (current.trim() === typed ? "" : current));
      proceed({
        item: hit.item, quantity: hit.quantity ?? undefined, unitPrice: hit.match === "price" ? hit.unitPrice ?? undefined : undefined,
        // P7: a GS1 DataMatrix carries the lot, expiry and the pack's serial number.
        ...(hit.lotNumber ? { lot: hit.lotNumber } : {}),
        ...(hit.expiryDate ? { expiry: hit.expiryDate.slice(0, 10) } : {}),
        ...(hit.serialNumber ? { serial: hit.serialNumber } : {}),
      });
    } catch (err) {
      if (err instanceof ApiException && err.status === 404) {
        if (fallback) add(fallback);
        else setNotice(t("till.notFound", { term: typed }));
      } else setNotice(t("till.scanError", { term: typed, error: getApiErrorMessage(err, t("till.saleError")) }));
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    // preventDefault on Enter also keeps its keypress from reaching a prompt that opens meanwhile
    // (a scanner's Enter must not answer the age check).
    if (e.key === "Enter") {
      e.preventDefault();
      const typed = term.trim();
      if (!typed) return;
      // A scanned barcode or typed code in the catalogue adds straight away; a typed name with one
      // match takes it; anything else asks the server what the code is.
      const exact = catalog.find((i) => i.barcodes.includes(typed) || String(i.code) === typed);
      const only = found.length === 1 ? found[0] : undefined;
      if (exact) add(exact);
      else if (only && !/^\d+$/.test(typed)) add(only);
      else void scan(typed, only);
    } else if (e.key === "F9") {
      e.preventDefault();
      // Same guards as the Pay button.
      if (canPay) setDialog("pay");
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_28rem]">
      {/* Catalogue */}
      <section className="flex min-h-0 flex-col gap-3 border-r p-4">
        <Input
          ref={searchRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder={t("till.search")}
          className="h-12 text-lg"
          aria-label={t("till.search")}
          autoFocus
        />
        {notice && (
          <Alert variant="destructive">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {/* P7: a forecourt till starts a fill from the pump and nozzle. */}
        {forecourt && <NozzlePanel storeId={boot.store.id} onNozzle={setNozzle} />}
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {tiles.map((tile) =>
            tile.kind === "template" ? (
              <button
                key={`t-${tile.id}`}
                type="button"
                onMouseDown={keepSearchFocus}
                onClick={() => {
                  setTerm("");
                  setVariantPick({ title: tile.title, variants: tile.variants });
                }}
                className="flex min-h-20 flex-col justify-between rounded-md border border-dashed p-2 text-left hover:bg-accent focus-visible:outline-2"
                data-testid="variant-tile"
              >
                <span className="line-clamp-2 text-sm font-medium">{tile.title}</span>
                <span className="text-xs text-muted-foreground">{t("till.variant.count", { count: tile.variants.length })}</span>
              </button>
            ) : (
              <button
                key={tile.item.id}
                type="button"
                onMouseDown={keepSearchFocus}
                onClick={() => add(tile.item)}
                className={cn(
                  "flex min-h-20 flex-col justify-between rounded-md border p-2 text-left hover:bg-accent focus-visible:outline-2",
                  tile.item.price == null && "opacity-50",
                )}
              >
                <span className="line-clamp-2 text-sm font-medium">{tile.item.name}</span>
                <span className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>#{tile.item.code}</span>
                  <span className="text-sm font-semibold text-foreground">{tile.item.price == null ? "—" : money(tile.item.price)}</span>
                </span>
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onFloorPlan && (
            <Button variant="outline" onClick={onFloorPlan} disabled={basket.length > 0}>
              <LayoutGrid className="size-4" /> {t("rest.floorPlan")}
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialog("coupon")}>
            <Ticket className="size-4" /> {t("till.actions.coupon")}
          </Button>
          {/* P7: pharmacy prescriptions, fleet cards at the pump, the auto-parts search. */}
          <Button variant="outline" onClick={() => setDialog("prescription")}>
            <Pill className="size-4" /> {t("spec.till.actions.prescription")}
          </Button>
          {forecourt && (
            <Button variant="outline" onClick={() => setDialog("fleetCard")}>
              <CreditCard className="size-4" /> {t("spec.till.actions.fleetCard")}
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialog("parts")}>
            <CarFront className="size-4" /> {t("spec.till.actions.parts")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("loyalty")}>
            <IdCard className="size-4" /> {t("till.actions.loyalty")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("giftCard")}>
            <Gift className="size-4" /> {t("till.actions.giftCard")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("customerOrders")}>
            <ClipboardList className="size-4" /> {t("till.actions.customerOrders")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("package")}>
            <Package className="size-4" /> {t("svc.till.actions.package")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("membership")}>
            <BadgeCheck className="size-4" /> {t("svc.till.actions.membership")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("warranty")}>
            <ShieldCheck className="size-4" /> {t("till.actions.warranty")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("cash")}>
            <Banknote className="size-4" /> {t("till.actions.cash")}
          </Button>
          {canApprove("pos") && (
            <Button variant="outline" onClick={() => setDialog("return")}>
              <Undo2 className="size-4" /> {t("till.actions.return")}
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialog("x")}>
            <FileBarChart className="size-4" /> {t("till.actions.x")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("close")} disabled={basket.length > 0}>
            <Lock className="size-4" /> {t("till.actions.close")}
          </Button>
        </div>
      </section>

      {/* Basket */}
      <section className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {basket.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">{t("till.basket.empty")}</p>
          ) : (
            <ul className="divide-y">
              {basket.map((l, i) => (
                <li key={l.key} className={cn("flex flex-col gap-1 px-3 py-2", l.parentKey && "bg-muted/40 pl-6")} data-testid={l.parentKey ? "deposit-line" : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {l.description}
                      {l.parentKey && <Badge variant="secondary">{t("till.deposit")}</Badge>}
                      {l.giftCard !== undefined && <Badge variant="outline">{l.giftCard || t("till.giftCard.newNumber")}</Badge>}
                      {l.ageVerified && <Badge variant="outline">{t("till.ageVerified")}</Badge>}
                      {l.serial && <Badge variant="outline" data-testid="line-serial">{t("till.serial.badge", { serial: l.serial })}</Badge>}
                      {l.packageNumber && <Badge variant="outline" data-testid="line-package">{t("svc.till.packageBadge", { number: l.packageNumber })}</Badge>}
                      {l.membershipNumber && <Badge variant="outline" data-testid="line-membership">{t("svc.till.membershipBadge", { number: l.membershipNumber })}</Badge>}
                      {l.prescriptionLineId && <Badge variant="outline" data-testid="line-rx"><Pill className="size-3" /> {t("spec.till.rx.badge")}</Badge>}
                      {l.nozzleId && <Badge variant="outline" data-testid="line-nozzle"><Fuel className="size-3" /> {t("spec.till.fuel.badge")}</Badge>}
                      {l.lot && <Badge variant="outline" data-testid="line-lot">{t("spec.till.gs1.lot", { lot: l.lot })}</Badge>}
                      {l.expiry && (
                        <Badge variant={isPast(l.expiry) ? "destructive" : "outline"} data-testid="line-expiry">
                          {t(isPast(l.expiry) ? "spec.till.gs1.expiredBadge" : "spec.till.gs1.expiry", { date: intl.formatDate(l.expiry) })}
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {quoteCurrent && q?.lines[i] ? money(q.lines[i].gross) : "…"} <span className="text-xs text-muted-foreground">{l.taxLetter}</span>
                    </span>
                  </div>
                  {/* P2: the promotion, coupon or loyalty discount the server gave this line. */}
                  {quoteCurrent && q?.lines[i]?.programName && (
                    <div className="flex justify-between text-xs text-emerald-700 tabular-nums dark:text-emerald-400" data-testid="line-program">
                      <span>{q.lines[i].programName}</span>
                      <span>−{money(q.lines[i].programDiscount)}</span>
                    </div>
                  )}
                  {l.giftCard !== undefined || l.packageNumber ? (
                    // A gift card: one card of the amount typed; a package session: one, at the
                    // package's value — nothing to change but remove it.
                    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>1 × {money(l.unitPrice)}</span>
                      <Button className="ml-auto" size="xs" variant="ghost" aria-label={t("till.remove")} onMouseDown={keepSearchFocus} onClick={() => remove(l.key)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  ) : l.parentKey ? (
                    // Follows its item: changed or removed with it.
                    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>{intl.formatNumber(l.quantity)} × {money(l.unitPrice)}</span>
                    </div>
                  ) : l.serial || l.fromOrder || l.fixed ? (
                    // One serial-numbered unit, or a customer order's agreed line: the quantity stays.
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground tabular-nums">{intl.formatNumber(l.quantity)} × {money(l.unitPrice)}</span>
                      <Label className="ml-auto text-xs text-muted-foreground" htmlFor={`disc-${l.key}`}>{t("till.discount")}</Label>
                      <Input id={`disc-${l.key}`} type="number" min={0} step="0.01" {...draftInput(l, "discountAmount")} className="h-7 w-20 text-right tabular-nums" />
                      <Button size="xs" variant="ghost" aria-label={t("till.remove")} onMouseDown={keepSearchFocus} onClick={() => remove(l.key)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label="−1"
                      onMouseDown={keepSearchFocus}
                      onClick={() => {
                        if (l.quantity > 1) {
                          update(l.key, { quantity: l.quantity - 1 });
                          refocus();
                        } else remove(l.key);
                      }}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <Input
                      aria-label={t("till.qty")}
                      type="number"
                      min={0.001}
                      step="any"
                      {...draftInput(l, "quantity")}
                      className="h-7 w-20 text-right tabular-nums"
                    />
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label="+1"
                      onMouseDown={keepSearchFocus}
                      onClick={() => {
                        update(l.key, { quantity: l.quantity + 1 });
                        refocus();
                      }}
                    >
                      <Plus className="size-3" />
                    </Button>
                    <span className="text-muted-foreground">× {money(l.unitPrice)}</span>
                    <Label className="ml-auto text-xs text-muted-foreground" htmlFor={`disc-${l.key}`}>{t("till.discount")}</Label>
                    <Input
                      id={`disc-${l.key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      {...draftInput(l, "discountAmount")}
                      className="h-7 w-20 text-right tabular-nums"
                    />
                    {/* P7: another item with the same active ingredient (not on a prescription line:
                        the server ties that line to the prescribed item). */}
                    {!l.prescriptionLineId && !l.nozzleId && catalog.some((c) => c.id === l.itemId && !!c.activeIngredient) && (
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={t("spec.till.subs.action")}
                        title={t("spec.till.subs.action")}
                        onMouseDown={keepSearchFocus}
                        onClick={() => setSubstituteFor(l)}
                      >
                        <ArrowLeftRight className="size-3" />
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" aria-label={t("till.remove")} onMouseDown={keepSearchFocus} onClick={() => remove(l.key)}>
                      <X className="size-3" />
                    </Button>
                  </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t p-4">
          {quoteError && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-col gap-2">
                {quoteError}
                {/* P7: a prescription-only medicine refused without a prescription — pick one. */}
                {!prescription && (
                  <Button size="sm" variant="outline" className="self-start" onMouseDown={keepSearchFocus} onClick={() => setDialog("prescription")}>
                    <Pill className="size-4" /> {t("spec.till.actions.prescription")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {prescription && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="dispensing-prescription">
              <span className="flex flex-wrap items-center gap-2">
                <Pill className="size-4 text-muted-foreground" />
                {t("spec.till.rx.dispensing", { number: prescription.number, patient: prescription.patientName })}
                {prescription.payerName && (
                  <Badge variant="outline">{prescription.payerName} {intl.formatNumber(prescription.coveragePercent)}%</Badge>
                )}
                {isPast(prescription.validUntil) && <Badge variant="destructive">{t("spec.rx.expired")}</Badge>}
              </span>
              <Button size="xs" variant="ghost" aria-label={t("spec.till.rx.drop")} onMouseDown={keepSearchFocus} onClick={dropPrescription}>
                <X className="size-3" />
              </Button>
            </div>
          )}
          {fleetCard && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="till-fleet-card">
              <span className="flex flex-wrap items-center gap-2">
                <CreditCard className="size-4 text-muted-foreground" />
                {t("spec.till.fleet.on", { company: fleetCard.partnerName, plate: fleetCard.vehiclePlate ?? "—" })}
                <span className="tabular-nums text-muted-foreground">
                  {fleetCard.limitPerFill == null ? t("spec.fleet.noLimit") : t("spec.till.fleet.limit", { amount: money(fleetCard.limitPerFill) })}
                </span>
              </span>
              <Button size="xs" variant="ghost" aria-label={t("spec.till.fleet.drop")} onMouseDown={keepSearchFocus} onClick={() => setFleetCard(null)}>
                <X className="size-3" />
              </Button>
            </div>
          )}
          {channelOrder && (
            <div className="flex flex-col gap-1 rounded-md border px-2 py-1.5 text-sm" data-testid="till-channel-order">
              <span className="flex flex-wrap items-center gap-2">
                <ShoppingBag className="size-4 text-muted-foreground" />
                {t("spec.till.online.checkout", { number: channelOrder.number, channel: channelOrder.channelName, customer: channelOrder.customerName })}
                <Badge variant="outline">{t(`spec.online.fulfilment.${channelFulfilmentKey(channelOrder.fulfilment)}`)}</Badge>
                <Badge variant="outline">{t(`spec.online.payment.${channelPaymentKey(channelOrder.payment)}`)}</Badge>
              </span>
              {channelOrder.shippingFee > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums" data-testid="till-shipping">
                  {t("spec.till.online.shipping", { amount: money(channelOrder.shippingFee) })}
                </span>
              )}
              {channelOrder.fulfilment === ChannelFulfilment.Delivery && channelOrder.payment === ChannelPayment.CashOnDelivery && (
                <span className="text-xs text-muted-foreground">
                  {channelOrder.courierName ? t("spec.till.online.cod", { courier: channelOrder.courierName }) : t("spec.till.online.noCourier")}
                </span>
              )}
            </div>
          )}
          {customerOrder && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="collecting-order">
              <span className="flex items-center gap-2">
                <ClipboardList className="size-4 text-muted-foreground" />
                {t("till.customerOrders.collecting", { number: customerOrder.number, customer: customerOrder.customerName })}
              </span>
              <span className="tabular-nums text-muted-foreground">{t("pos.customerOrder.deposited")} {money(customerOrder.deposited)}</span>
            </div>
          )}
          {appointment && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="checkout-appointment">
              <span className="flex items-center gap-2">
                <CalendarCheck className="size-4 text-muted-foreground" />
                {t("svc.till.appointment", {
                  number: appointment.number, customer: appointment.customerName, resource: appointment.resourceName, time: localTime(appointment.start),
                })}
              </span>
              {appointment.deposited > 0 && (
                <span className="tabular-nums text-muted-foreground">{t("svc.appt.deposited")} {money(appointment.deposited)}</span>
              )}
            </div>
          )}
          {repair && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="collecting-repair">
              <span className="flex items-center gap-2">
                <Wrench className="size-4 text-muted-foreground" />
                {t("svc.till.repair", { number: repair.number, customer: repair.customerName, device: repair.device })}
              </span>
            </div>
          )}
          {exchangeCredit && (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="exchange-credit">
              <span className="flex items-center gap-2">
                <Repeat className="size-4 text-muted-foreground" />
                {t("till.exchange.credit", { number: exchangeCredit.reference, amount: money(exchangeCredit.amount) })}
              </span>
              <Button size="xs" variant="ghost" aria-label={t("till.exchange.drop")} onMouseDown={keepSearchFocus} onClick={() => setExchangeCredit(null)}>
                <X className="size-3" />
              </Button>
            </div>
          )}
          {codes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" data-testid="coupon-codes">
              <Ticket className="size-4 text-muted-foreground" />
              {codes.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1">
                  {c}
                  <button
                    type="button"
                    aria-label={t("till.coupon.remove", { code: c })}
                    onMouseDown={keepSearchFocus}
                    onClick={() => {
                      setCodes((all) => all.filter((x) => x !== c));
                      refocus();
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {quoteCurrent && (q?.unknownCodes?.length ?? 0) > 0 && (
            <Alert>
              <AlertDescription>{t("till.coupon.unknown", { codes: (q?.unknownCodes ?? []).join(", ") })}</AlertDescription>
            </Alert>
          )}
          {loyaltyNumber && (
            <div className="flex flex-col gap-1 rounded-md border px-2 py-1.5 text-sm" data-testid="loyalty-card">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <IdCard className="size-4 text-muted-foreground" />
                  {t("till.loyalty.card", { number: loyaltyNumber })}
                  {quoteCurrent && q?.loyaltyCard?.holderName && <span className="text-muted-foreground">· {q.loyaltyCard.holderName}</span>}
                </span>
                <span className="flex items-center gap-1">
                  {quoteCurrent && q?.loyaltyCard && (
                    <span className="tabular-nums text-muted-foreground">{t("till.loyalty.points", { points: intl.formatNumber(q.loyaltyCard.points) })}</span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={t("till.loyalty.remove")}
                    onMouseDown={keepSearchFocus}
                    onClick={() => {
                      setLoyaltyNumber("");
                      setRedeemPoints(0);
                      setRedeemDraft(null);
                      refocus();
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              </div>
              {quoteCurrent && basket.length > 0 && !q?.loyaltyCard && !quoteError && (
                <p className="text-xs text-destructive">{t("till.loyalty.notFound", { number: loyaltyNumber })}</p>
              )}
              <div className="flex items-center gap-2 text-xs">
                <Label htmlFor="till-redeem" className="text-xs text-muted-foreground">{t("till.loyalty.redeem")}</Label>
                <Input
                  id="till-redeem"
                  type="number"
                  min={0}
                  step="any"
                  value={redeemDraft ?? (redeemPoints > 0 ? String(redeemPoints) : "")}
                  onChange={(e) => setRedeemDraft(e.target.value)}
                  onBlur={commitRedeem}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRedeem();
                      refocus();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setRedeemDraft(null);
                    }
                  }}
                  className="h-7 w-24 text-right tabular-nums"
                />
                {quoteCurrent && (q?.pointsRedeemed ?? 0) > 0 && (
                  <span className="ml-auto tabular-nums text-muted-foreground">{t("till.loyalty.redeemed", { points: intl.formatNumber(q?.pointsRedeemed ?? 0) })}</span>
                )}
              </div>
            </div>
          )}
          {quoteCurrent && (q?.programs?.length ?? 0) > 0 && (
            <div className="flex flex-col text-xs text-emerald-700 dark:text-emerald-400" data-testid="applied-programs">
              {q?.programs?.map((p) => (
                <div key={p.programId} className="flex justify-between tabular-nums">
                  <span>{p.name}</span>
                  <span>−{money(p.discount)}</span>
                </div>
              ))}
            </div>
          )}
          {q?.taxes.map((tx) => (
            <div key={tx.taxLetter} className={cn("flex justify-between text-xs text-muted-foreground tabular-nums", !quoteCurrent && "opacity-50")}>
              <span>{t("till.vat")} {tx.taxLetter} {intl.formatNumber(tx.taxRate, { style: "percent", maximumFractionDigits: 2 })}</span>
              <span>{money(tx.tax)}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold">{t("till.total")}</span>
            {/* A previous basket's total stays visible, muted, until this basket's answer is in. */}
            <span className={cn("text-3xl font-bold tabular-nums", basket.length > 0 && !quoteCurrent && "opacity-50")} data-testid="till-total">
              {basket.length === 0 ? money(0) : q ? money(q.total) : "…"}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" disabled={basket.length === 0} onMouseDown={keepSearchFocus} onClick={clear}>{t("till.clear")}</Button>
            <Button className="h-12 text-lg" disabled={!canPay} onClick={() => setDialog("pay")}>
              {t("till.pay")} (F9)
            </Button>
          </div>
        </div>
      </section>

      {dialog === "pay" && q && (
        <PaymentDialog
          boot={boot}
          sessionId={sessionId}
          clientUuid={saleUuid}
          lines={requestLines}
          extras={extras}
          total={q.total}
          customerOrderId={customerOrder?.id}
          appointmentId={appointment?.id}
          repairTicketId={repair?.id}
          offers={[
            ...(customerOrder && customerOrder.deposited > 0 ? [{ reference: customerOrder.depositCardNumber, amount: customerOrder.deposited }] : []),
            ...(appointment?.depositCardNumber && appointment.deposited > 0 ? [{ reference: appointment.depositCardNumber, amount: appointment.deposited }] : []),
            ...(exchangeCredit ? [exchangeCredit] : []),
          ]}
          onClose={() => setDialog(null)}
          onDone={(order) => {
            setDialog(null);
            setBasket([]);
            setDrafts({});
            resetExtras();
            setCustomerOrder(null);
            setExchangeCredit(null);
            setAppointment(null);
            setRepair(null);
            resetSpecialist();
            setSaleUuid(crypto.randomUUID());
            setDone(order);
          }}
        />
      )}
      {prompt?.kind === "age" && (
        <AgePrompt
          item={prompt.request.item}
          onYes={() => proceed({ ...prompt.request, ageVerified: true })}
          onNo={() => {
            setPrompt(null);
            refocus();
          }}
        />
      )}
      {(prompt?.kind === "weight" || prompt?.kind === "price") && (
        <ValuePrompt
          kind={prompt.kind}
          item={prompt.request.item}
          onValue={(value) => proceed(prompt.kind === "weight" ? { ...prompt.request, quantity: value } : { ...prompt.request, unitPrice: value })}
          onCancel={() => {
            setPrompt(null);
            refocus();
          }}
        />
      )}
      {prompt?.kind === "serial" && (
        <SerialPrompt
          item={prompt.request.item}
          taken={basket.flatMap((l) => (l.serial ? [l.serial] : []))}
          onSerial={(serial) => proceed({ ...prompt.request, serial })}
          onCancel={() => {
            setPrompt(null);
            refocus();
          }}
        />
      )}
      {variantPick && (
        <VariantPicker
          title={variantPick.title}
          variants={variantPick.variants}
          onPick={(item) => {
            setVariantPick(null);
            add(item);
          }}
          onClose={() => {
            setVariantPick(null);
            refocus();
          }}
        />
      )}
      {dialog === "warranty" && <WarrantyDialog onClose={() => setDialog(null)} />}
      {dialog === "prescription" && <TillPrescriptionDialog storeId={boot.store.id} onPick={dispense} onClose={() => setDialog(null)} />}
      {dialog === "fleetCard" && (
        <FleetCardDialog
          onClose={() => setDialog(null)}
          onUse={(card) => {
            setFleetCard(card);
            setDialog(null);
          }}
        />
      )}
      {dialog === "parts" && <TillPartsDialog onPick={addPart} onClose={() => setDialog(null)} />}
      {substituteFor && (
        <SubstitutesDialog
          itemId={substituteFor.itemId}
          itemName={substituteFor.description}
          storeId={boot.store.id}
          onPick={(sub) => substitute(substituteFor, sub)}
          onClose={() => {
            setSubstituteFor(null);
            refocus();
          }}
        />
      )}
      {nozzle && (
        <LitresPrompt
          nozzle={nozzle}
          onLitres={(litres) => addFuel(nozzle, litres)}
          onCancel={() => {
            setNozzle(null);
            refocus();
          }}
        />
      )}
      {dialog === "customerOrders" && (
        <TillCustomerOrdersDialog onClose={() => setDialog(null)} onDeposit={addDeposit} onCollect={collect} />
      )}
      {dialog === "coupon" && (
        <CouponCodeDialog
          onClose={() => setDialog(null)}
          onCode={(code) => {
            setCodes((all) => (all.some((c) => c.toUpperCase() === code.toUpperCase()) ? all : [...all, code]));
            setDialog(null);
          }}
        />
      )}
      {dialog === "loyalty" && (
        <LoyaltyCardDialog
          initial={loyaltyNumber}
          onClose={() => setDialog(null)}
          onCard={(number) => {
            if (number !== loyaltyNumber) {
              setRedeemPoints(0);
              setRedeemDraft(null);
            }
            setLoyaltyNumber(number);
            setDialog(null);
          }}
        />
      )}
      {dialog === "giftCard" && (
        <GiftCardSaleDialog
          initialNumber={giftCardPrefill}
          onClose={() => {
            setGiftCardPrefill("");
            setDialog(null);
          }}
          onAdd={(amount, number) => {
            setGiftCardPrefill("");
            addGiftCard(amount, number);
          }}
        />
      )}
      {dialog === "package" && <TillPackageDialog onClose={() => setDialog(null)} onUse={takePackageSession} />}
      {dialog === "membership" && <TillMembershipDialog onClose={() => setDialog(null)} onRenew={renewMembership} />}
      {dialog === "cash" && <CashMovementDialog sessionId={sessionId} onClose={() => setDialog(null)} />}
      {dialog === "return" && (
        <ReturnDialog
          boot={boot}
          sessionId={sessionId}
          uuidFor={(orderId, kind) => {
            // Kept across reopening the dialog, renewed for another coupon or after a recorded one.
            if (returnUuids.current?.orderId !== orderId) returnUuids.current = { orderId, byKind: {} };
            return (returnUuids.current.byKind[kind] ??= crypto.randomUUID());
          }}
          onClose={() => setDialog(null)}
          onDone={(order) => {
            returnUuids.current = null;
            setDialog(null);
            setDone(order);
          }}
          onExchange={(order) => {
            returnUuids.current = null;
            setDialog(null);
            // The store credit the return loaded pays for the next sale (the exchange).
            const card = order.cards?.find((c) => c.kind === GiftCardKind.StoreCredit) ?? order.cards?.[0];
            if (card) setExchangeCredit({ reference: card.number, amount: card.balance });
            setDone(order);
          }}
        />
      )}
      {dialog === "x" && <ReportDialog sessionId={sessionId} onClose={() => setDialog(null)} />}
      {dialog === "close" && <CloseSessionDialog boot={boot} sessionId={sessionId} onClose={() => setDialog(null)} />}
      {done && <DoneDialog boot={boot} order={done} onClose={() => setDone(null)} />}
    </div>
  );
}

// ---- P2 prompts: age check, weight, open price ----

// Enter on the focused Yes confirms, Escape (closing the dialog) is No.
export function AgePrompt({ item, onYes, onNo }: { item: PosCatalogItemResponse; onYes: () => void; onNo: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const age = item.minimumAge ?? 0;
  return (
    <FormDialog open onOpenChange={(open) => !open && onNo()} title={t("till.age.title")} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-2xl font-bold">{t("till.age.question", { age })}</p>
        <p className="text-sm text-muted-foreground">{t("till.age.item", { item: item.name, age })}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-12 min-w-24 text-lg" onClick={onNo}>{t("till.age.no")}</Button>
          <Button className="h-12 min-w-24 text-lg" autoFocus onClick={onYes}>{t("till.age.yes")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// The weight in kg (up to 3 decimals) of an item sold by weight, or the price (up to 2 decimals)
// of an open-price item. What is typed goes on the line as it is: a quantity, or a price the
// cashier entered — the browser works nothing out from it.
export function ValuePrompt({ kind, item, onValue, onCancel }: {
  kind: "weight" | "price";
  item: PosCatalogItemResponse;
  onValue: (value: number) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const weight = kind === "weight";
  const pattern = weight ? /^\d+([.,]\d{1,3})?$/ : /^\d+([.,]\d{1,2})?$/;
  function submit(e: FormEvent) {
    e.preventDefault();
    const typed = value.trim();
    const number = Number(typed.replace(",", "."));
    if (!pattern.test(typed) || !(number > 0)) {
      setInvalid(true);
      return;
    }
    onValue(number);
  }
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t(weight ? "till.weight.title" : "till.openPrice.title", { item: item.name })}
      size="sm"
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Label htmlFor="till-prompt-value">{t(weight ? "till.weight.label" : "till.openPrice.label")}</Label>
        <Input
          id="till-prompt-value"
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          placeholder={weight ? "0.000" : item.price != null ? money(item.price) : "0.00"}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          className="h-12 text-right text-xl tabular-nums"
        />
        {invalid && <p className="text-sm text-destructive">{t(weight ? "till.weight.invalid" : "till.openPrice.invalid")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="submit">{t("till.add")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- P2: coupon codes, loyalty card, gift card sale ----

function CouponCodeDialog({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [code, setCode] = useState("");
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.coupon.title")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onCode(code.trim());
        }}
      >
        <Label htmlFor="till-coupon">{t("till.coupon.code")}</Label>
        <Input id="till-coupon" autoFocus autoComplete="off" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} className="h-12 text-lg" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!code.trim()}>{t("till.coupon.add")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// The card is scanned or typed; its holder and points come back with the next quote. A customer
// without one gets a new card on the spot (Pos: Write).
function LoyaltyCardDialog({ initial, onCard, onClose }: { initial: string; onCard: (number: string) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [number, setNumber] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [holder, setHolder] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      apiClient.createLoyaltyCard(activeCompanyId as string, {
        number: number.trim() || undefined, holderName: holder.trim() || undefined, phone: phone.trim() || undefined, isActive: true,
      }),
    onSuccess: (card) => onCard(card.number),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && !create.isPending && onClose()} title={t("till.loyalty.title")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (creating) create.mutate();
          else if (number.trim()) onCard(number.trim());
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="till-loyalty">{t("till.loyalty.number")}</Label>
        <Input id="till-loyalty" autoFocus autoComplete="off" maxLength={40} value={number} onChange={(e) => setNumber(e.target.value)} className="h-12 text-lg tabular-nums" />
        {creating && (
          <>
            <p className="text-xs text-muted-foreground">{t("pos.loyalty.number.hint")}</p>
            <Label htmlFor="till-loyalty-holder">{t("pos.loyalty.holder")}</Label>
            <Input id="till-loyalty-holder" maxLength={120} value={holder} onChange={(e) => setHolder(e.target.value)} />
            <Label htmlFor="till-loyalty-phone">{t("pos.loyalty.phone")}</Label>
            <Input id="till-loyalty-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {!creating && (
            <Button type="button" variant="outline" className="mr-auto" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("till.loyalty.new")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={create.isPending || (!creating && !number.trim())}>
            {t(creating ? "till.loyalty.create" : "till.loyalty.use")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

// The amount loaded is what the cashier types (up to 2 decimals), never worked out.
function GiftCardSaleDialog({ initialNumber = "", onAdd, onClose }: {
  /** P4: an appointment's deposit card, from ?giftCard=. */
  initialNumber?: string;
  onAdd: (amount: number, number: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [amount, setAmount] = useState("");
  const [number, setNumber] = useState(initialNumber);
  const [invalid, setInvalid] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const typed = amount.trim();
    const value = Number(typed.replace(",", "."));
    if (!/^\d+([.,]\d{1,2})?$/.test(typed) || !(value > 0)) {
      setInvalid(true);
      return;
    }
    onAdd(value, number.trim());
  }
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.giftCard.title")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Label htmlFor="till-gift-amount">{t("till.giftCard.amount")}</Label>
        <Input
          id="till-gift-amount"
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setAmount(e.target.value);
            setInvalid(false);
          }}
          className="h-12 text-right text-xl tabular-nums"
        />
        {invalid && <p className="text-sm text-destructive">{t("till.giftCard.invalid")}</p>}
        <Label htmlFor="till-gift-number">{t("till.giftCard.number")}</Label>
        <Input id="till-gift-number" autoComplete="off" maxLength={40} value={number} onChange={(e) => setNumber(e.target.value)} className="tabular-nums" />
        <p className="text-xs text-muted-foreground">{t("till.giftCard.number.hint")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit">{t("till.add")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Payment ----

interface Tender {
  methodId: string;
  name: string;
  amount: number;
  tendered?: number;
  /** P2: the gift card a GiftCard-kind tender spends. */
  reference?: string;
  /** P3: a tip on top of the amount (cash: the cash given covers both; the server works out the change). */
  tip?: number;
  /** P7: an on-account tender charged to a partner other than the customer (payer, fleet company, courier). */
  partnerId?: string;
}

export function PaymentDialog({
  boot, sessionId, clientUuid, lines, extras, total, customerOrderId, offers = [], tabId, allowTip = false, appointmentId, repairTicketId, onClose, onDone,
}: {
  boot: PosBootstrapResponse;
  sessionId: string;
  /** The sale's ClientUuid, owned by the till so it survives this dialog (D11). */
  clientUuid: string;
  lines: PosOrderLineRequest[];
  /** P2: coupon codes, loyalty card and points — priced again with the tenders, and recorded. */
  extras: SaleExtras;
  total: number;
  /** P2: the customer order this sale collects. */
  customerOrderId?: string;
  /** P2: gift-card tenders offered up front (the order's deposit, exchange credit), as the server gave them. */
  offers?: OfferedTender[];
  /** P3: the tab these lines pay (lines carry tabLineId; the server prices them from the tab). */
  tabId?: string;
  /** P3: offer a tip on the tender (restaurants). */
  allowTip?: boolean;
  /** P4: the appointment this sale checks out, or the repair it collects. */
  appointmentId?: string;
  repairTicketId?: string;
  onClose: () => void;
  onDone: (order: PosOrderResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const tenders = counterTenders(boot.tenders);
  const giftCardTender = tenders.find((x) => x.kind === PaymentMethodKind.GiftCard);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [methodId, setMethodId] = useState(tenders.find((x) => x.kind === PaymentMethodKind.Cash)?.id ?? tenders[0]?.id ?? "");
  const [entered, setEntered] = useState("");
  const [error, setError] = useState<string | null>(null);
  // P2: the gift card a GiftCard tender spends, and the number whose balance was asked for.
  const [cardNumber, setCardNumber] = useState("");
  const [checkedNumber, setCheckedNumber] = useState<string | null>(null);
  // P3: the tip typed for the next tender — a figure the customer gives, never worked out.
  const [tipDraft, setTipDraft] = useState("");

  const paymentRequests: PosPaymentRequest[] = payments.map((p) => ({
    paymentMethodId: p.methodId, amount: p.amount, tendered: p.tendered, ...(p.reference ? { reference: p.reference } : {}),
    ...(p.tip ? { tip: p.tip } : {}),
    ...(p.partnerId ? { partnerId: p.partnerId } : {}),
  }));
  const tabPart = tabId ? { tabId } : {};
  const quote = useQuery({
    queryKey: ["posQuote", companyId, boot.register.id, lines, paymentRequests, extras, tabId],
    queryFn: () => apiClient.quotePosBasket(companyId, boot.register.id, { lines, payments: paymentRequests, ...extras, ...tabPart }),
    placeholderData: keepPreviousData,
  });
  // The dialog's own quote is the figure to show once it is in; the till's is only a first guess.
  const due = quote.data?.total ?? total;
  const remaining = quote.data?.remaining ?? total;
  // While the answer for the current tenders is on its way, "remaining" is the previous one's:
  // adding against it would take the full remaining amount twice.
  const quoteBusy = !quote.data || quote.isFetching || quote.isPlaceholderData;
  const method = tenders.find((x) => x.id === methodId);
  const isCash = method?.kind === PaymentMethodKind.Cash;
  const isGiftCard = method?.kind === PaymentMethodKind.GiftCard;
  // The balance is shown to the cashier only; the server checks it when the sale is recorded.
  const giftCard = useQuery({
    queryKey: ["posGiftCard", companyId, checkedNumber],
    queryFn: () => apiClient.getGiftCard(companyId, checkedNumber as string),
    enabled: isGiftCard && !!checkedNumber,
    retry: false,
  });

  function addTender(value: number) {
    if (quoteBusy || !method || !(value > 0) || remaining <= 0) return;
    if (isGiftCard && !cardNumber.trim()) {
      setError(t("till.pay.giftCardRequired"));
      return;
    }
    const tipTyped = tipDraft.trim();
    const tip = tipTyped === "" ? 0 : Number(tipTyped.replace(",", "."));
    if (tipTyped !== "" && (!/^\d+([.,]\d{1,2})?$/.test(tipTyped) || !(tip >= 0))) {
      setError(t("rest.pay.tipInvalid"));
      return;
    }
    // Cash with a tip: the cash given has to cover what is due and the tip, so the tip rides on the
    // cash that settles the bill (a comparison only — the server checks the sum and gives change).
    if (tip > 0 && isCash && !(value > remaining)) {
      setError(t("rest.pay.tipCash"));
      return;
    }
    setError(null);
    // Cash beyond what is due is handed over and comes back as change; the server works it out.
    const tender: Tender = isCash && value > remaining
      ? { methodId: method.id, name: method.name, amount: remaining, tendered: value }
      : { methodId: method.id, name: method.name, amount: value > remaining ? remaining : value, tendered: isCash ? value : undefined };
    if (isGiftCard) {
      tender.reference = cardNumber.trim();
      tender.name = `${method.name} ${tender.reference}`;
    }
    if (tip > 0) tender.tip = tip;
    setPayments((p) => [...p, tender]);
    setEntered("");
    setTipDraft("");
    if (isGiftCard) {
      setCardNumber("");
      setCheckedNumber(null);
    }
  }

  // P2: an offered card pays up to what is still due — its own figure or the remaining one,
  // whichever is smaller (a comparison, nothing added up).
  function applyOffer(offer: OfferedTender) {
    if (quoteBusy || !giftCardTender || remaining <= 0) return;
    setError(null);
    setPayments((p) => [
      ...p,
      {
        methodId: giftCardTender.id, name: `${giftCardTender.name} ${offer.reference}`, amount: offer.amount > remaining ? remaining : offer.amount,
        reference: offer.reference,
      },
    ]);
  }
  const openOffers = offers.filter((o) => o.amount > 0 && !payments.some((p) => p.reference === o.reference));

  // P7: who else may be charged on account and the most each may take — the payer's share of the
  // prescription, the fleet card's company, the courier of a cash-on-delivery order. The figure is
  // the server's; the tender takes it, or what is still due if that is less (a comparison only).
  const onAccountTender = boot.tenders.find((x) => x.kind === PaymentMethodKind.OnAccount);
  const partnerOffers = (quote.data?.tenderPartners ?? []).filter((tp) => !payments.some((p) => p.partnerId === tp.partnerId) && tp.max !== 0);
  function chargePartner(tp: PosTenderPartnerResponse) {
    if (quoteBusy || !onAccountTender || remaining <= 0) return;
    setError(null);
    const amount = tp.max != null && tp.max < remaining ? tp.max : remaining;
    setPayments((p) => [...p, { methodId: onAccountTender.id, name: t("spec.pay.onAccount", { name: tp.name }), amount, partnerId: tp.partnerId }]);
  }

  const submit = useMutation({
    mutationFn: () =>
      apiClient.submitPosOrder(companyId, {
        clientUuid, sessionId, kind: PosOrderKind.Sale, orderedAt: new Date().toISOString(), lines, payments: paymentRequests, createdOffline: false,
        ...extras,
        ...(customerOrderId ? { customerOrderId } : {}),
        ...(appointmentId ? { appointmentId } : {}),
        ...(repairTicketId ? { repairTicketId } : {}),
        ...tabPart,
      }),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("till.saleError"))),
  });

  // P4: sessions from packages are paid by the packages, so a sale of only those needs no tender.
  const settled = quote.data != null && quote.data.remaining === 0 && (payments.length > 0 || lines.some((l) => !!l.packageNumber)) && !quoteBusy;

  return (
    <FormDialog open onOpenChange={(open) => !open && !submit.isPending && onClose()} title={t("till.pay.title")}>
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {payments.some((p) => p.tip) && !quoteBusy && remaining > 0 && (
          <p className="text-sm text-muted-foreground">{t("rest.pay.tipShort")}</p>
        )}
        {quote.data?.cashLimitExceeded && (
          <Alert variant="destructive">
            <AlertDescription>{t("till.pay.cashLimit")}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
          <Figure label={t("till.pay.due")} value={money(due)} />
          <Figure label={t("till.pay.remaining")} value={money(remaining)} strong={remaining > 0} />
          <Figure label={t("till.pay.change")} value={money(quote.data?.change)} strong={(quote.data?.change ?? 0) > 0} />
        </div>
        {giftCardTender && openOffers.map((o) => (
          <div key={o.reference} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" data-testid="offered-tender">
            <span className="tabular-nums">{t("till.pay.offer", { number: o.reference, amount: money(o.amount) })}</span>
            <Button type="button" size="sm" disabled={quoteBusy || remaining <= 0} onClick={() => applyOffer(o)}>
              {t("till.pay.offer.use")}
            </Button>
          </div>
        ))}
        {partnerOffers.map((tp) => (
          <div key={tp.partnerId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" data-testid="partner-tender">
            <span className="tabular-nums">
              {tp.max != null ? t("spec.pay.partnerPays", { name: tp.name, amount: money(tp.max) }) : t("spec.pay.partnerPaysRest", { name: tp.name })}
            </span>
            {onAccountTender ? (
              <Button type="button" size="sm" disabled={quoteBusy || remaining <= 0} onClick={() => chargePartner(tp)}>
                {t("spec.pay.charge")}
              </Button>
            ) : (
              <span className="text-xs text-destructive">{t("spec.pay.noOnAccount")}</span>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {tenders.map((x) => (
            <Button key={x.id} type="button" variant={x.id === methodId ? "default" : "outline"} onClick={() => setMethodId(x.id)}>
              {x.name}
            </Button>
          ))}
        </div>
        {isGiftCard && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="pay-card">{t("till.pay.giftCard")}</Label>
            <div className="flex gap-2">
              <Input
                id="pay-card"
                autoComplete="off"
                maxLength={40}
                value={cardNumber}
                onChange={(e) => {
                  setCardNumber(e.target.value);
                  setCheckedNumber(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (cardNumber.trim()) setCheckedNumber(cardNumber.trim());
                  }
                }}
                className="tabular-nums"
              />
              <Button type="button" variant="outline" disabled={!cardNumber.trim()} onClick={() => setCheckedNumber(cardNumber.trim())}>
                {t("till.pay.checkBalance")}
              </Button>
            </div>
            {checkedNumber && giftCard.data && (
              <p className="text-sm tabular-nums" data-testid="gift-card-balance">
                {t("till.pay.balance", {
                  kind: t(`pos.giftCard.kind.${giftCardKindKey(giftCard.data.kind)}`), number: giftCard.data.number, amount: money(giftCard.data.balance),
                })}
              </p>
            )}
            {checkedNumber && giftCard.error && <p className="text-sm text-destructive">{t("till.pay.giftCardNotFound")}</p>}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            addTender(entered === "" ? remaining : Number(entered));
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="pay-amount">{t(isCash ? "till.pay.tendered" : "till.pay.amount")}</Label>
            <Input
              id="pay-amount"
              type="number"
              min={0}
              step="0.01"
              autoFocus
              placeholder={money(remaining)}
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              className="h-12 text-right text-xl tabular-nums"
              disabled={remaining <= 0}
            />
          </div>
          <Button type="button" variant="outline" className="h-12" disabled={remaining <= 0 || quoteBusy} onClick={() => addTender(remaining)}>
            {t("till.pay.exact")}
          </Button>
          <Button type="submit" className="h-12" disabled={remaining <= 0 || quoteBusy}>{t("till.pay.add")}</Button>
        </form>
        {allowTip && remaining > 0 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="pay-tip" className="text-sm">{t("rest.pay.tip")}</Label>
            <Input
              id="pay-tip"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={tipDraft}
              onChange={(e) => setTipDraft(e.target.value)}
              className="h-9 w-28 text-right tabular-nums"
            />
            <span className="text-xs text-muted-foreground">{t("rest.pay.tip.hint")}</span>
          </div>
        )}
        {payments.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {payments.map((p, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-1.5 tabular-nums">
                <span>{p.name}</span>
                <span className="flex items-center gap-2">
                  {p.tendered != null && p.tendered !== p.amount && <span className="text-muted-foreground">{money(p.tendered)} →</span>}
                  {money(p.amount)}
                  {p.tip ? <span className="text-muted-foreground" data-testid="tender-tip">{t("rest.pay.tipOn", { amount: money(p.tip) })}</span> : null}
                  {/* Later tenders were sized against what was left after this one (a cash tender's
                      amount is frozen while the quote counts what was handed over), so they go too
                      and are re-entered against the server's new remaining. */}
                  <Button size="xs" variant="ghost" aria-label={t("till.remove")} onClick={() => setPayments((all) => all.slice(0, i))}>
                    <X className="size-3" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>{t("common.cancel")}</Button>
          <Button
            className="h-12 text-lg"
            disabled={!settled || submit.isPending || quote.data?.cashLimitExceeded}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
          >
            {t("till.pay.confirm")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl", strong && "font-bold")}>{value}</div>
    </div>
  );
}

// ---- After the sale ----

export function DoneDialog({ boot, order, onClose }: { boot: PosBootstrapResponse; order: PosOrderResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.done")} size="sm">
      <div className="flex flex-col gap-3">
        {order.change > 0 && <p className="text-center text-2xl font-bold tabular-nums">{t("till.changeDue", { amount: money(order.change) })}</p>}
        {/* P4: packages issued or used, memberships started or renewed — the numbers the customer keeps. */}
        {order.lines.some((l) => l.packageNumber || l.membershipNumber) && (
          <ul className="flex flex-col gap-1 rounded-md border p-2 text-sm" data-testid="done-services">
            {order.lines.filter((l) => l.packageNumber || l.membershipNumber).map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span>{l.description}</span>
                <span className="font-semibold tabular-nums">
                  {l.packageNumber ? t("svc.till.packageBadge", { number: l.packageNumber }) : t("svc.till.membershipNumber", { number: l.membershipNumber ?? "" })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="max-h-[50vh] overflow-y-auto rounded border">
          <CouponReceipt
            ref={ref}
            order={order}
            store={boot.store}
            register={boot.register}
            issuer={{ companyName: boot.companyName, fiscalNumber: boot.fiscalNumber, vatNumber: boot.vatNumber }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => printCoupon(ref.current)}>
            <Printer className="size-4" /> {t("till.print")}
          </Button>
          <Button autoFocus onClick={onClose}>{t("till.newSale")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// ---- Cash in / out ----

export function CashMovementDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const accounts = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => apiClient.accountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];
  const [kind, setKind] = useState("4");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiClient.addPosCashMovement(activeCompanyId as string, sessionId, {
        kind: Number(kind), amount: Number(amount), reason: reason.trim(), counterpartAccountId: accountId,
      }),
    onSuccess: onClose,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.cash.title")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Label htmlFor="cm-kind">{t("till.cash.kind")}</Label>
        <Select
          id="cm-kind"
          value={kind}
          onValueChange={setKind}
          options={CASH_MOVEMENT_KINDS.map((k) => ({ value: String(k), label: t(`till.cash.kind.${cashMovementKindKey(k)}`) }))}
        />
        <Label htmlFor="cm-amount">{t("common.amount")}</Label>
        <Input id="cm-amount" type="number" min={0.01} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" />
        <Label htmlFor="cm-account">{t("till.cash.account")}</Label>
        <SearchableSelect id="cm-account" value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        <Label htmlFor="cm-reason">{t("till.cash.reason")}</Label>
        <Input id="cm-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !accountId}>{t("till.cash.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Returns and cancellations ----

function ReturnDialog({ boot, sessionId, uuidFor, onClose, onDone, onExchange }: {
  boot: PosBootstrapResponse;
  sessionId: string;
  /** The ClientUuid for this action on this original order, owned by the till (D11). */
  uuidFor: (originalOrderId: string, kind: number) => string;
  onClose: () => void;
  onDone: (order: PosOrderResponse) => void;
  /** P2: the goods came back to be exchanged — the refund is store credit for the next sale. */
  onExchange: (order: PosOrderResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const tenders = counterTenders(boot.tenders);
  const giftCardTender = tenders.find((x) => x.kind === PaymentMethodKind.GiftCard);
  const [lookup, setLookup] = useState("");
  const [original, setOriginal] = useState<PosOrderResponse | null>(null);
  const [choices, setChoices] = useState<PosOrderSummaryResponse[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [methodId, setMethodId] = useState(tenders.find((x) => x.kind === PaymentMethodKind.Cash)?.id ?? tenders[0]?.id ?? "");
  // P2: a refund to a gift-card tender loads store credit — a new card, or this one.
  const [cardNumber, setCardNumber] = useState("");
  const refundToCard = tenders.find((x) => x.id === methodId)?.kind === PaymentMethodKind.GiftCard;
  const [error, setError] = useState<string | null>(null);

  // The search is a partial match: an exact order number or coupon id wins, a single sale is
  // taken, and several are offered to the cashier rather than silently taking the first.
  const find = useMutation({
    mutationFn: async (pickedId?: string): Promise<PosOrderResponse | PosOrderSummaryResponse[]> => {
      if (pickedId) return apiClient.getPosOrder(companyId, pickedId);
      const term = lookup.trim();
      const page = await apiClient.listPosOrders(companyId, undefined, term, 1, 10);
      const sales = page.items.filter((o) => o.kind === PosOrderKind.Sale);
      const exact = sales.find((o) => o.number.toLowerCase() === term.toLowerCase() || (o.couponId != null && String(o.couponId) === term));
      if (exact) return apiClient.getPosOrder(companyId, exact.id);
      if (sales.length === 0) throw new Error(t("till.return.notFound"));
      if (sales.length === 1) return apiClient.getPosOrder(companyId, sales[0].id);
      return sales;
    },
    onSuccess: (result) => {
      setError(null);
      if (Array.isArray(result)) {
        setChoices(result);
        setOriginal(null);
        return;
      }
      setChoices(null);
      setOriginal(result);
      setQuantities({});
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("till.return.notFound"))),
  });

  const returnLines: PosOrderLineRequest[] = (original?.lines ?? [])
    .filter((l) => (quantities[l.id] ?? 0) > 0)
    .map((l) => ({ itemId: l.itemId, description: l.description, quantity: quantities[l.id], unitPrice: l.unitPrice, taxDefinitionId: undefined, originalLineId: l.id, discountAmount: 0 }));
  const refund = useQuery({
    queryKey: ["posReturnQuote", companyId, original?.id, returnLines],
    queryFn: () => apiClient.quotePosBasket(companyId, boot.register.id, { lines: returnLines, originalOrderId: original?.id }),
    enabled: !!original && returnLines.length > 0,
  });

  const submit = useMutation({
    mutationFn: (kind: number) => {
      const total = kind === PosOrderKind.Cancel ? (original as PosOrderResponse).total : (refund.data?.total ?? 0);
      return apiClient.submitPosOrder(companyId, {
        clientUuid: uuidFor((original as PosOrderResponse).id, kind), sessionId, kind, orderedAt: new Date().toISOString(),
        lines: kind === PosOrderKind.Cancel ? [] : returnLines,
        payments: [{ paymentMethodId: methodId, amount: total, ...(refundToCard && cardNumber.trim() ? { reference: cardNumber.trim() } : {}) }],
        originalOrderId: original?.id, reason: reason.trim(), createdOffline: false,
      });
    },
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("till.saleError"))),
  });
  // P2 exchange: the return is refunded as new store credit (gift-card tender, no card number:
  // the server issues one), which then pays for what the customer takes instead.
  const exchange = useMutation({
    mutationFn: () =>
      apiClient.submitPosOrder(companyId, {
        clientUuid: uuidFor((original as PosOrderResponse).id, PosOrderKind.Return), sessionId, kind: PosOrderKind.Return,
        orderedAt: new Date().toISOString(), lines: returnLines,
        payments: [{ paymentMethodId: (giftCardTender as PosTenderResponse).id, amount: refund.data?.total ?? 0 }],
        originalOrderId: original?.id, reason: reason.trim(), createdOffline: false,
      }),
    onSuccess: onExchange,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("till.saleError"))),
  });

  const untouched = original?.lines.every((l) => l.returnable === l.quantity) ?? false;

  return (
    <FormDialog open onOpenChange={(open) => !open && !submit.isPending && onClose()} title={t("till.return.title")} size="lg">
      <div className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) find.mutate(undefined);
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="ret-lookup">{t("till.return.lookup")}</Label>
            <Input id="ret-lookup" autoFocus value={lookup} onChange={(e) => setLookup(e.target.value)} />
          </div>
          <Button type="submit" disabled={find.isPending}>{t("till.return.find")}</Button>
        </form>
        {choices && (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{t("till.return.pick")}</p>
            <ul className="divide-y rounded-md border text-sm">
              {choices.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 px-3 py-1.5 text-left hover:bg-accent"
                    disabled={find.isPending}
                    onClick={() => find.mutate(o.id)}
                  >
                    <span>
                      {o.number}
                      {o.couponId != null && ` · ${t("coupon.id")} ${o.couponId}`}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {intl.formatDate(o.orderedAt)} {intl.formatTime(o.orderedAt)} · {money(o.total)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {original && (
          <>
            <p className="text-sm text-muted-foreground">
              {original.number} · {intl.formatDate(original.orderedAt)} {intl.formatTime(original.orderedAt)} · {money(original.total)}
              {original.fiscal && ` · ${t("coupon.id")} ${original.fiscal.couponId}`}
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {original.lines.map((l) => (
                <li key={l.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-1.5">
                  <span>{l.description}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {intl.formatNumber(l.returnable ?? 0)} / {intl.formatNumber(l.quantity)} · {money(l.gross)}
                  </span>
                  <Input
                    aria-label={t("till.return.qty")}
                    type="number"
                    min={0}
                    max={l.returnable ?? 0}
                    step="any"
                    disabled={!l.returnable}
                    value={quantities[l.id] ?? 0}
                    onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: Math.max(0, Number(e.target.value) || 0) }))}
                    className="h-7 w-20 text-right tabular-nums"
                  />
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="ret-reason">{t("till.return.reason")}</Label>
                <Input id="ret-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ret-tender">{t("till.return.refundBy")}</Label>
                <Select id="ret-tender" value={methodId} onValueChange={setMethodId} options={tenders.map((x) => ({ value: x.id, label: x.name }))} />
              </div>
            </div>
            {refundToCard && (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">{t("till.return.storeCredit")}</p>
                <Label htmlFor="ret-card">{t("till.return.cardNumber")}</Label>
                <Input id="ret-card" autoComplete="off" maxLength={40} value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="tabular-nums" />
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{t("till.total")}</span>
              <span className="text-2xl font-bold tabular-nums">{returnLines.length === 0 ? money(0) : refund.data ? money(refund.data.total) : "…"}</span>
            </div>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>{t("common.cancel")}</Button>
          {original && untouched && (
            <Button variant="destructive" disabled={!reason.trim() || submit.isPending} onClick={() => submit.mutate(PosOrderKind.Cancel)}>
              {t("till.return.cancelAll")}
            </Button>
          )}
          {original && giftCardTender && (
            <Button
              variant="outline"
              title={t("till.exchange.hint")}
              disabled={!reason.trim() || returnLines.length === 0 || !refund.data || refund.isFetching || submit.isPending || exchange.isPending}
              onClick={() => {
                setError(null);
                exchange.mutate();
              }}
            >
              <Repeat className="size-4" /> {t("till.exchange")}
            </Button>
          )}
          {original && (
            <Button
              disabled={!reason.trim() || returnLines.length === 0 || !refund.data || refund.isFetching || submit.isPending || exchange.isPending}
              onClick={() => submit.mutate(PosOrderKind.Return)}
            >
              {t("till.return.confirm")}
            </Button>
          )}
        </div>
      </div>
    </FormDialog>
  );
}

// ---- X report and closing ----

export function SessionReportView({ report }: { report: SessionReportResponse }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const row = (label: string, value: string, strong = false) => (
    <div className={cn("flex justify-between tabular-nums", strong && "font-semibold")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {report.registerCode} · {t("pos.session.number")} {report.number} · {intl.formatDate(report.businessDate)}
      </p>
      {row(t("till.report.sales"), String(report.sales))}
      {row(t("till.report.returns"), String(report.returns))}
      {row(t("till.report.cancellations"), String(report.cancellations))}
      <hr />
      {row(t("till.report.gross"), money(report.grossSales))}
      {row(t("till.report.refunds"), money(report.refunds))}
      {row(t("till.report.net"), money(report.netSales), true)}
      <hr />
      <p className="font-medium">{t("till.report.byTax")}</p>
      {report.taxes.map((x) => row(`${x.taxLetter} ${intl.formatNumber(x.taxRate, { style: "percent", maximumFractionDigits: 2 })}`, `${money(x.net)} + ${money(x.tax)} = ${money(x.gross)}`))}
      <hr />
      <p className="font-medium">{t("till.report.byTender")}</p>
      {report.tenders.map((x) => (
        <div key={x.paymentMethodId} className="flex justify-between tabular-nums">
          <span>{x.name}</span>
          <span>
            {money(x.expected)}
            {x.counted != null && ` / ${money(x.counted)}`}
            {x.difference != null && x.difference !== 0 && <span className="text-destructive"> ({money(x.difference)})</span>}
          </span>
        </div>
      ))}
      <hr />
      {row(t("till.report.cashExpected"), money(report.cashExpected), true)}
      {report.firstCouponId != null && <p className="text-muted-foreground">{t("till.report.coupons", { first: report.firstCouponId, last: report.lastCouponId ?? "" })}</p>}
      {report.pendingFiscal > 0 && <p className="text-destructive">{t("till.report.pendingFiscal", { count: report.pendingFiscal })}</p>}
    </div>
  );
}

export function ReportDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const ref = useRef<HTMLDivElement>(null);
  const report = useQuery({
    queryKey: ["posReport", activeCompanyId, sessionId],
    queryFn: () => apiClient.getPosSessionReport(activeCompanyId as string, sessionId),
  });
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("till.report.x")} size="sm">
      <div ref={ref}>{report.data ? <SessionReportView report={report.data} /> : <p className="text-muted-foreground">{t("common.loading")}</p>}</div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => printCoupon(ref.current)}>
          <Printer className="size-4" /> {t("common.print")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </FormDialog>
  );
}

export function CloseSessionDialog({ boot, sessionId, onClose }: { boot: PosBootstrapResponse; sessionId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // Its own cache entry, never kept: the expected figures must be fetched as the drawer is
  // counted, not reused from an X report printed an hour ago.
  const report = useQuery({
    queryKey: ["posReport", activeCompanyId, sessionId, "close"],
    queryFn: () => apiClient.getPosSessionReport(activeCompanyId as string, sessionId),
    staleTime: 0,
    gcTime: 0,
  });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [z, setZ] = useState<SessionReportResponse | null>(null);
  const close = useMutation({
    mutationFn: () =>
      apiClient.closePosSession(activeCompanyId as string, sessionId, {
        counted: (report.data?.tenders ?? []).map((x) => ({
          paymentMethodId: x.paymentMethodId,
          counted: Number(counted[x.paymentMethodId] ?? x.expected),
          differenceReason: reasons[x.paymentMethodId]?.trim() || undefined,
        })),
      }),
    onSuccess: (zReport) => setZ(zReport),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  // An empty or unreadable count is not sent as zero; the cashier has to enter something.
  const countValue = (paymentMethodId: string, expected: number) => counted[paymentMethodId] ?? String(expected);
  const invalidCount = (report.data?.tenders ?? []).some((x) => {
    const value = countValue(x.paymentMethodId, x.expected);
    return value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0;
  });

  async function finish() {
    await queryClient.invalidateQueries({ queryKey: ["posBootstrap", activeCompanyId, boot.register.id] });
    await queryClient.invalidateQueries({ queryKey: ["posRegisters", activeCompanyId] });
    navigate("/pos");
  }

  if (z)
    return (
      <FormDialog open onOpenChange={(open) => !open && finish()} title={t("till.report.z")} size="sm">
        <div ref={ref}>
          <SessionReportView report={z} />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => printCoupon(ref.current)}>
            <Printer className="size-4" /> {t("common.print")}
          </Button>
          <Button onClick={finish}>{t("common.close")}</Button>
        </div>
      </FormDialog>
    );

  return (
    <FormDialog open onOpenChange={(open) => !open && !close.isPending && onClose()} title={t("till.close.title")} description={t("till.close.description")}>
      <div className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!report.data && <p className="text-muted-foreground">{t("common.loading")}</p>}
        {/* P3: each waiter's cash bag is handed over before the drawer is counted. */}
        <WaiterHandover sessionId={sessionId} />
        {report.data?.tenders.map((x) => {
          const value = countValue(x.paymentMethodId, x.expected);
          // Differences are worked out by the server on close; here a mismatch only asks for a reason.
          // An empty box is not a difference but a missing count, which keeps Close disabled.
          const empty = value.trim() === "";
          const differs = !empty && Number(value) !== x.expected;
          return (
            <div key={x.paymentMethodId} className="grid grid-cols-[1fr_7rem_8rem] items-center gap-3 text-sm">
              <span className="font-medium">{x.name}</span>
              <span className="text-right tabular-nums text-muted-foreground">
                {t("till.close.expected")} {money(x.expected)}
              </span>
              <Input
                aria-label={`${t("till.close.counted")} ${x.name}`}
                type="number"
                step="0.01"
                min={0}
                value={value}
                aria-invalid={empty || undefined}
                onChange={(e) => setCounted((c) => ({ ...c, [x.paymentMethodId]: e.target.value }))}
                className="text-right tabular-nums"
              />
              {differs && (
                <Input
                  className="col-span-3"
                  aria-label={t("till.close.reason")}
                  placeholder={t("till.close.reason")}
                  value={reasons[x.paymentMethodId] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [x.paymentMethodId]: e.target.value }))}
                />
              )}
            </div>
          );
        })}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={close.isPending}>{t("common.cancel")}</Button>
          <Button
            disabled={!report.data || report.isFetching || invalidCount || close.isPending}
            onClick={() => {
              setError(null);
              close.mutate();
            }}
          >
            {t("till.close.confirm")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
