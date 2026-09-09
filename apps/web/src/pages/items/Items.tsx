import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import type { ItemResponse } from "@pako/shared";

export function Items() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const take = 50;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Barcode
  const [barcodeItemId, setBarcodeItemId] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState("");

  async function refresh() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const res = await apiClient.itemsGET(activeCompanyId, skip, take, search || undefined);
      setItems(res.items as ItemResponse[]);
      setTotal(res.total);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "items.loadError" })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [activeCompanyId, skip, search]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setCreateError(null);
    setCreating(true);
    try {
      await apiClient.itemsPOST(activeCompanyId, {
        name: name.trim(),
        unit: unit.trim(),
        defaultUnitPrice: price ? parseFloat(price) : undefined,
      });
      setName("");
      setUnit("");
      setPrice("");
      setSkip(0);
      await refresh();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, intl.formatMessage({ id: "items.createError" })));
    } finally {
      setCreating(false);
    }
  }

  async function handleAddBarcode(itemId: string) {
    if (!activeCompanyId || !newBarcode.trim()) return;
    try {
      await apiClient.barcodesPOST(activeCompanyId, itemId, { barcode: newBarcode.trim() });
      setNewBarcode("");
      setBarcodeItemId(null);
      await refresh();
    } catch (err) {
      alert(getApiErrorMessage(err, intl.formatMessage({ id: "items.barcodeError" })));
    }
  }

  async function handleRemoveBarcode(itemId: string, barcodeId: string) {
    if (!activeCompanyId) return;
    try {
      await apiClient.barcodesDELETE(activeCompanyId, itemId, barcodeId);
      await refresh();
    } catch { /* ignore */ }
  }

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  const totalPages = Math.ceil(total / take);
  const currentPage = Math.floor(skip / take) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "items.title" })}</h2>
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "items.description" })}</p>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* Create form */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-3 font-medium">{intl.formatMessage({ id: "items.newItem" })}</h3>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreate}>
          {createError && <Alert variant="destructive"><AlertDescription>{createError}</AlertDescription></Alert>}
          <div className="flex flex-1 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.name" })}</Label>
            <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Laptop HP ProBook 450" />
          </div>
          <div className="flex w-24 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.unit" })}</Label>
            <Input required value={unit} onChange={e => setUnit(e.target.value)} placeholder="copë" />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <Label>{intl.formatMessage({ id: "items.defaultPrice" })}</Label>
            <Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
          </div>
          <Button type="submit" disabled={creating || !name.trim() || !unit.trim()}>
            {creating ? intl.formatMessage({ id: "items.creating" }) : intl.formatMessage({ id: "items.addItem" })}
          </Button>
        </form>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder={intl.formatMessage({ id: "items.searchPlaceholder" })}
          value={search}
          onChange={e => { setSearch(e.target.value); setSkip(0); }}
        />
        <span className="text-sm text-muted-foreground">
          {total} {intl.formatMessage({ id: "items.totalItems" })}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{intl.formatMessage({ id: "items.noItems" })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2 font-medium">#</th>
                <th className="p-2 font-medium">{intl.formatMessage({ id: "items.name" })}</th>
                <th className="p-2 font-medium">{intl.formatMessage({ id: "items.unit" })}</th>
                <th className="p-2 font-medium">{intl.formatMessage({ id: "items.defaultPrice" })}</th>
                <th className="p-2 font-medium">{intl.formatMessage({ id: "items.barcodes" })}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b">
                  <td className="p-2 font-mono">{item.code}</td>
                  <td className="p-2">{item.name}</td>
                  <td className="p-2">{item.unit}</td>
                  <td className="p-2">{item.defaultUnitPrice != null ? `${item.defaultUnitPrice.toFixed(2)} €` : "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {item.barcodes?.map(b => (
                        <Badge key={b.id} variant="outline" className="cursor-pointer" onClick={() => handleRemoveBarcode(item.id, b.id)}>
                          {b.barcode} ×
                        </Badge>
                      ))}
                      {barcodeItemId === item.id ? (
                        <span className="flex items-center gap-1">
                          <Input className="h-6 w-32 text-xs" value={newBarcode} onChange={e => setNewBarcode(e.target.value)} placeholder="barcode..." />
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleAddBarcode(item.id)}>+</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setBarcodeItemId(null)}>×</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setBarcodeItemId(item.id); setNewBarcode(""); }}>
                          + {intl.formatMessage({ id: "items.addBarcode" })}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - take))}>
            ←
          </Button>
          <span className="text-sm">{currentPage} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={skip + take >= total} onClick={() => setSkip(skip + take)}>
            →
          </Button>
        </div>
      )}
    </div>
  );
}
