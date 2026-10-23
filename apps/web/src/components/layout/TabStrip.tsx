import { useCallback, useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";

import { navItems } from "@/config/nav";
import { useTabs, type ResolvedTab } from "@/context/TabsContext";
import { cn } from "@/lib/utils";

function tabTitle(tab: ResolvedTab, intl: ReturnType<typeof useIntl>): string {
  if (tab.titleOverride) return tab.titleOverride;
  if (tab.kind === "instance" && tab.fallbackTitleKey) return intl.formatMessage({ id: tab.fallbackTitleKey });
  if (tab.titleKey) return intl.formatMessage({ id: tab.titleKey });
  return tab.path;
}

/* ────────────── Sortable tab button ────────────── */

function SortableTab({
  tab,
  isActive,
  isDragActive,
  intl,
  onFocus,
  onClose,
}: {
  tab: ResolvedTab;
  isActive: boolean;
  isDragActive: boolean;
  intl: ReturnType<typeof useIntl>;
  onFocus: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  const Icon = tab.icon;
  const title = tabTitle(tab, intl);

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => {
        if (!isDragActive) onFocus();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose();
        }
      }}
      className={cn(
        "group flex h-9 max-w-52 min-w-32 shrink-0 cursor-grab items-center gap-1.5 border-r px-2.5 text-[12.5px] select-none",
        isDragging && "cursor-grabbing shadow-lg",
        isActive
          ? "bg-card font-medium text-foreground shadow-[inset_0_2px_0_var(--primary)]"
          : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
      )}
      title={title}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      {tab.dirty && (
        <span
          aria-label={intl.formatMessage({ id: "shell.tabs.unsaved" })}
          className="size-1.5 shrink-0 rounded-full bg-warning-foreground"
        />
      )}
      <span
        role="button"
        tabIndex={-1}
        aria-label={intl.formatMessage({ id: "shell.tabs.close" })}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
      >
        <X className="size-3" />
      </span>
    </button>
  );
}

/* ────────────── Scroll arrow button ────────────── */

function ScrollArrow({
  direction,
  visible,
  onClick,
}: {
  direction: "left" | "right";
  visible: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "z-10 flex h-9 w-6 shrink-0 items-center justify-center bg-secondary text-muted-foreground hover:text-foreground",
        direction === "left" && "border-r",
        direction === "right" && "border-l",
      )}
      aria-label={`Scroll tabs ${direction}`}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/* ────────────── TabStrip ────────────── */

export function TabStrip() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeTabId, closeTab, focusTab, reorderTab } = useTabs();

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenAnchor, setQuickOpenAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const quickOpenRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // Check overflow state
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, tabs.length]);

  // Horizontal wheel scrolling on the tab strip
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!el) return;
      // If there's horizontal overflow, redirect vertical scroll to horizontal
      if (el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY || e.deltaX;
      }
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [tabs.length]);

  const scrollBy = useCallback((amount: number) => {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  // Quick-open popup close handlers
  useEffect(() => {
    if (!quickOpen) return;
    function handleClick(event: MouseEvent) {
      if (quickOpenRef.current && !quickOpenRef.current.contains(event.target as Node)) {
        setQuickOpen(false);
      }
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setQuickOpen(false);
    }
    function handleReposition() {
      setQuickOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [quickOpen]);

  const matches = query.trim()
    ? navItems.filter((item) => intl.formatMessage({ id: item.titleKey }).toLowerCase().includes(query.trim().toLowerCase()))
    : navItems;

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback(() => {
    setIsDragActive(true);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragActive(false);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTab(oldIndex, newIndex);
      }
    },
    [tabs, reorderTab],
  );

  // Auto-scroll while dragging near edges
  const dragAutoScrollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isDragActive) {
      if (dragAutoScrollRef.current) {
        cancelAnimationFrame(dragAutoScrollRef.current);
        dragAutoScrollRef.current = null;
      }
      return;
    }
    const el = scrollRef.current;
    if (!el) return;

    function tick(e: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const edgeZone = 40;
      if (e.clientX < rect.left + edgeZone) {
        el.scrollLeft -= 6;
      } else if (e.clientX > rect.right - edgeZone) {
        el.scrollLeft += 6;
      }
    }
    window.addEventListener("pointermove", tick);
    return () => window.removeEventListener("pointermove", tick);
  }, [isDragActive]);

  if (tabs.length === 0 && !quickOpen) return null;

  const tabIds = tabs.map((t) => t.id);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b bg-secondary">
      <ScrollArrow direction="left" visible={canScrollLeft} onClick={() => scrollBy(-200)} />

      <div
        ref={scrollRef}
        className="flex flex-1 items-stretch overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            <div className="flex items-stretch">
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  isDragActive={isDragActive}
                  intl={intl}
                  onFocus={() => focusTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <ScrollArrow direction="right" visible={canScrollRight} onClick={() => scrollBy(200)} />

      <div ref={quickOpenRef} className="shrink-0">
        <button
          type="button"
          onClick={(event) => {
            if (quickOpen) {
              setQuickOpen(false);
              return;
            }
            setQuickOpenAnchor(event.currentTarget.getBoundingClientRect());
            setQuickOpen(true);
          }}
          aria-label={intl.formatMessage({ id: "shell.tabs.new" })}
          title={intl.formatMessage({ id: "shell.tabs.new" })}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-card/60 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
        {quickOpen && quickOpenAnchor && (
          <div
            style={{ position: "fixed", top: quickOpenAnchor.bottom + 2, left: Math.max(8, quickOpenAnchor.right - 256) }}
            className="z-30 w-64 rounded-md border bg-card p-1.5 shadow-lg"
          >
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={intl.formatMessage({ id: "sidebar.filterPlaceholder" })}
              className="mb-1 h-7 w-full rounded border bg-background px-2 text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="max-h-72 overflow-y-auto">
              {matches.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    if (item.path !== location.pathname) navigate(item.path);
                    setQuickOpen(false);
                    setQuickOpenAnchor(null);
                    setQuery("");
                  }}
                  className="flex h-7 w-full items-center rounded px-2 text-left text-[12.5px] hover:bg-accent hover:text-accent-foreground"
                >
                  {intl.formatMessage({ id: item.titleKey })}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
                  {intl.formatMessage({ id: "sidebar.noResults" })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
