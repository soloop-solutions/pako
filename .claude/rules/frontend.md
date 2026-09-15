---
paths:
  - "apps/web/**"
---

# Frontend rules

These load when you touch `apps/web/`. The full task list with acceptance criteria is
`docs/FRONTEND_BRIEF.md`; the operating manual is `docs/AI_FRONTEND_AGENT.md`.

## Never

- **Never compute money in the browser.** Totals, VAT, discounts, balances and aging render exactly
  as the API returns them. If a figure is missing from a response, stop and ask for it — do not
  derive it, not even a subtotal.
- Never write a raw `fetch` or add `axios`. All data goes through
  `packages/shared/src/generated/api-client.ts`. Never hand-edit that file; regenerate it.
- Never build a bespoke `<table>`. Every list uses the DataGrid from task F1. If a screen needs
  something the grid cannot do, extend the grid.
- Never rename or delete a key in `src/i18n/messages.ts`. Old keys stay, unused, by convention.
- Never use `localStorage`, `sessionStorage` or IndexedDB for anything an accountant would be upset
  to lose. Remembered column choices are fine; data is not.
- Never edit `backend/`. If you need a field or an endpoint, stop and say so.

## Always

- **Every new string in EN and SQ**, in `src/i18n/messages.ts`.
- **Filters, page, sort and selected period live in URL query params** — screens must be linkable,
  bookmarkable and reload-safe.
- **Start a screen the day its contract lands**, against the fixture in `src/mocks/`, not the day
  the implementation does.
- **Verify before claiming done**: `pnpm --filter web typecheck`, `lint`, `test`, `build`.

## Design rules — requirements, not taste

- **Density.** ~30px rows, not shadcn's 48–56px default. `font-variant-numeric: tabular-nums` on
  every numeric column, right-aligned. Forty rows on screen, not twelve.
- **Excel keyboard model in every editable grid.** Arrows move between cells; Enter commits and
  moves down; Tab moves right and wraps; Escape reverts the cell; a pasted block of cells fills the
  rows. Users spend eight hours a day in Excel — a grid that needs a mouse loses to it.
- **State shows in form, not only in words**: draft muted, cancelled struck through, overdue
  flagged, locked period visibly locked.
- **Errors say what happened and what to do**: "Cannot post: September is closed (tax lock
  30.09.2026)", never "An error occurred".
- Keep the existing visual language. Tailwind v4 + shadcn is settled; do not restyle the app.

## Stop and ask

What autofills a journal line's description; who may grant a lock exception; what the item form
does when its three default accounts are empty; any time a figure you need is not in the response.
