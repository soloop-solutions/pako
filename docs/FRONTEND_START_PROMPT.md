# Frontend start prompt — paste into Claude Code

> Paste everything below the line into a fresh Claude Code session opened at the
> repo root, after Claude Design has given you `index.css`.

---

You are the frontend developer on PAKO. Work only in `apps/web` and
`packages/shared`; never touch `backend/`.

Read these first, in this order, then start:

- `CLAUDE.md` — stack, commands, repo hazards
- `docs/SHELL_SPEC.md` — the shell: theme intake, tabs, sidebar, density, register
  and document anatomy, journal keyboard contract. This is the spec of record for
  everything below.
- `docs/FRONTEND_BRIEF.md` — tasks F1–F12 with acceptance criteria
- `docs/AI_FRONTEND_AGENT.md` — how you operate, stop conditions
- `docs/blueprints/*.html` — open them in a browser. They are STRUCTURE, not a
  proposed look. The look comes from the theme file described below.

## What you are building

A desktop accounting workspace for Kosovo accountants, in Albanian, used all day
by people who currently use FINAbit (a Windows desktop ERP) and expect its speed:
keyboard-first, dense, many documents open at once. It must not feel like a
generic SaaS dashboard.

## Do these in order. Do not skip ahead.

### 1. Take the theme handoff

A file `index.css` (or a token block) has been produced by Claude Design against
the contract in `docs/THEME_BRIEF.md`. Replace `apps/web/src/index.css` with it.

Then, before anything else:

1. **Every new token added to `:root` must also be mapped in `@theme inline`.**
   Tailwind v4 is CSS-first here — there is no `tailwind.config.js`. A token that
   exists only in `:root` will not produce a utility class. For each new token
   `--success`, add `--color-success: var(--success);` inside `@theme inline`, or
   `bg-success` silently does nothing.
2. Check the dark block is present and complete. If Claude Design shipped light
   only, stop and say so — do not invent dark values.
3. Run `pnpm --filter web build` and confirm it passes.
4. **Prove the theme on ONE existing screen before restyling anything else.**
   Pick the current invoice list. Make it correct against the theme, look at it,
   fix what is wrong in the tokens. Only then move on. Do not do a sweeping
   restyle of the whole app on an unproven theme.
5. Delete nothing from `index.css` that shadcn components depend on
   (`--background`, `--foreground`, `--border`, `--ring`, `--radius`, the chart
   and sidebar tokens). Add, don't replace.

Commit this on its own: `feat(web): apply design system tokens`.

### 2. Land the three missing libraries

Add, in one commit, with nothing built on them yet:

- `@tanstack/react-table` — the grid engine for every register
- `@tanstack/react-query` — server state, so lists refetch after a post
- `react-hook-form` + `@hookform/resolvers` — document forms (`zod` is already a
  workspace dependency; reuse it, do not add a second validator)

No other UI libraries. No AG Grid, no MUI, no Chakra, no date library beyond what
is already installed. shadcn/ui components are added with the shadcn CLI into
`apps/web/src/components/ui` and then edited in place — that is the intended
workflow, they are our source.

### 3. Build the shell

This is the part that decides whether the app feels like FINAbit or like a
website. `docs/SHELL_SPEC.md` §2–§4 is binding; the summary:

**Tabs.** The workspace holds many open documents at once. Opening
`Faturat e shitjes` opens a tab; opening `Urdhëresat` opens a second; both stay
open and switching between them is instant, with scroll position and unsaved edits
intact.

**Every tab is a route.** This is the one rule that must not be compromised. A tab
is `{ id, path, title, icon, dirty }` and the active tab's `path` is the browser
URL. That gives us, for free, what a pure in-memory MDI would throw away: the back
button works, a URL can be pasted to a colleague and opens as a tab, refresh
restores the workspace, and deep links from notifications land correctly. Persist
the open-tab list per user (localStorage keyed by user + company is fine for now)
and restore it on login.

- Registers are **singletons**: opening `Faturat e shitjes` when it is already open
  focuses that tab, never opens a second.
- Records are **instances**: each invoice opens its own tab, titled with the
  document number, and a new unsaved one is titled `Faturë e re`.
