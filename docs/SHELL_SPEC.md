# PAKO shell specification

Decided 15 Sep 2026. Blueprints: `docs/blueprints/*.html` — open them in a browser.
Theme handoff: `docs/THEME_BRIEF.md`. Anatomy rationale: `docs/ODOO_COMPARISON.md`.

**The blueprints are structure, not palette.** Every colour in them is a placeholder. What is
intentional: ~30px rows, 28px controls, right-aligned tabular figures, the presence and order of
every structural element, and the Albanian labels.

---

## 1. Taking the theme from Claude Design

Claude Design returns `:root` / `.dark` token blocks in `oklch()`, a type choice, and a worked
example. To land it:

1. Replace the `:root` and `.dark` blocks in `apps/web/src/index.css`. They are currently the stock
   shadcn install — every colour `oklch(… 0 0)`, zero chroma.
2. **Map every new token in `@theme inline`, or Tailwind v4 will not expose it.** Adding
   `--success` to `:root` alone does *not* make `bg-success` work. Each one needs
   `--color-success: var(--success);` in the `@theme inline` block. The new semantic tokens are
   `success`, `warning`, `info`, `neutral-state` (each with a `-foreground`), and optionally
   `debit` / `credit`.
3. Add the fonts via `<link>` in `index.html`, with the fallback stacks the handoff specifies.
4. Set the density defaults: table row 30px, control height 28px, and `tabular-nums` on numeric
   cells.
5. **Prove it on one screen before restyling anything else.** Apply the tokens to a single register
   row — header, normal, zebra, selected, and the five state pills — check it in light and dark,
   then stop and show it. Do not repaint the whole app on an unverified token set.

---

## 2. Tabs

**Every tab is a route.** The tab strip is a view over the router, never a store of in-memory
windows. Non-negotiable, because it is what separates this from FINAbit's MDI:

- Each tab has its own URL (`/invoices`, `/journal-entries/UR-091026-001`).
- The browser back button works.
- A reload restores the open workspace rather than dropping the user at the dashboard.
- A link pasted from an email opens as a new tab inside the app.

Behaviour:

- **Singleton tabs** for registers, reports and settings: opening one that is already open focuses
  the existing tab. **Instance tabs** for records: every invoice opens its own.
- An **amber dot** on a tab means unsaved changes. With four documents open, "which have I not
  saved?" is the most common question on screen and it must be answerable without clicking.
- An icon per document kind, so kinds are distinguishable at a glance.
- `Ctrl+Tab` cycles, `Ctrl+W` closes, middle-click closes, `+` at the end of the strip.
- The strip sits at the top of the content area, to the right of the sidebar, below the top bar.
  It costs 36px of height on every screen — accepted.
- **Open decisions:** overflow behaviour (scroll vs a "+6" menu) and what happens when closing a
  tab with unsaved changes (prompt vs keep the draft silently). Ask before implementing either.

## 3. Sidebar

Always visible. 236px. Scrolls independently of the top bar and tab strip. A "Filtro menynë" box
at the top.

**Two distinct mechanisms — do not merge them:**

- **"Shfaq më shumë (N)"** reveals hidden *destinations* within a category. Which items are visible
  while collapsed is chosen by the user, from the category's `⋯` menu: checkboxes for visibility,
  drag handles for order, a star to promote an item into Favourites.
- **`▾` on an item** opens *saved views of that same destination* — filters, with live counts
  (`Të gjitha 1,208 · Draftet 6 · Të papaguara 184 · Vonesa mbi 60 ditë 23`), plus
  "+ Ruaj filtrin aktual". These are not pages.

Rules:

- **Favourites sits at the top** and can hold anything, including create actions
  (`+ Faturë e re` is the first entry). The FINAbit lesson: the things people reach for most are
  new-document actions, not lists.
- **The selection is stored per user, not per company.** An accountant keeps one menu across all
  hundred clients.
- **Categories never hide, only items within them** — otherwise someone hides a category and cannot
  find their way back.
- **"Filtro menynë" searches everything**, including items currently hidden behind "Shfaq më
  shumë". Otherwise customisation makes features unfindable, which is how this pattern usually
  fails.

## 4. Density and figures

~30px table rows, 28px controls — not shadcn's 48–56px default. `font-variant-numeric: tabular-nums`
on every numeric column, right-aligned. Forty rows on screen, not twelve. If a component's default
spacing fights this, override the component, not the requirement.

## 5. Register anatomy (every list, in this order)

Action row → group-by drop zone → column headers with a Σ toggle per numeric column → permanent
filter row, one control per column → rows with a left number gutter → page totals, column-aligned
and tinted → footer with `filtered / total` and paging.

State reads as form as well as colour, because registers get printed: draft dashed, cancelled struck
through, overdue tinted.

## 6. Document anatomy (invoice, bill, journal entry)

Header bar with actions on the left and lifecycle statusbar on the right, in a bar that never moves
→ inline alerts that carry their own fix button → sheet with stat buttons (counts that navigate) →
two field groups → tabs → line grid → totals right-aligned under the lines → audit strip.

## 7. The journal grid keyboard contract

Arrows move between cells · Enter commits and drops down · Tab moves right and wraps · Escape reverts
the cell · Ctrl+V fills rows from a pasted Excel block. Live debit/credit difference beside the
totals, green at zero, and Post refused until it is zero.
