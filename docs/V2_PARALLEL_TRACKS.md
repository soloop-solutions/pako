# v2 release — three parallel tracks

Planned 8 Sep 2026 against `main` @ f92d7e6. Source: the 28-item meeting list.
Full write-up (same content, readable form): https://claude.ai/code/artifact/2859c6f8-069d-4274-b014-c9558512d3db

**Scope.** Backend + `apps/web`. **No stock in this release** — the item register lands
(code, name, barcodes, defaults) but no quantities on hand, no warehouses, no valuation,
no landed cost. Untouched: OCR capture, SEF, ATK book exports, `apps/mobile`.

---

## Sprint 0 — one day, one developer, three reviewers

Nobody branches until this is on `main`.

- **S0.1** Move numbering out of `Invoice.Post()` / `Bill.Post()` into an injected
  `IDocumentNumberService`, called by the controller inside the existing post transaction.
  Removes the Track A / Track B collision in `Invoice.cs`.
- **S0.2** Extract the per-line gross → discount → VAT → net block from the `foreach (var line in Lines)`
  loop into `DocumentLineCalculator`, behaviour unchanged, existing tests green.
  Removes the Track A / Track C collision.
- **S0.3** One additive EF migration containing everything all three tracks need, nullable/defaulted
  so it is inert until wired up: `Partner.FiscalNumber`, `Partner.IsVatRegistered`, `Item`,
  `ItemBarcode`, `InvoiceLine.ItemId`, `BillLine.ItemId`, `NumberSeries`, `DocumentNumberAudit`,
  `PaymentMethod`, `Invoice.PriceMode`, `Invoice.GraceDays`, new `DocumentType` values.
- **S0.4** Migration rule for the rest of the release: one migration per day, announced; rebase on
  `main` before generating; never edit a migration that has already merged.
- **S0.5** Move the test suite from EF InMemory to Testcontainers. All 159 tests currently run on a
  provider with no unique indexes, no triggers and no row locking — exactly what B3 and C3 depend on.

---

## Track A — Documents & corrections (items 2, 11, 12, 13, 14, 15, 22, 24, 25)

Owns: `Pako.Domain/Invoicing/Invoice.cs`, `Pako.Domain/Bills/Bill.cs`, `InvoicesController.cs`,
`BillsController.cs`, `apps/web/src/config/nav.ts`, `apps/web/src/pages/invoicing/*`, `pages/bills/*`.

- **A1 — Sales return as its own document type** (11, 12, 15). Add `SalesReturn`; posts with the
  existing `isCreditNote` mechanics (flip debit/credit, no negative amounts), own number series,
  own label, requires `OriginalInvoiceId`. The 1000 EUR case = two documents, original untouched.
  *Done when:* full or partial return, refuses to exceed the original, the pair nets to zero.
- **A2 — Purchase return** (15). Same shape on `Bill` against `OriginalBillId`. Build right after A1.
- **A3 — Proforma** (13, 14). Must NOT post a journal entry, NOT consume the fiscal invoice series,
  NOT appear in the VAT return. Own `PRO-` series + "Convert to invoice" action.
  *Done when:* a test asserts issuing one produces zero `journal_entries` rows and does not advance
  the invoice counter.
- **A4 — No deletion, enforced and tested** (11). There is no DELETE endpoint today; make that a
  guarantee with a test. Decide whether an unposted draft may be discarded (recommended: yes).
- **A5 — Editability policy** (22). *Blocked on D1.* Draft = fully editable. Posted = short whitelist
  of non-accounting fields, each edit writing an audit row; amounts/VAT/partner go through storno + reissue.
- **A6 — Sale or purchase, explicit** (2, 24). Split the sidebar by document type; each type gets its
  own route and form variant.
- **A7 — Rename the purchase-invoice reference label** (25). `VendorReference` → "numri i faturës së
  blerjes", two strings in `messages.ts`, EN + SQ. ~20 minutes, day one.

## Track B — Registers & numbering (items 1, 5, 6, 7, 8, 9, 10, 16, 19, 20, 21, 26)

Owns: `Company.cs`, `Partner.cs`, new `NumberSeries.cs` / `Item.cs` / `ItemBarcode.cs`,
`DocumentNumberService.cs`, `PartnersController.cs`, new `ItemsController.cs`,
`apps/web/src/pages/Settings.tsx`, new `pages/items/*`.

- **B1 — Configurable number series** (6, 7). Replace the four `Next*Number` counters on `Company`
  with a `NumberSeries` table keyed by (company, document type, year) holding a pattern + next value.
  Default `{seq:00}/{yyyy}` → `01/2026`; editable per company; year resets to 1.
- **B2 — Preview the next number** (5). Preview endpoint + display on the create form, labelled
  provisional — the number is only reserved on post. Showing one number and issuing another is worse
  than showing none.
