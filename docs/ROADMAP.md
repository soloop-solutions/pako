# Roadmap

**2026-09-08: this doc's original Phase 0-4 plan is complete — every phase below landed, several
built ahead of their originally planned slot at Erion's direction.** The live plan going forward is
`docs/V2_PARALLEL_TRACKS.md` (Sprint 0 + Tracks A/B/C for the v2 release); this file now exists as
a historical record of the build-up to v1, not an open plan.

## What's built (as of 2026-09-08)

- **Backend** (ASP.NET Core/.NET 10 + EF Core + Npgsql): `Ledger` (GL core — chart of accounts,
  journals, journal entries, debit=credit invariant, posted-entry immutability), Kosovo Plani
  Kontabel v2.0 (233-account standard chart, profile-filtered per company, VAT/withholding codes,
  the posting rules from `60_Posting_Rules` that had a buildable prerequisite), `Tax`,
  `Invoicing` (AR, incl. credit/debit notes, down payments, per-line discounts, reverse charge),
  `Bills` (AP), `Reconciliation`, `Payroll`-to-GL, `Reports` (P&L/balance sheet/VAT return/CIT
  add-back), `Companies`/`Firm`/`Membership` multi-tenant auth (self-hosted JWT, not Supabase).
  See `docs/ARCHITECTURE.md`'s "Module breakdown" for the real per-module detail.
- **Frontend**: `apps/web` and `apps/mobile` both wired end-to-end to the live API across every
  module above (mobile's scope is narrower by design — no standalone Payroll/Reconciliation
  screens). `apps/web` has English/Albanian i18n infrastructure, translations filled in
  incrementally.
- **Not yet built**: stock/inventory (deliberately out of the v2 release too — see
  `docs/V2_PARALLEL_TRACKS.md`'s scope note), OCR capture, the real SEF e-invoicing integration
  (`SefProvider` is still a documented stub — ATK's SEF API/portal has been open since June 2026,
  but the integration itself hasn't been built), ATK book exports.

## What's next: the v2 release

`docs/V2_PARALLEL_TRACKS.md` is the plan of record. Shape, briefly:

- **Sprint 0** (one day, one developer, three reviewers) — remove the file-level collisions
  (`Invoice.cs`/`Bill.cs`) that would otherwise block three tracks from branching in parallel:
  extract document numbering into `IDocumentNumberService`, extract the per-line VAT math into
  `DocumentLineCalculator`, land one additive migration with everything all three tracks need,
  move the test suite onto Testcontainers, and fix this doc's staleness (this rewrite).
- **Track A — Documents & corrections**: sales/purchase returns, proforma invoices, an explicit
  no-deletion guarantee, a posted-document editability policy, sale/purchase split in the UI.
- **Track B — Registers & numbering**: configurable per-company number series (replacing the flat
  `Next*Number` counters), a next-number preview, gapless/strictly-increasing numbering under
  concurrency, manual number override with an audit trail, partner fiscal number/VAT status, the
  item register (code/name/unit/barcodes/defaults, no stock).
- **Track C — Price, payment & debt** (built on branch `track-c/price-payment-debt`, not yet
  merged to main — see CLAUDE.md's "v2 Track C" section for the full detail and verification):
  VAT-inclusive vs. VAT-exclusive price entry, a real "no tax" code instead of a silent empty
  option, payment recorded at invoice-creation time, payment methods split cash vs. bank, and
  payment-terms/grace-days-driven debt aging. S0.5 (Testcontainers) was not built by any track yet.

See that file for the full item list, the decisions still needed before certain tracks can start
(`D1`-`D5`), and the working agreements (nobody branches before Sprint 0 merges; the migration rule
now documented in `docs/ARCHITECTURE.md`'s Database section; `messages.ts` keys are added, never
renamed).
