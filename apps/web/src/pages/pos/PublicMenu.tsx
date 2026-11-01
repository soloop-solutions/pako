import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiException, type ModifierGroupResponse, type PublicMenuItemResponse } from "@pako/shared";
import { CheckCircle2, Minus, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { useIntl } from "react-intl";
import { useParams } from "react-router-dom";

// The generated client works without a signed-in user: authorizedFetch only adds a bearer token
// when one is stored (a staff member who scans a code just sends theirs along, which the anonymous
// endpoint ignores), and it signals an expired session only when there was one. So the public
// menu uses apiClient like every other screen — no raw fetch.
import { apiClient, getApiErrorMessage } from "@/api/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/payroll-enums";

interface BasketLine {
  key: string;
  itemId: string;
  quantity: number;
  modifierIds: string[];
  note: string;
}

// A modifier's price change as the server sends it, signed; never added up here.
const delta = (v: number) => (v > 0 ? `+${formatAmount(v)} €` : v < 0 ? `${formatAmount(v)} €` : "");
const isNotFound = (err: unknown) => err instanceof ApiException && err.status === 404;
// The server takes at most 30 lines of at most 20 each.
const MAX_LINES = 30;
const MAX_QTY = 20;

let seq = 0;
const nextKey = () => `b${++seq}`;

// docs/POS_PLAN.md §6.2 / P3: the menu a guest opens from the QR code on a table — anonymous,
// outside the app shell, mobile first. Prices are the store's, from the server; the basket shows
// them per item and never adds them up. What the guest sends waits on the tab for a waiter.
export function PublicMenu() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { token = "" } = useParams();
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [note, setNote] = useState("");
  const [choosing, setChoosing] = useState<PublicMenuItemResponse | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [gone, setGone] = useState(false);

  const menu = useQuery({
    queryKey: ["publicMenu", token],
    queryFn: () => apiClient.getPublicMenu(token),
    enabled: !!token,
    retry: false,
  });
  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const groups = useMemo(() => menu.data?.modifierGroups ?? [], [menu.data]);
  const groupsFor = (itemId: string) => groups.filter((g) => g.itemIds.includes(itemId) && g.modifiers.length > 0);
  const modifierName = (id: string) => groups.flatMap((g) => g.modifiers).find((m) => m.id === id);

  // Items by category, in the server's order; uncategorised last.
  const sections = useMemo(() => {
    const map = new Map<string, PublicMenuItemResponse[]>();
    for (const item of items) {
      const key = item.categoryName ?? "";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  }, [items]);

  const order = useMutation({
    mutationFn: () =>
      apiClient.placePublicOrder(token, {
        lines: basket.map((l) => ({ itemId: l.itemId, quantity: l.quantity, modifierIds: l.modifierIds, note: l.note.trim() || undefined })),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setSent(true);
      setBasket([]);
      setNote("");
      setBasketOpen(false);
    },
    onError: (err: unknown) => {
      if (isNotFound(err)) setGone(true);
    },
  });

  function add(item: PublicMenuItemResponse, modifierIds: string[] = []) {
    setSent(false);
    setBasket((all) => {
      const same = all.find((l) => l.itemId === item.id && !l.note && l.modifierIds.join(",") === [...modifierIds].sort().join(","));
      if (same) return all.map((l) => (l === same ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l));
      if (all.length >= MAX_LINES) return all;
      return [...all, { key: nextKey(), itemId: item.id, quantity: 1, modifierIds: [...modifierIds].sort(), note: "" }];
    });
  }
  const setQuantity = (key: string, quantity: number) =>
    setBasket((all) => (quantity <= 0 ? all.filter((l) => l.key !== key) : all.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))));

  const count = basket.reduce((n, l) => n + l.quantity, 0);

  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pb-28 pt-4">{children}</div>
    </div>
  );

  if (gone || isNotFound(menu.error)) {
    return shell(
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="self-end"><LanguageSwitcher /></div>
        <h1 className="text-xl font-semibold">{t("pos.setup3.public.invalid.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pos.setup3.public.invalid")}</p>
      </div>,
    );
  }
  if (menu.error) {
    return shell(
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(menu.error, t("pos.setup3.public.loadError"))}</AlertDescription>
      </Alert>,
    );
  }
  if (menu.isPending) return shell(<p className="py-16 text-center text-sm text-muted-foreground">{t("pos.setup3.public.loading")}</p>);
  const data = menu.data;

  return shell(
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{data.storeName}</h1>
          <p className="text-sm text-muted-foreground">{t("pos.setup3.public.table", { name: data.tableName })}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {sent && (
        <div className="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" />
          <div>
            <p className="font-medium">{t("pos.setup3.public.sent.title")}</p>
            <p>{t("pos.setup3.public.sent")}</p>
          </div>
        </div>
      )}

      {sections.length > 1 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label={t("pos.setup3.public.categories")}>
          {sections.map(([name], i) => (
            <a key={name || "_"} href={`#cat-${i}`} className="shrink-0 rounded-full border px-3 py-1 text-sm">
              {name || t("pos.setup3.public.other")}
            </a>
          ))}
        </nav>
      )}

      {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("pos.setup3.public.empty")}</p>}

      {sections.map(([name, list], i) => (
        <section key={name || "_"} id={`cat-${i}`} className="flex scroll-mt-4 flex-col gap-2">
          <h2 className="text-base font-semibold">{name || t("pos.setup3.public.other")}</h2>
          <ul className="flex flex-col divide-y rounded-md border">
            {list.map((item) => (
              <li key={item.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  <p className="mt-0.5 text-sm tabular-nums">{formatAmount(item.price)} €</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  aria-label={t("pos.setup3.public.add", { name: item.name })}
                  onClick={() => (groupsFor(item.id).length > 0 ? setChoosing(item) : add(item))}
                >
                  <Plus className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {count > 0 && !basketOpen && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
          <div className="mx-auto max-w-xl">
            <Button type="button" className="h-11 w-full" onClick={() => setBasketOpen(true)}>
              <ShoppingBasket className="size-4" />
              {t("pos.setup3.public.basket.open", { count })}
            </Button>
          </div>
        </div>
      )}

      {basketOpen && (
        <FormDialog open onOpenChange={(open) => !open && setBasketOpen(false)} title={t("pos.setup3.public.basket")} size="sm">
          <div className="flex flex-col gap-3">
            {!!order.error && !isNotFound(order.error) && (
              <Alert variant="destructive">
                <AlertDescription>{getApiErrorMessage(order.error, t("pos.setup3.public.sendError"))}</AlertDescription>
              </Alert>
            )}
            {basket.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.setup3.public.basket.empty")}</p>}
            <ul className="flex flex-col divide-y">
              {basket.map((l) => {
                const item = items.find((i) => i.id === l.itemId);
                return (
                  <li key={l.key} className="flex flex-col gap-1 py-2" data-testid="basket-line">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{item?.name}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">{item ? `${formatAmount(item.price)} €` : ""}</p>
                        {l.modifierIds.map((id) => {
                          const m = modifierName(id);
                          return m ? <p key={id} className="text-xs text-muted-foreground">+ {m.name} {delta(m.priceDelta)}</p> : null;
                        })}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.public.less", { name: item?.name ?? "" })}
                          onClick={() => setQuantity(l.key, l.quantity - 1)}>
                          {l.quantity === 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
                        </Button>
                        <span className="w-6 text-center tabular-nums" aria-label={t("pos.setup3.public.quantity")}>{l.quantity}</span>
                        <Button type="button" size="sm" variant="outline" aria-label={t("pos.setup3.public.more", { name: item?.name ?? "" })}
                          disabled={l.quantity >= MAX_QTY} onClick={() => setQuantity(l.key, l.quantity + 1)}>
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <Input
                      aria-label={t("pos.setup3.public.lineNote", { name: item?.name ?? "" })}
                      placeholder={t("pos.setup3.public.lineNote.placeholder")}
                      maxLength={200}
                      value={l.note}
                      onChange={(e) => setBasket((all) => all.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pm-note">{t("pos.setup3.public.note")}</Label>
              <Textarea id="pm-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">{t("pos.setup3.public.priceHint")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBasketOpen(false)}>{t("pos.setup3.public.keepBrowsing")}</Button>
              <Button type="button" disabled={basket.length === 0 || order.isPending} onClick={() => order.mutate()}>
                {t("pos.setup3.public.send")}
              </Button>
            </div>
          </div>
        </FormDialog>
      )}

      {choosing && (
        <ModifierChooser
          item={choosing}
          groups={groupsFor(choosing.id)}
          onClose={() => setChoosing(null)}
          onAdd={(ids) => {
            add(choosing, ids);
            setChoosing(null);
          }}
        />
      )}
    </>,
  );
}

// The guest's choices for one item. Each group's min/max is enforced here for the guest's sake;
// the server checks it again.
function ModifierChooser({ item, groups, onClose, onAdd }: {
  item: PublicMenuItemResponse;
  groups: ModifierGroupResponse[];
  onClose: () => void;
  onAdd: (modifierIds: string[]) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  function toggle(group: ModifierGroupResponse, id: string) {
    setError(null);
    setPicked((all) => {
      const current = all[group.id] ?? [];
      if (current.includes(id)) return { ...all, [group.id]: current.filter((x) => x !== id) };
      // One choice only: picking another replaces it.
      if (group.maxSelect === 1) return { ...all, [group.id]: [id] };
      if (group.maxSelect > 0 && current.length >= group.maxSelect) return all;
      return { ...all, [group.id]: [...current, id] };
    });
  }

  function confirm() {
    const short = groups.find((g) => (picked[g.id] ?? []).length < g.minSelect);
    if (short) {
      setError(t("pos.setup3.public.chooseMin", { min: short.minSelect, group: short.name }));
      return;
    }
    onAdd(groups.flatMap((g) => picked[g.id] ?? []));
  }

  const rule = (g: ModifierGroupResponse) =>
    g.minSelect > 0 && g.maxSelect > 0 && g.minSelect === g.maxSelect
      ? t("pos.setup3.public.rule.exactly", { n: g.minSelect })
      : g.minSelect > 0
        ? g.maxSelect > 0 ? t("pos.setup3.public.rule.range", { min: g.minSelect, max: g.maxSelect }) : t("pos.setup3.public.rule.atLeast", { n: g.minSelect })
        : g.maxSelect > 0 ? t("pos.setup3.public.rule.upTo", { n: g.maxSelect }) : t("pos.setup3.public.rule.optional");

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={item.name} size="sm">
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {groups.map((g) => {
          const current = picked[g.id] ?? [];
          const full = g.maxSelect > 1 && current.length >= g.maxSelect;
          return (
            <fieldset key={g.id} className="flex flex-col gap-1">
              <legend className="text-sm font-medium">
                {g.name} <span className="font-normal text-muted-foreground">· {rule(g)}</span>
              </legend>
              {g.modifiers.map((m) => {
                const checked = current.includes(m.id);
                return (
                  <label key={m.id} className={`flex min-h-10 items-center gap-3 rounded-md border px-3 text-sm ${!checked && full ? "opacity-50" : ""}`}>
                    <input
                      type={g.maxSelect === 1 ? "radio" : "checkbox"}
                      name={`g-${g.id}`}
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggle(g, m.id)}
                      onClick={() => {
                        // A radio can't be unticked by the browser; let a second tap clear an optional choice.
                        if (g.maxSelect === 1 && checked) toggle(g, m.id);
                      }}
                    />
                    <span className="flex-1">{m.name}</span>
                    <span className="tabular-nums text-muted-foreground">{delta(m.priceDelta)}</span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" onClick={confirm}>{t("pos.setup3.public.addToBasket")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
