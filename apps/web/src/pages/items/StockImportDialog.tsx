import { useCallback, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { AccountResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import {
  downloadImportTemplate,
  previewStockImport,
  confirmStockImport,
  type StockImportPreviewRow,
  type StockImportPreviewResponse,
  type StockImportConfirmResponse,
} from "@/api/stock-import-client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/context/CompanyContext";
import { useWarehouses } from "@/hooks/useStock";
import { AccountType, isExpenseAccountType, isIncomeAccountType } from "@/lib/ledger-enums";

type Step = "setup" | "preview" | "results";

interface EditableRow {
  rowNumber: number;
  name: string;
  description: string;
  unit: string;
  category: string;
  salePrice: string;
  revenueAccountCode: string;
  expenseAccountCode: string;
  inventoryAccountCode: string;
  vatCode: string;
  minimumStock: string;
  barcode: string;
  openingQty: string;
  openingUnitCost: string;
  purchaseUnit: string;
  purchaseFactor: string;
  salesUnit: string;
  salesFactor: string;
  // Server-side validation results (updated after re-validate)
  status: string;
  errors: string[];
  warnings: string[];
  dirty: boolean;
}

function previewToEditable(row: StockImportPreviewRow): EditableRow {
  return {
    rowNumber: row.rowNumber,
    name: row.name ?? "",
    description: row.description ?? "",
    unit: row.unit ?? "",
    category: row.category ?? "",
    salePrice: row.salePrice != null ? String(row.salePrice) : "",
    revenueAccountCode: row.revenueAccountCode ?? "",
    expenseAccountCode: row.expenseAccountCode ?? "",
    inventoryAccountCode: row.inventoryAccountCode ?? "",
    vatCode: row.vatCode ?? "",
    minimumStock: row.minimumStock != null ? String(row.minimumStock) : "",
    barcode: row.barcode ?? "",
    openingQty: row.openingQty != null ? String(row.openingQty) : "",
    openingUnitCost: row.openingUnitCost != null ? String(row.openingUnitCost) : "",
    purchaseUnit: row.purchaseUnit ?? "",
    purchaseFactor: row.purchaseFactor != null ? String(row.purchaseFactor) : "",
    salesUnit: row.salesUnit ?? "",
    salesFactor: row.salesFactor != null ? String(row.salesFactor) : "",
    status: row.status,
    errors: [...row.errors],
    warnings: [...row.warnings],
    dirty: false,
  };
}

const HEADERS = ["Name", "Description", "Unit", "Category", "Sale Price",
  "Revenue Account", "Expense Account", "Inventory Account", "VAT Code", "Min Stock",
  "Barcode", "Opening Qty", "Opening Unit Cost", "Purchase Unit", "Purchase Factor",
  "Sales Unit", "Sales Factor"];

function buildXlsxFile(rows: EditableRow[]): File {
  const data = [HEADERS, ...rows.map((r) => [
    r.name, r.description, r.unit, r.category,
    r.salePrice ? Number(r.salePrice) : null,
    r.revenueAccountCode, r.expenseAccountCode, r.inventoryAccountCode,
    r.vatCode,
    r.minimumStock ? Number(r.minimumStock) : null,
    r.barcode,
    r.openingQty ? Number(r.openingQty) : null,
    r.openingUnitCost ? Number(r.openingUnitCost) : null,
    r.purchaseUnit,
    r.purchaseFactor ? Number(r.purchaseFactor) : null,
    r.salesUnit,
    r.salesFactor ? Number(r.salesFactor) : null,
  ])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new File([buf], "stock-import-corrected.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function StockImportDialog({ open, onOpenChange, onComplete }: Props) {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;

  const [step, setStep] = useState<Step>("setup");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [openingDate, setOpeningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fallbackRevenue, setFallbackRevenue] = useState("");
  const [fallbackExpense, setFallbackExpense] = useState("");
  const [fallbackInventory, setFallbackInventory] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StockImportPreviewResponse | null>(null);
  const [editedRows, setEditedRows] = useState<EditableRow[]>([]);
  const [result, setResult] = useState<StockImportConfirmResponse | null>(null);

  // Data queries
  const warehousesQuery = useWarehouses();
  const warehouses = useMemo(() => (warehousesQuery.data ?? []).filter((w) => w.isActive), [warehousesQuery.data]);

  const accountsQuery = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => apiClient.accountsAll(companyId),
    enabled: !!companyId,
  });
  const accounts = useMemo<AccountResponse[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const incomeAccounts = useMemo(() => accounts.filter((a) => isIncomeAccountType(a.accountType)), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((a) => isExpenseAccountType(a.accountType)), [accounts]);
  const inventoryAccounts = useMemo(() => accounts.filter((a) => a.accountType === AccountType.CurrentAsset), [accounts]);

  // Default warehouse
  useMemo(() => {
    if (warehouseId === "" && warehouses.length > 0) {
      const defaultWh = warehouses.find((w) => w.code === "WH-01") ?? warehouses[0];
      if (defaultWh) setWarehouseId(defaultWh.id);
    }
  }, [warehouses, warehouseId]);

  // File handling
  const validateFile = useCallback((f: File): string | null => {
    if (f.size > 10 * 1024 * 1024) return intl.formatMessage({ id: "items.import.error.fileTooLarge" });
    if (!f.name.endsWith(".xlsx")) return intl.formatMessage({ id: "items.import.invalidFormat" });
    return null;
  }, [intl]);

  const handleFileSelect = useCallback((f: File) => {
    const err = validateFile(f);
    if (err) { setError(err); setFile(null); return; }
    setFile(f);
    setError(null);
    setPreview(null);
    setEditedRows([]);
  }, [validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  // Template download
  const handleDownload = useCallback(async (filled: boolean) => {
    try {
      const blob = await downloadImportTemplate(companyId, filled);
      downloadBlob(blob, filled ? "stock-import-template-examples.xlsx" : "stock-import-template.xlsx");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  }, [companyId]);

  // Preview (from original file)
  const handlePreview = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await previewStockImport(companyId, file, fallbackRevenue || undefined, fallbackExpense || undefined, fallbackInventory || undefined);
      setPreview(result);
      setEditedRows(result.rows.map(previewToEditable));
      setStep("preview");
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "items.import.error.parseError" })));
    } finally {
      setLoading(false);
    }
  }, [companyId, file, fallbackRevenue, fallbackExpense, fallbackInventory, intl]);

  // Re-validate (from edited rows)
  const handleRevalidate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const xlsx = buildXlsxFile(editedRows);
      const result = await previewStockImport(companyId, xlsx, fallbackRevenue || undefined, fallbackExpense || undefined, fallbackInventory || undefined);
      setPreview(result);
      setEditedRows(result.rows.map(previewToEditable));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "items.import.error.parseError" })));
    } finally {
      setLoading(false);
    }
  }, [companyId, editedRows, fallbackRevenue, fallbackExpense, fallbackInventory, intl]);

  // Confirm (from edited rows)
  const handleConfirm = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError(null);
    try {
      const xlsx = buildXlsxFile(editedRows);
      const res = await confirmStockImport(companyId, xlsx, warehouseId, openingDate, fallbackRevenue || undefined, fallbackExpense || undefined, fallbackInventory || undefined);
      setResult(res);
      setStep("results");
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "items.import.error.parseError" })));
    } finally {
      setLoading(false);
    }
  }, [companyId, editedRows, warehouseId, openingDate, fallbackRevenue, fallbackExpense, fallbackInventory, intl]);

  const handleDownloadCorrected = useCallback(() => {
    const xlsx = buildXlsxFile(editedRows);
    downloadBlob(xlsx, "stock-import-corrected.xlsx");
  }, [editedRows]);

  const handleClose = useCallback(() => {
    if (step === "results") onComplete();
    onOpenChange(false);
  }, [step, onComplete, onOpenChange]);

  const handleReupload = useCallback(() => {
    setFile(null);
    setPreview(null);
    setEditedRows([]);
    setError(null);
    setStep("setup");
  }, []);

  const updateRow = useCallback((rowNumber: number, field: keyof EditableRow, value: string) => {
    setEditedRows((prev) => prev.map((r) =>
      r.rowNumber === rowNumber ? { ...r, [field]: value, dirty: true } : r
    ));
  }, []);

  const importableCount = (preview?.summary.ready ?? 0) + (preview?.summary.warnings ?? 0);
  const hasDirtyRows = editedRows.some((r) => r.dirty);

  const accountLabel = (a: AccountResponse) => `${a.code} \u00b7 ${a.name}`;

  const stepTitle = step === "setup"
    ? intl.formatMessage({ id: "items.import.step.setup" })
    : step === "preview"
      ? intl.formatMessage({ id: "items.import.step.preview" })
      : intl.formatMessage({ id: "items.import.step.results" });

  const footer = (
    <div className="flex items-center justify-between">
      <div className="flex gap-1">
        {(["setup", "preview", "results"] as const).map((s, i) => (
          <span key={s} className={`h-1.5 w-6 rounded-full ${(["setup", "preview", "results"] as const).indexOf(step) >= i ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <div className="flex gap-2">
        {step !== "results" && (
          <Button type="button" variant="outline" onClick={handleClose}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        )}
        {step === "setup" && (
          <Button type="button" onClick={handlePreview} disabled={!file || !warehouseId || loading}>
            {loading ? intl.formatMessage({ id: "items.import.processing" }) : intl.formatMessage({ id: "items.import.parsePreview" })}
          </Button>
        )}
        {step === "preview" && (
          <>
            <Button type="button" variant="outline" onClick={handleReupload}>
              {intl.formatMessage({ id: "items.import.reupload" })}
            </Button>
            {hasDirtyRows && (
              <Button type="button" variant="outline" onClick={handleRevalidate} disabled={loading}>
                {intl.formatMessage({ id: "items.import.revalidate" })}
              </Button>
            )}
            <Button type="button" onClick={hasDirtyRows ? handleRevalidate : handleConfirm} disabled={(!hasDirtyRows && importableCount === 0) || loading}>
              {loading
                ? intl.formatMessage({ id: "items.import.processing" })
                : hasDirtyRows
                  ? intl.formatMessage({ id: "items.import.revalidate" })
                  : intl.formatMessage({ id: "items.import.confirm.count" }, { count: importableCount })}
            </Button>
          </>
        )}
        {step === "results" && (
          <>
            <Button type="button" variant="outline" onClick={handleDownloadCorrected}>
              {intl.formatMessage({ id: "items.import.downloadCorrected" })}
            </Button>
            <Button type="button" onClick={handleClose}>
              {intl.formatMessage({ id: "items.import.results.done" })}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={handleClose}
      title={intl.formatMessage({ id: "items.import.title" })}
      description={stepTitle}
      size={step === "preview" ? "full" : "lg"}
      footer={footer}
    >
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === "setup" && <SetupStep
        intl={intl}
        warehouses={warehouses}
        warehouseId={warehouseId}
        onWarehouseChange={setWarehouseId}
        openingDate={openingDate}
        onOpeningDateChange={setOpeningDate}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        inventoryAccounts={inventoryAccounts}
        fallbackRevenue={fallbackRevenue}
        fallbackExpense={fallbackExpense}
        fallbackInventory={fallbackInventory}
        onFallbackRevenueChange={setFallbackRevenue}
        onFallbackExpenseChange={setFallbackExpense}
        onFallbackInventoryChange={setFallbackInventory}
        accountLabel={accountLabel}
        file={file}
        dragOver={dragOver}
        fileInputRef={fileInputRef}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
        onDownload={handleDownload}
      />}

      {step === "preview" && preview && (
        <PreviewStep intl={intl} preview={preview} editedRows={editedRows} onUpdateRow={updateRow} />
      )}

      {step === "results" && result && <ResultsStep intl={intl} result={result} />}
    </FormDialog>
  );
}

// ---- Setup Step ----

function SetupStep({
  intl, warehouses, warehouseId, onWarehouseChange, openingDate, onOpeningDateChange,
  incomeAccounts, expenseAccounts, inventoryAccounts,
  fallbackRevenue, fallbackExpense, fallbackInventory,
  onFallbackRevenueChange, onFallbackExpenseChange, onFallbackInventoryChange,
  accountLabel, file, dragOver, fileInputRef,
  onDragOver, onDragLeave, onDrop, onFileSelect, onDownload,
}: {
  intl: ReturnType<typeof useIntl>;
  warehouses: { id: string; code: string; name: string }[];
  warehouseId: string;
  onWarehouseChange: (id: string) => void;
  openingDate: string;
  onOpeningDateChange: (date: string) => void;
  incomeAccounts: AccountResponse[];
  expenseAccounts: AccountResponse[];
  inventoryAccounts: AccountResponse[];
  fallbackRevenue: string;
  fallbackExpense: string;
  fallbackInventory: string;
  onFallbackRevenueChange: (id: string) => void;
  onFallbackExpenseChange: (id: string) => void;
  onFallbackInventoryChange: (id: string) => void;
  accountLabel: (a: AccountResponse) => string;
  file: File | null;
  dragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (f: File) => void;
  onDownload: (filled: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onDownload(false)}>
          {intl.formatMessage({ id: "items.import.downloadTemplate" })}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onDownload(true)}>
          {intl.formatMessage({ id: "items.import.downloadFilled" })}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={intl.formatMessage({ id: "items.import.warehouse" })} htmlFor="import-warehouse" required
          hint={intl.formatMessage({ id: "items.import.warehouse.description" })}>
          <SearchableSelect
            id="import-warehouse"
            value={warehouseId}
            onChange={onWarehouseChange}
            placeholder={intl.formatMessage({ id: "common.select" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            options={warehouses.map((w) => ({ value: w.id, label: `${w.code} \u00b7 ${w.name}` }))}
          />
        </FormField>
        <FormField label={intl.formatMessage({ id: "items.import.openingDate" })} htmlFor="import-opening-date" required>
          <Input id="import-opening-date" type="date" value={openingDate} onChange={(e) => onOpeningDateChange(e.target.value)} />
        </FormField>
      </div>

      <fieldset className="rounded-md border p-3 space-y-3">
        <legend className="px-1 text-sm font-medium">{intl.formatMessage({ id: "items.import.fallbackAccounts" })}</legend>
        <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.import.fallbackAccounts.description" })}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label={intl.formatMessage({ id: "items.import.fallbackRevenue" })} htmlFor="import-fallback-revenue">
            <SearchableSelect id="import-fallback-revenue" value={fallbackRevenue} onChange={onFallbackRevenueChange}
              placeholder={intl.formatMessage({ id: "items.form.selectAccount" })} searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })} emptyOptionLabel="—"
              options={incomeAccounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} />
          </FormField>
          <FormField label={intl.formatMessage({ id: "items.import.fallbackExpense" })} htmlFor="import-fallback-expense">
            <SearchableSelect id="import-fallback-expense" value={fallbackExpense} onChange={onFallbackExpenseChange}
              placeholder={intl.formatMessage({ id: "items.form.selectAccount" })} searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })} emptyOptionLabel="—"
              options={expenseAccounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} />
          </FormField>
          <FormField label={intl.formatMessage({ id: "items.import.fallbackInventory" })} htmlFor="import-fallback-inventory">
            <SearchableSelect id="import-fallback-inventory" value={fallbackInventory} onChange={onFallbackInventoryChange}
              placeholder={intl.formatMessage({ id: "items.form.selectAccount" })} searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })} emptyOptionLabel="—"
              options={inventoryAccounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} />
          </FormField>
        </div>
      </fieldset>

      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer ${
          dragOver ? "bg-primary/5 border-primary" : "bg-muted/30 border-muted-foreground/25 hover:bg-muted/50 hover:border-muted-foreground/40"
        }`}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !file && fileInputRef.current?.click()}
      >
        {file ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
            <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onFileSelect(new File([], "")); fileInputRef.current!.value = ""; }}>x</Button>
          </div>
        ) : (
          <>
            <svg className="h-8 w-8 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "items.import.dragDrop" })}</p>
            <p className="text-xs text-muted-foreground">Max 10 MB, .xlsx</p>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }} />
      </div>
    </div>
  );
}

