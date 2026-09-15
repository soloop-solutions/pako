# Frontend agent instructions — PAKO

You are working in the PAKO monorepo as the **frontend developer**. A second agent owns `backend/`.
Do not edit `backend/`, ever — if you need a field, an endpoint or a different response shape, stop
and say so.

Read `docs/ACCOUNTANT_MILESTONE.md` for the plan and `docs/FRONTEND_BRIEF.md` for the task list.
This file is the operating manual: how to work, what never to do, and how to prove a task is done.

---

## 1. Facts about this repo you must know before you touch anything

- `apps/web` is **Vite 7, React 19, TypeScript 5.9, Tailwind v4, shadcn/ui primitives, react-intl,
  react-router 7**. Package manager is **pnpm 10** in a Turborepo.
- The API client is **generated** at `packages/shared/src/generated/api-client.ts` by
  `pnpm generate:api-client`. It is committed. Never hand-edit it.
- **There is no data grid, no query layer and no form layer.** `src/components/ui/table.tsx` is 52
  lines of styled `<table>` primitives. `package.json` has no TanStack, no react-hook-form, no
  AG Grid. Task F1 is where that changes.
- **`CLAUDE.md` at the repo root is 183 KB and partially stale** — it describes a scaffold that no
  longer matches the code. Read code before trusting a document.
- **`git status` lies.** ~348 files show as modified; `git diff --ignore-all-space --stat` is empty.
  It is pure CRLF churn. See rule 1.
- Every nav item already has a real page. `ComingSoon.tsx` is a fallback nothing routes to.

---

## 2. Hard rules. Breaking any of these is a failed task.

1. **Never commit line-ending churn.** Stage files by name. Never `git add -A` or `git add .`.
   Before committing, run `git diff --cached --ignore-all-space --stat` and confirm every listed
   file is one you meant to change.
2. **Never compute money in the browser.** Totals, VAT, discounts, balances and aging are rendered
   exactly as the API returns them. If a figure you need is missing from a response, **stop and ask
   for it** — do not derive it, not even a subtotal, not even "just this once".
3. **All data access goes through the generated client.** No hand-written `fetch`, no `axios`.
   Re-run `pnpm generate:api-client` after the backend announces a contract commit.
4. **Every list is the DataGrid from F1.** No bespoke `<table>`. If a screen needs something the
   grid cannot do, extend the grid, do not work around it.
5. **Every user-visible string is added to `src/i18n/messages.ts` in both EN and SQ.** Add keys.
   **Never rename or delete an existing key** — the standing convention is that old keys stay,
   unused.
6. **No `localStorage`, `sessionStorage` or IndexedDB for anything that matters.** Remembered column
   choices and collapsed sections, fine. Anything an accountant would be upset to lose goes to the
   API.
7. **Filters, page, sort and the selected period live in the URL** as query params. Screens must be
   linkable, bookmarkable and reload-safe. Accountants send each other links.
8. **Never reformat or "tidy" a file you were not asked to change.** No drive-by renames, no import
   reordering.
9. **Do not add a dependency without saying so in the commit body.** Check it is not already there —
   `zod` is already a workspace dependency.

---

## 3. Working against contracts, not implementations

The backend lands each capability as a **contract commit first**: records, a stub controller
returning a realistic fixture, the regenerated client, and the same fixture as JSON at
`apps/web/src/mocks/<endpoint-name>.json`.

**Start the screen the day the contract lands, not the day the implementation does.** Wire the page
to the generated client and serve the fixture as the mock response until the real endpoint exists.
Do not invent fields that are not in the contract; if the fixture lacks something the screen needs,
stop and ask.

---

## 4. Design rules — these are requirements, not taste

- **Density.** ~30px rows, **not** shadcn's 48–56px default. `font-variant-numeric: tabular-nums`
  on every numeric column, right-aligned. An accountant expects forty rows on screen, not twelve.
- **Keyboard model in every editable grid — this is Excel's, and it is not optional.** Arrow keys
  move between cells. Enter commits and moves down. Tab moves right and wraps to the next row.
  Escape reverts the cell. A block of cells pasted from the clipboard fills the rows.
- **Show state in form, not only in words.** Draft muted, cancelled struck through, overdue flagged,
  locked period visibly locked.
- **Errors say what happened and what to do.** "Cannot post: September is closed (tax lock
  30.09.2026)" — never "An error occurred".
- Keep the existing visual language. Tailwind v4 + shadcn is settled; do not restyle the app.

---

## 5. How to verify. Run these; do not claim a task is done without them.

