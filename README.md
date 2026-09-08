# PAKO

Full accounting/finance platform for Kosovo SMEs and accounting firms, competing with ProData,
Kubit, and Bilanci under the live ATK SEF certification regime. See `CLAUDE.md` for repo layout
and conventions, `docs/ARCHITECTURE.md` for the module design, `docs/V2_PARALLEL_TRACKS.md` for
the current build plan (`docs/ROADMAP.md` covers the build-up to v1, now complete).

**Status (2026-09-08): the core platform is built and tested, not a scaffold.** Backend
(ASP.NET Core/.NET 10 + EF Core + Npgsql): Ledger (GL core, Kosovo Plani Kontabel v2.0 chart of
233 accounts), Tax (VAT/withholding, data-driven), Invoicing (AR, incl. credit/debit notes and
down payments), Bills (AP), Reconciliation, Payroll-to-GL, Reports (P&L/balance sheet/VAT return),
and self-hosted auth (JWT + Companies/Firms/Membership multi-tenancy) are all real, backed by a
real xUnit test suite. `apps/web` and `apps/mobile` are wired end-to-end to the live API across
every module above. Not yet built: stock/inventory, OCR capture, the real SEF e-invoicing integration, and ATK
book exports. The v2 release (see `docs/V2_PARALLEL_TRACKS.md`) is now in progress on top of this
— document numbering/registers, price-mode and payment-method work, and document corrections.