// ---- Editable Cell ----

function EditableCell({ value, onChange, type = "text", className = "" }: {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <span
        className={`block cursor-text rounded px-1 -mx-1 hover:bg-muted/50 min-h-[1.25rem] ${className}`}
        onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
      >
        {value || <span className="text-muted-foreground">—</span>}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      step={type === "number" ? "any" : undefined}
      className={`block w-full rounded border border-primary/50 bg-background px-1 py-0 text-sm outline-none focus:ring-1 focus:ring-primary/30 ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(false); }}
      autoFocus
    />
  );
}

// ---- Preview Step ----

function PreviewStep({ intl, preview, editedRows, onUpdateRow }: {
  intl: ReturnType<typeof useIntl>;
  preview: StockImportPreviewResponse;
  editedRows: EditableRow[];
  onUpdateRow: (rowNumber: number, field: keyof EditableRow, value: string) => void;
}) {
  const { summary, newCategories } = preview;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-green-500 text-green-700">
          {intl.formatMessage({ id: "items.import.preview.ready" }, { count: summary.ready })}
        </Badge>
        {summary.warnings > 0 && (
          <Badge variant="outline" className="border-yellow-500 text-yellow-700">
            {intl.formatMessage({ id: "items.import.preview.warnings" }, { count: summary.warnings })}
          </Badge>
        )}
        {summary.errorCount > 0 && (
          <Badge variant="outline" className="border-red-500 text-red-700">
            {intl.formatMessage({ id: "items.import.preview.errors" }, { count: summary.errorCount })}
          </Badge>
        )}
        {newCategories.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage({ id: "items.import.preview.newCategories" }, { count: newCategories.length })}:
            {" "}{newCategories.join(", ")}
          </span>
        )}
        {editedRows.some((r) => r.dirty) && (
          <Badge variant="outline" className="border-blue-500 text-blue-700">
            {intl.formatMessage({ id: "items.import.preview.edited" })}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.import.preview.editHint" })}</p>

      {/* Preview table */}
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b z-10">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 w-10">#</th>
              <th className="px-2 py-1.5 w-12">{intl.formatMessage({ id: "items.import.col.status" })}</th>
              <th className="px-2 py-1.5 min-w-[140px]">{intl.formatMessage({ id: "items.form.name" })}</th>
              <th className="px-2 py-1.5 min-w-[60px]">{intl.formatMessage({ id: "items.form.unit" })}</th>
              <th className="px-2 py-1.5 min-w-[100px]">{intl.formatMessage({ id: "items.category" })}</th>
              <th className="px-2 py-1.5 min-w-[80px]">{intl.formatMessage({ id: "items.defaultPrice" })}</th>
              <th className="px-2 py-1.5 min-w-[60px]">{intl.formatMessage({ id: "items.import.col.vatCode" })}</th>
              <th className="px-2 py-1.5 min-w-[70px]">{intl.formatMessage({ id: "items.import.col.openingQty" })}</th>
              <th className="px-2 py-1.5 min-w-[70px]">{intl.formatMessage({ id: "items.import.col.unitCost" })}</th>
              <th className="px-2 py-1.5 min-w-[70px]">{intl.formatMessage({ id: "items.import.col.revAcct" })}</th>
              <th className="px-2 py-1.5 min-w-[70px]">{intl.formatMessage({ id: "items.import.col.expAcct" })}</th>
              <th className="px-2 py-1.5 min-w-[70px]">{intl.formatMessage({ id: "items.import.col.invAcct" })}</th>
              <th className="px-2 py-1.5 min-w-[200px]">{intl.formatMessage({ id: "items.import.col.errors" })}</th>
            </tr>
          </thead>
          <tbody>
            {editedRows.map((row) => (
              <tr
                key={row.rowNumber}
                className={
                  row.dirty ? "bg-blue-50 dark:bg-blue-950/20" :
                  row.status === "Error" ? "bg-red-50 dark:bg-red-950/20" :
                  row.status === "Warning" ? "bg-yellow-50 dark:bg-yellow-950/20" :
                  ""
                }
              >
                <td className="px-2 py-1 text-xs text-muted-foreground tabular-nums">{row.rowNumber}</td>
                <td className="px-2 py-1">
                  {row.dirty
                    ? <span className="text-blue-600 text-xs font-medium">*</span>
                    : row.status === "Ready" ? <span className="text-green-600 text-xs font-medium">OK</span>
                    : row.status === "Warning" ? <span className="text-yellow-600 text-xs font-medium">!</span>
                    : <span className="text-red-600 text-xs font-medium">x</span>
                  }
                </td>
                <td className="px-2 py-1"><EditableCell value={row.name} onChange={(v) => onUpdateRow(row.rowNumber, "name", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.unit} onChange={(v) => onUpdateRow(row.rowNumber, "unit", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.category} onChange={(v) => onUpdateRow(row.rowNumber, "category", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.salePrice} onChange={(v) => onUpdateRow(row.rowNumber, "salePrice", v)} type="number" className="text-right tabular-nums" /></td>
                <td className="px-2 py-1"><EditableCell value={row.vatCode} onChange={(v) => onUpdateRow(row.rowNumber, "vatCode", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.openingQty} onChange={(v) => onUpdateRow(row.rowNumber, "openingQty", v)} type="number" className="text-right tabular-nums" /></td>
                <td className="px-2 py-1"><EditableCell value={row.openingUnitCost} onChange={(v) => onUpdateRow(row.rowNumber, "openingUnitCost", v)} type="number" className="text-right tabular-nums" /></td>
                <td className="px-2 py-1"><EditableCell value={row.revenueAccountCode} onChange={(v) => onUpdateRow(row.rowNumber, "revenueAccountCode", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.expenseAccountCode} onChange={(v) => onUpdateRow(row.rowNumber, "expenseAccountCode", v)} /></td>
                <td className="px-2 py-1"><EditableCell value={row.inventoryAccountCode} onChange={(v) => onUpdateRow(row.rowNumber, "inventoryAccountCode", v)} /></td>
                <td className="px-2 py-1 text-xs max-w-[300px]">
                  {row.errors.length > 0 && <span className="text-red-600">{row.errors.join("; ")}</span>}
                  {row.warnings.length > 0 && <span className="text-yellow-600">{row.warnings.join("; ")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Results Step ----

function ResultsStep({ intl, result }: {
  intl: ReturnType<typeof useIntl>;
  result: StockImportConfirmResponse;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-green-700">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-lg font-semibold">{intl.formatMessage({ id: "items.import.results.title" })}</span>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{intl.formatMessage({ id: "items.import.results.created" }, { count: result.created })}</span>
        </div>

        {result.skipped > 0 && (
          <div className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "items.import.results.skipped" }, { count: result.skipped })}
          </div>
        )}

        {result.createdCategories.length > 0 && (
          <div className="text-sm">
            <span className="font-medium">{intl.formatMessage({ id: "items.import.results.categories" })}:</span>{" "}
            {result.createdCategories.join(", ")}
          </div>
        )}

        {result.openingDocumentId && (
          <div className="text-sm">
            <span className="font-medium">{intl.formatMessage({ id: "items.import.results.openingDoc" })}:</span>{" "}
            <a href={`/stock-documents/${result.openingDocumentId}`} className="text-primary underline">
              {result.openingDocumentNumber}
            </a>
          </div>
        )}

        {result.errors && result.errors.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{intl.formatMessage({ id: "items.import.results.skippedDetails" })}:</p>
            <div className="max-h-40 overflow-auto rounded border p-2 text-xs">
              {result.errors.map((e, i) => (
                <div key={i} className="text-red-600">
                  Row {e.rowNumber}: {e.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