```bash
pnpm install
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

A task is done when: those four pass, the screen works against the fixture **and** against the real
endpoint once it lands, every new string exists in EN and SQ, and
`git diff --cached --ignore-all-space --stat` lists only files you intended to change.

---

## 6. Stop and ask. Do not guess on these.

- **F9** — what autofills the journal line description: the account name, the header description, or
  the line above?
- **F3** — who may grant a lock exception: owner only, or any firm member?
- **F5** — what should the item form do when the three default accounts are empty?
- Any time a figure you need is not in the API response.
- Any time a task seems to require editing `backend/`.

---

## 7. Task order

### Phase 0 — before anything else

- **P0.1** Help resolve the Track C rebase. Six of the ~36 conflict hunks are yours:
  `InvoiceForm.tsx`, `BillForm.tsx`, `Invoicing.tsx`, `Bills.tsx`, `InvoiceDetail.tsx`,
  `BillDetail.tsx`, plus `messages.ts`. For `messages.ts`, keep **both** sides' keys — the
  convention is additive.
- **P0.2** Choose and land the three missing libraries. Recommended: **TanStack Table** (headless,
  composes with shadcn), **TanStack Query** (server state), **react-hook-form + zod** (zod is
  already a workspace dependency). AG Grid Community is the alternative — more out of the box,
  heavier, and its own styling to fight. Prove the stack with one throwaway screen, then delete it.
  **Nothing else starts until F1 exists.**

### Checkpoint 1 — the accountant owns their chart

- **F1 — The grid foundation.** The highest-leverage task in the whole milestone. Build once:
  per-column filters · drag a column to group by it · footer totals per numeric column · show/hide
  columns, remembered per user · server paging and sorting driven from URL params · row decoration
  by state · multi-row selection and edit · Excel export · a loading skeleton that does not reflow
  the table.
  *Done when:* a new register can be put on screen with a column definition and an endpoint, and
  gets all of the above without writing any of it. Prove this by building F2 on it without touching
  the grid.
- **F2 — Chart of accounts.** Tree grouped by the code-prefix groups the API returns. Add under a
  group, edit, deactivate. Group and subgroup shown as inherited and read-only. Surface the
  behaviour flags — control, postable, subledger, VAT code, CIT treatment, cash-flow category —
  because an accountant who cannot see *why* a posting was refused assumes the software is broken.
- **F3 — Lock dates in settings.** Five dates (global, tax, sale, purchase, hard), each with a
  plain-language explanation, plus the exception list — who, why, until when — with grant and
  revoke. The hard lock needs a confirmation that says plainly it cannot be undone.
  *Done when:* posting into a locked period shows a message naming the lock and its date.
- **F4 — Accountant landing.** The business list becomes the post-login screen for a firm member.
  Search; last-opened first.

### Checkpoint 2 — the registers become real

- **F5 — Item register.** List on the grid; form with type, unit, barcodes, VAT code and three
  account pickers. Then an item picker on invoice and bill lines that pulls the item's defaults onto
  the line and shows clearly when it has overridden something.
- **F6 — Partner form.** Control account, payment terms, credit limit, fiscal number, VAT status.
  The partner picker shows VAT status inline — that is what decides the tax code on the document.
- **F7 — Numbering settings and preview.** Pattern per document type and year. Next-number preview
  on the create form, **labelled provisional** — the number is reserved only on post, and showing
  one number then issuing another is worse than showing none. The override field appears only when
  the company setting allows it.
- **F8 — Paged registers everywhere.** Retro-fit the grid onto invoices, bills, partners and journal
  entries as each paged endpoint lands.

### Checkpoint 3 — the month can be filed

- **F9 — The manual journal grid.** The screen that decides whether accountants adopt PAKO. Columns:
  account, description, debit, credit, partner, analytic distribution. Full Excel keyboard model.
  Running debit and credit totals with the difference live. Auto-balance the last line on request.
  Save refused while unbalanced, and the refusal names the amount.
  *Done when:* a twelve-line entry can be keyed without touching the mouse.
- **F10 — Reports with exports.** Export button on every report, and a period selector that knows
  which periods are locked.
- **F11 — Attachments.** Drop a file on an invoice or bill, thumbnail, open the original. Leave room
  in the layout for an extracted-fields panel beside the preview — OCR plugs in here later.
- **F12 — Year-end and analytic distribution.** The roll-forward screen, and a distribution editor
  that splits a line across analytic accounts by percentage and refuses to save at anything other
  than 100%.
