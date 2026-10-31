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

## First run (local development)

```bash
pnpm install
docker compose -f backend/docker-compose.yml up -d        # Postgres on :5433
dotnet run --project backend/Pako.Api/Pako.Api.csproj --launch-profile http   # API on :5248
pnpm --filter web dev                                     # web app
```

The API applies every pending database migration when it starts, so after a `git pull` just restart
it. There is no public sign-up: people request an account and a PAKO administrator approves it.

**The first administrator.** On startup, if the database has no administrator at all, the API
creates the account in `Platform:BootstrapAdmin`. If that email already has an account, it is made
an administrator and its password is left as it is. In development that is:

| Email | Password |
| --- | --- |
| `test@test.com` | `Test123!` |

Sign in with it, open **Administration** from the company list, and approve account requests or
manage users from there. Once any administrator exists this does nothing. For a shared or
production server, set `Platform__BootstrapAdmin__Email` and `Platform__BootstrapAdmin__Password`
as environment variables for the first start, then change the password and remove them. Details
are in `docs/PLATFORM_ADMIN.md`.

Optional demo data: `python3 scripts/seed_demo.py --owner test@test.com` creates a demo company
with about two years of activity and gives that account access.
