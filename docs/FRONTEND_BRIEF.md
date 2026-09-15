# Frontend brief — "one month, closed and filed"

You own `apps/web/`. Your counterpart owns `backend/` and publishes the API contract before he
implements it, so you are never waiting on an implementation — only on a contract.

Plan of record: `ACCOUNTANT_MILESTONE.md`. Design rationale: `ODOO_COMPARISON.md`.
Stack today: Vite 7, React 19, TypeScript 5.9, Tailwind v4, shadcn/ui primitives, react-intl,
react-router 7. Generated API client: `packages/shared/src/generated/api-client.ts`.

---

## Before task 1 — what is actually missing

The visual language is settled and good: Tailwind v4 + shadcn. Do not re-litigate it. What is
missing is not a look, it is machinery:

- **No data grid.** `src/components/ui/table.tsx` is 52 lines of styled `<table>` primitives.
- **No query layer.** Every page fetches and holds state by hand.
- **No form layer.** No validation, no dirty tracking, no field-level errors.

F1 therefore starts as a library decision, not a design decision. Recommended: **TanStack Table**
(headless, composes with shadcn, you own the toolbar) plus **TanStack Query** for the data layer and
**react-hook-form + zod** for forms — Zod is already a workspace dependency. AG Grid Community is
the alternative: more out of the box, heavier, and its own styling to fight.

## Where the design comes from

Not from Odoo's looks and not from FINAbit's — both are behaviour references. Specifically:

- **Interaction model: Excel.** Your users spend eight hours a day in it. In any editable grid,
  arrow keys move between cells, Enter commits and drops down, Tab moves right and wraps, and a
  pasted block of cells fills the rows. Tools that require clicking into a field and pressing Save
  lose to Excel; tools that behave like Excel win.
- **Grid behaviour: Odoo list views and FINAbit grids.** Optional columns, footer totals, group-by,
  row colouring by state, inline multi-row edit, export — see `ODOO_COMPARISON.md`.
- **Speed and keyboard: Linear.** Command palette, everything reachable without a mouse, optimistic
  updates so nothing blocks on a round trip.
- **Presenting money records: Stripe's dashboard.** How filters compose, and the detail view where
  one object shows its full history and related records in one place.
- **Two screens worth studying directly: QuickBooks Online and Xero** — their invoice form and their
  bank reconciliation. Fifteen years of iteration on the two hardest screens in accounting.

## The eight working rules

1. **Never compute money in the browser.** Totals, VAT, discounts and balances are rendered exactly
   as the API returns them. If a figure is missing from a response, ask for it — do not derive it.
2. **All data access goes through the generated client.** No hand-written `fetch`. Regenerate after
   every contract commit.
3. **Build against fixtures.** Each new endpoint arrives first as a stub plus a JSON fixture in
   `src/mocks/`. Start the screen the day the contract lands, not the day the implementation does.
4. **Every list is the DataGrid.** No bespoke tables. If a screen needs something the grid cannot do,
   add it to the grid.
5. **Density is a feature.** ~30px rows, not shadcn's ~48–56px default. `font-variant-numeric:
   tabular-nums` on every figure column, figures right-aligned. An accountant expects forty rows on
   screen, not twelve.
6. **Every string is EN and SQ** in `src/i18n/messages.ts`. Add keys; never rename one — old keys
   stay, unused, by standing convention.
7. **No browser storage for anything that matters.** Remembered filters and column choices, fine.
   Anything the accountant would be upset to lose goes to the API.
8. **State in the URL.** Filters, page, sort and the selected period belong in query params so a
   screen can be linked, bookmarked and reloaded. Accountants send each other links.

---

## Phase 0 — week 1, shared with the backend dev

Help resolve the Track C rebase — six of the ~36 conflict hunks are yours: `InvoiceForm.tsx`,
`BillForm.tsx`, `Invoicing.tsx`, `Bills.tsx`, `InvoiceDetail.tsx`, `BillDetail.tsx`, plus
`messages.ts`. Then choose and land the three libraries above, with one throwaway screen proving
the stack end to end. Nothing else starts until the grid exists.

---

## Checkpoint 1 — weeks 2–4 — the accountant owns their chart

### F1 · The grid foundation
The highest-leverage item in the entire milestone. Build once, reuse everywhere:
per-column filters · drag-a-column-to-group-by · footer totals per numeric column · show/hide
columns with the choice remembered per user · server-side paging and sorting driven from the URL ·
row decoration by state (draft muted, cancelled struck, overdue flagged) · multi-row selection and
edit · Excel export · a loading skeleton that does not reflow the table.
*Done when:* a second developer can put a new register on screen with a column definition and an
endpoint, and gets all of the above without writing any of it.

### F2 · Chart of accounts
Tree view grouped by the code-prefix groups the API returns. Add-under-group, edit, deactivate.
Group and subgroup shown as inherited and read-only. Surface the behaviour flags honestly — control,
postable, subledger, VAT code, CIT treatment, cash-flow category — because an accountant who cannot
see why a posting was refused will assume the software is broken.
*Done when:* an accountant adds an account, renames one and deactivates one without help.

### F3 · Lock dates in settings
Five dates (global, tax, sale, purchase, hard) with plain-language explanations of each, plus the
exception list — who, why, until when — and grant/revoke. The hard lock needs a confirmation that
says clearly that it cannot be undone.
*Done when:* posting into a locked period shows a message naming the lock and the date, not a
generic failure.

### F4 · Accountant landing
The business list becomes the screen a firm member lands on after login. Search, last-opened first.

---

## Checkpoint 2 — weeks 5–8 — the registers become real

### F5 · Item register
List on the grid. Form with type (goods / service / normative), unit, barcodes, VAT code and the
three account pickers. Then an item picker on invoice and bill lines that pulls the item's defaults
onto the line — and shows clearly when it has overridden something.

### F6 · Partner form
Control account, payment terms, credit limit, fiscal number, VAT status. The partner picker shows
VAT status inline, because that is what decides the tax code on the document.

### F7 · Numbering settings and preview
Pattern per document type and year. Next-number preview on the create form, labelled provisional —
the number is only reserved on post, and showing one number then issuing another is worse than
showing none. Override field appears only when the company setting allows it.

### F8 · Paged registers everywhere
Retro-fit the grid onto invoices, bills, partners and journal entries as B7 lands each one.

---

## Checkpoint 3 — weeks 9–12 — the month can be filed

### F9 · The manual journal grid
The screen that decides whether accountants adopt PAKO. Columns: account, description, debit,
credit, partner, analytic distribution. Full Excel keyboard model (rule above). Running debit and
credit totals with the difference shown live. Auto-balance the last line on request. Description
autofills — *ask Adonis from what: the account name, the header description, or the line above.*
Save is refused while unbalanced, and the refusal names the amount.
*Done when:* someone can key a twelve-line entry without touching the mouse.

### F10 · Reports with exports
Every report gets an export button and a period selector that knows which periods are locked.

### F11 · Attachments
Drop a file on an invoice or bill, thumbnail, open the original. This is the screen OCR plugs into
later, so leave room in the layout for an extracted-fields panel beside the preview.

### F12 · Year-end and analytic distribution
The roll-forward screen, and a distribution editor that splits a line across analytic accounts by
percentage and refuses to save at anything other than 100%.

---

## Open questions that block your work

- **F9** — what autofills the journal description?
- **F5** — what happens when an item has no default accounts: company fallback, or refuse to save?
- **F3** — who may grant a lock exception: owner only, or any firm member?
