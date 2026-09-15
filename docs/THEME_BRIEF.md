# PAKO theme brief — input for Claude Design

Attach this together with `apps/web/src/index.css` and the exported blueprint PNGs.
What we want back is **a token block that drops into `apps/web/src/index.css`**, not a picture.

---

## 1. What PAKO is, and who stares at it

Accounting and ERP software for Kosovo SMEs and accounting firms. The primary user is a
**bookkeeper at an accounting firm** who has PAKO open eight hours a day, carries **up to a hundred
client companies**, and spends most of that time keying documents rather than browsing them. Their
benchmark is not a modern SaaS app — it is FINAbit, a Windows desktop application from a different
era, and Excel.

They will judge the interface on rows visible per screen and keystrokes per line before they judge
it on anything else.

The interface is **bilingual, Albanian first**. Albanian labels run roughly 15–25% longer than the
English equivalents (`Faturat e shitjes`, `Deklarata e TVSH-së`, `Shfaq më shumë`) — the type scale
and control widths have to survive that without wrapping.

## 2. Current state — there is no theme yet

`apps/web/src/index.css` is the **stock shadcn/ui token file, unmodified**. Every colour is
`oklch(… 0 0)` — pure greyscale, zero chroma. `--primary` is near-black. There is no brand colour
anywhere in the product; the only asset is `public/favicon.svg`.

So this is not adjusting a theme. It is creating the first one.

## 3. The contract the output must fit

Stack: **Vite 7 · React 19 · TypeScript 5.9 · Tailwind v4 (CSS-first, no `tailwind.config.js`) ·
shadcn/ui primitives**.

Fill the existing token names in `:root` and `.dark`, in `oklch()`:

```
--background --foreground --card --card-foreground --popover --popover-foreground
--primary --primary-foreground --secondary --secondary-foreground
--muted --muted-foreground --accent --accent-foreground
--destructive --border --input --ring --radius
```

Keep the `@theme inline` mapping block as it is. **Do not propose a different component library**
and do not restructure the token file — anything that does not paste into this file is not usable.

## 4. What the stock token set is missing

shadcn ships `--destructive` and nothing else semantic. An accounting interface needs more, because
document state is shown as colour on every register row. Please add and define, light and dark:

| Token | Used for |
| --- | --- |
| `--success` / `--success-foreground` | paid, balanced entry, difference 0.00, open period |
| `--warning` / `--warning-foreground` | overdue, unsaved changes, credit limit passed, approaching a lock |
| `--info` / `--info-foreground` | posted, informational banners |
| `--neutral-state` / `--neutral-state-foreground` | cancelled, inactive, archived |
| `--debit` / `--credit` | optional, very low-chroma tints for the two money columns |

These must stay legible as **small text on a tinted pill** at 10.5px, in both themes.

## 5. Non-negotiables

- **Density.** Table rows are **~30px**, not shadcn's 48–56px default. Controls are 28px. If the
  theme's spacing scale fights that, the theme is wrong. An accountant expects forty rows on screen.
- **Figures.** Every numeric column is right-aligned with `font-variant-numeric: tabular-nums`. The
  body face must have proper tabular figures, or pair a mono face for numbers.
- **Dark mode is required**, not optional — these people work late in September and at year end.
- **Colour must survive greyscale.** Registers get printed. State must still be distinguishable when
  the colour is gone, which is why the blueprints use dashed borders and strikethrough alongside tint.
- **One accent, used sparingly** — primary actions, focus rings, the active tab and the selected row.
  Everything else is neutral. A register with six colours in it is unreadable at forty rows.
- **Focus states must be obvious.** The manual journal grid is driven entirely by keyboard; the user
  must always know which cell is live.

## 6. Please avoid

Purple as the primary (it reads as Odoo to anyone in this market) · gradient heroes and glassmorphism
· Inter and Roboto · heavy shadows — this UI is dense, and shadows on dense rows turn to mud ·
radii above ~6px on controls, which waste horizontal space at this density · emoji as state icons.

## 7. What to hand back

1. The complete `:root` and `.dark` token blocks, in `oklch()`, ready to paste.
2. The type choice: a display/UI face and, if the UI face lacks tabular figures, a mono face for
   numerals — with a real fallback stack for each.
3. One worked example applying the tokens to the register row: header, normal row, zebra row,
   selected row, and the five state pills.
4. A short note on anything you changed from the blueprints and why.

## 8. Attached alongside this brief

- `apps/web/src/index.css` — the contract above, as it exists today
- Blueprint PNGs — register, document, journal grid, sidebar states (structure only; they are
  deliberately greyscale and are *not* a proposed look)
- FINAbit screenshots — **the density benchmark, not a style reference.** Match how much fits on a
  screen; do not match how it looks.
- `docs/ODOO_COMPARISON.md` and the layout brief — the reasoning behind the anatomy
