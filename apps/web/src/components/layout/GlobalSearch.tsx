import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { FileText, Package, Receipt, Search, Users, X } from "lucide-react";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

interface SearchResult {
  id: string;
  label: string;
  category: string;
  url?: string;
}

const categoryIcons: Record<string, typeof FileText> = {
  invoices: FileText,
  salesReturns: FileText,
  bills: Receipt,
  purchaseReturns: Receipt,
  partners: Users,
  accounts: Search,
  items: Package,
};

export function GlobalSearch() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(
    async (q: string) => {
      if (!activeCompany?.id || q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data = await apiClient.search(activeCompany.id, q);
        setResults(data.results ?? []);
        setSelected(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [activeCompany?.id],
  );

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function handleSelect(result: SearchResult) {
    setOpen(false);
    if (result.url) navigate(result.url);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      handleSelect(results[selected]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative z-10 w-full max-w-lg rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={intl.formatMessage({ id: "search.placeholder" })}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "search.noResults" })}</p>
          )}

          {results.map((result, index) => {
            const Icon = categoryIcons[result.category] ?? Search;
            return (
              <button
                key={`${result.category}-${result.id}`}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  index === selected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelected(index)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{result.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {intl.formatMessage({ id: `search.${result.category}` })}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          ↑↓ {intl.formatMessage({ id: "search.navigate" })} · ↵ {intl.formatMessage({ id: "search.select" })} · esc{" "}
          {intl.formatMessage({ id: "search.close" })}
        </div>
      </div>
    </div>
  );
}