- **B3 — Gapless and strictly increasing** (8). Generalise the existing `SELECT … FOR UPDATE` pattern
  to every series; unique index on (company, type, year, sequence); add a gap-detection report.
  *Done when:* 50 parallel invoices produce 50 consecutive numbers — needs S0.5.
- **B4 — Manual number override** (9, 10). *Blocked on D2.* Off by default, per company. Entered
  number must be free, in the current year's series, not below the highest issued. Every override
  writes to `DocumentNumberAudit` (user, timestamp, old, new). Skipped numbers are reserved, not lost.
- **B5 — Partner fiscal number + VAT status** (1, 26). `FiscalNumber` for the natural-person case,
  `IsVatRegistered` to drive the with/without-VAT distinction; surface it on the partner picker.
- **B6 — Item register** (16, 19, 20, 21). `Item` with a per-company ordinal from the same series
  machinery (1…35000+), name, unit, default tax + accounts. `ItemBarcode` child table, many per item,
  unique per company. `InvoiceLine.ItemId` / `BillLine.ItemId` nullable so free-text lines keep
  working; the line shows the ordinal. **No quantities, no valuation.**
- **B7 — Pagination + search** (consequence of 20). There is no pagination anywhere in the API today.
  Add paging + search on items (code, name, barcode) and establish the pattern for other endpoints.

## Track C — Price, payment & debt (items 3, 4, 17, 18, 23, 27, 28)

Owns: `DocumentLineCalculator.cs` (new, from S0.2), `TaxComputationService.cs` (read-only),
new `PaymentMethod.cs`, `ReconciliationContracts.cs`, `InvoicesController.RecordPayment`,
`pages/shared/RecordPaymentForm.tsx`, the `InvoiceForm` / `BillForm` line editor, `Dashboard.tsx`.

- **C1 — VAT inside the price, or price plus VAT** (18). Add `PriceMode` (`GrossInclusive` |
  `NetExclusive`) on the document, defaulting to gross so nothing changes for existing users; the
  totals panel always shows net / VAT / gross. Highest-risk change in the release — partially
  reverses commit d966269. *Done when:* the same invoice entered both ways produces an identical
  journal entry across 18%, 8%, 0%, exempt and RC18.
- **C2 — "Pa tatim" becomes a real code** (17). The dropdown's empty first option posts a line with
  no tax code — invisible to the VAT return and the ATK books. Use the already-seeded `SEX`
  ("Shitje e liruar (pa kredi)") on sales and `BEX` ("Blerje e liruar") on purchases; keep a genuine
  no-tax option only for non-VAT-registered companies.
- **C3 — Payment while creating the invoice** (23). Optional payment on the create request
  (amount, method, date); invoice post + payment in one transaction. Partial is the normal case.
  *Done when:* 300 invoiced / 200 cash / 100 outstanding, and either both postings succeed or neither.
- **C4 — Payment methods split cash vs bank** (28). `PaymentMethod` with `Kind` = Cash | Bank, each
  bound to its ledger account; picker grouped by kind. The ledger account stops being user-facing.
- **C5 — Cash at creation, bank afterwards** (27). Bill create accepts a cash method, rejects a bank
  one; transfers are recorded later through the existing payment route. Deliberate friction that
  keeps the bank account honest against the statement.
- **C6 — Debt and the waiting period** (3, 4). Payment terms + grace days on the document, due date
  derived, aging built on existing reconciliation data: current / within grace / overdue. Nothing is
  *borxh* until due date + grace has passed.

---

## Decisions needed before the code is written

- **D1 (blocks A5)** — how far does "editable after creation" go? Recommendation: after posting,
  only the number (via B4), the due date and internal notes; everything else via storno + reissue.
- **D2 (blocks B4)** — who may change an invoice number? Recommendation: company-level setting, off
  by default, plus the owner role.
- **D3** — what happens to documents already numbered `INV-0001`? Recommendation: never renumber
  issued documents; seal the old series, start the new pattern at a year boundary or on opt-in, and
  record which pattern was in force for which range.
- **D4** — does ATK accept "kthim i shitjes" as a nota kreditore? Confirm with the partner firm
  before A1 is built; it determines which ATK book the document lands in.
- **D5** — is the VAT-inclusive choice per document or per line? Recommendation: per document.

## Working agreements

- Nobody branches before Sprint 0 is on `main`.
- One EF migration per day, announced; rebase before generating; never edit a merged migration.
- `packages/shared` and the NSwag client change by their own small PR, reviewed same day.
- After Sprint 0: Track A owns `Invoice.cs`, Track B owns numbering, Track C owns the calculator.
  Needing to reach into another track's file is a signal to talk, not to edit.
- `messages.ts` keys are added, never renamed — additions merge cleanly, renames do not.
- Track C waits for S0.5; C1 and C3 make guarantees InMemory cannot test.
- `README.md`, `ARCHITECTURE.md` and `ROADMAP.md` still describe the repo as of 26 Aug. Each track
  fixes the section it touches.