- Unsaved changes show as an **amber dot** on the tab, not an asterisk.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle, `Ctrl+W` closes, middle-click closes.
- Tab strip height 36px. Do not let it grow.
- Two decisions are open — implement the simplest version and leave a `TODO`
  naming the alternative: what tab overflow does (horizontal scroll vs a `+6`
  menu), and what closing a dirty tab does (prompt vs keep the draft silently).

**Sidebar.** Always visible, 236px, scrolls independently of the page, never
auto-collapses. It carries two mechanisms that look similar and are not — do not
merge them:

- **`Shfaq më shumë`** at the bottom of a category reveals **hidden destinations**
  in that category. Which items are visible when collapsed is **per user**, chosen
  by the user, saved. Categories themselves never hide.
- **`▾` on an item** opens **saved views of that same destination** — filters with
  live counts, e.g. `Faturat e shitjes ▾` → `Të papaguara (23)`, `Skaduara (7)`.
  These are filters on one register, not new pages.

**Favourites** sits pinned at the top and can hold anything the user pins,
including create actions (`Faturë e re`), not only destinations.

The sidebar filter box searches **all** items including the hidden ones — a user
must be able to find `Normativi` by typing it even if it is not currently shown.

**Density.** 30px grid rows, 28px controls, `font-variant-numeric: tabular-nums`
on every number so columns of money align. Numbers right-aligned, text
left-aligned, dates `dd.MM.yyyy`.

Commit the shell before building a register on it.

### 4. F1 — the DataGrid

One component every register uses. Built on TanStack Table. It owns, per
`docs/SHELL_SPEC.md` §5: the action row, the group-by zone, Σ column headers, a
permanent filter row under the headers (not a hidden panel), a row-number gutter,
page totals and a `filtered / total` count in the footer, column show/hide/reorder
persisted per user, and status rendered as **form** not only words — draft dashed,
cancelled struck through, overdue tinted.

Filter, sort, page and group-by state lives **in the URL**, so a tab restores to
exactly what the user was looking at.

### 5. The first register on it

Rebuild the sales invoice list on the DataGrid, end to end, and make it good
before generalising to the other registers. Then move down `docs/FRONTEND_BRIEF.md`.

## Working rules

- **Never compute money in the browser.** No totals, no VAT, no rounding, no
  currency conversion in TypeScript. Display what the API returns. If a number you
  need is not on the DTO, that is a backend task — say so, do not calculate it.
- **The API client is generated.** Regenerate it from the backend's OpenAPI with
  the NSwag script; never hand-write a fetch against the API, never hand-edit the
  generated file.
- **Albanian is the product language, English is the fallback.** Every string goes
  through react-intl with both `en` and `sq` present. **Add keys, never rename
  them** — a renamed key breaks a translation silently.
- Accounting terms use the accountant's words, not translations of English UI:
  `Fatura e shitjes`, `Urdhëresa`, `Nota kreditore`, `Libri i shitjes`, `Llogaria`,
  `Debi` / `Kredi`, `Gjendja`.
- Keyboard before mouse. Every action a user does more than twice a day needs a
  shortcut, and the journal grid follows the Excel contract in
  `docs/SHELL_SPEC.md` §7 — Enter down, Tab right, typing replaces, F2 edits,
  paste from Excel fills the block.
- Loading states are skeletons of the real layout, not spinners. Empty states name
  the next action.

## Verify before every commit

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

All four must pass. No `any`. No `@ts-expect-error` without a comment saying what
is being suppressed and why.

## Git — read this carefully

The working tree shows ~348 modified files that are **pure CRLF churn**
(`git diff --ignore-all-space` on them is empty).

- **Never run `git add -A`, `git add .`, or `git commit -a`.**
- Stage files **by name**, only the ones you actually changed.
- Before every commit run `git diff --cached --ignore-all-space --stat` and confirm
  that only your files are listed.

## Stop and ask instead of guessing

- The theme handoff is missing dark mode, or a token the brief required.
- A number you need for display is not on any DTO.
- A screen needs an endpoint that does not exist.
- You are about to add a fifth dependency.
- You are about to change anything under `backend/`.
- A blueprint and this prompt disagree — this prompt and `docs/SHELL_SPEC.md` win.

Start with step 1 and report after each numbered step.
