# Implementation brief — Plani Kontabël v2.0 into PAKO

Source of truth: `docs/coa-v2/PAKO_Plani_Kontabel_v2.xlsx` (12 sheets) and
`docs/coa-v2/PAKO_COA_v2_seed.csv` (233 rows), copied into this repo alongside this brief.
Read them before writing any code. The CSV moves to
`backend/Pako.Localization.Xk/Data/` as an embedded resource in Stage 2. Every number, code,
rate and rule in this work comes from those files — do not invent, infer or "improve" values.

## Why this is not just a longer seed list

`Pako.Localization.Xk/DefaultChartOfAccountsTemplate.cs` currently holds 16 accounts with 4-digit
codes and four fields each (Code, Name, AccountType, AccountSubType). The v2.0 chart has 233
accounts with 6-digit codes and thirteen typed fields, and the posting rules depend on fields the
`Account` entity does not have. **This is a schema change to `Account`, `JournalEntryLine`,
`TaxDefinition` and `Company`, then a seed change.** Doing the seed first will not work.

Do this in the staged order below, one commit per stage, tests green at each stage.

---

## Stage 1 — Schema

One EF Core migration. No seeding, no rules yet.

### `Account` — add
| Field | Type | Source |
|---|---|---|
| `NameSq` | string | `10_COA_Master` col "Emri i llogarisë (SQ)" |
| `Class` | int (1–7) | col "Cls" |
| `Group` | int | col "Grp" |
| `Statement` | enum BS / PL | col "Stmt" |
| `NormalBalance` | enum Debit / Credit | col "Dr/Cr" |
| `Subledger` | enum None/Partner/Item/Asset/Employee/Bank/Cash/Tax/Customs | col "Subledger" |
| `IsControl` | bool | derived: control accounts are 110100, 110200, 200100, 200200 (R04) |
| `IsPostable` | bool | group/header rows are not postable (R02) |
| `DefaultVatCode` | string? FK to VAT code | col "VAT" |
| `CitDeductibility` | enum Full/Limit/Non/Na | col "CIT" |
| `CitLimitRule` | string? | note column where CIT = LIMIT |
| `Profiles` | flags enum Core/Import/Mfg/Serv/Payroll/IfrsPlus | col "Profile" |
| `IsActive` | bool, default true | R26 — deactivate, never delete |
| `ValidFrom` / `ValidTo` | DateOnly? | account versioning (R25) |

Keep `Code` as `string`; it becomes 6 characters. Keep the existing
`AccountType`/`AccountSubType` — derive them from Class and Subledger during seeding so nothing
downstream breaks in this stage.

**Hard invariant, enforce in a DB check constraint:** first digit of `Code` == `Class`, first two
digits == `Group`. The source file violated this (group 41 held 401xxx codes); `90_Migration` maps
the six renumbered codes.

### `JournalEntryLine` — add
- `CostCenterId` (Guid?, FK) — the analytic dimension. New `CostCenter` entity seeded from
  `40_Cost_Centers` (16 rows: code, name SQ, name EN, profile).
- `OriginalCurrency` (string?, ISO 4217), `OriginalAmount` (decimal?), `ExchangeRate` (decimal?) —
  required by R19. `Debit`/`Credit` stay in functional currency.

### `Company` — add
- `FunctionalCurrency` (string, default `"EUR"`) — R01.
- `EnabledProfiles` (flags enum) — which activation profiles this company uses.

### `TaxDefinition` — change
The current `TaxScope` enum (Sale/Purchase/Both) cannot express the v2.0 codes. Replace with:
- `Direction` — enum Out / In / Imp / Rc / None (`20_VAT_Codes` col "Drejtimi")
- `DeductiblePercent` — decimal 0 / 50 / 100 (col "E zbritshme")
- `IsReverseCharge` — bool (col "Ngarkesë e kundërt")
- `AtkBook` — enum Shitje / Blerje / BlerjeImport / BlerjeInvestime / None (col "Libri ATK")
- `Code` — string, the short code (S18, B08, RC18, NA …), unique per company

`Partner.TaxNumber` already exists and is what R07 needs — no change, but see Stage 4.

**Do not** touch the posted-entry immutability logic in `PakoDbContext`, the balance trigger, or
`TaxComputationService`'s rounding. They are correct.

---

## Stage 2 — Seed the chart

- Load the 233 accounts from `PAKO_COA_v2_seed.csv` as an **embedded resource** parsed at startup,
  not a 233-entry C# collection literal. The CSV is the artifact accountants will edit.
- Company creation instantiates a **copy** of the standard chart filtered by the company's
  `EnabledProfiles` — never a shared reference. Profile counts from `50_Profiles`:
  CORE 167, IMPORT 22, MFG 5, SERV 8, PAYROLL 13, IFRS+ 18. CORE is always on.
- Codes ending `90`–`99` in each group are **reserved for client-specific accounts** — the standard
  seed must never occupy them, so future chart upgrades cannot collide.
- Add a startup validation test: every seeded row satisfies the class/group invariant, every
  `DefaultVatCode` resolves to a real VAT code, every `CitDeductibility = Limit` row has a
  `CitLimitRule`.

### Breaking change to fix in the same stage
`InvoicesController` and `BillsController` reference account codes through
`DefaultChartOfAccountsTemplate.AccountsReceivableCode` (`"1200"`), `AccountsPayableCode`
(`"2000"`), `DefaultRevenueAccountCode`, `CustomerDepositsAccountCode` and the payroll codes.
All of these break on 6-digit codes. Replace the lookup-by-literal-code pattern with lookup by
**role** — resolve AR/AP/revenue/deposits through `AccountSubType` + `IsControl`, or a small
`CompanyAccountDefaults` table populated at company creation. Do not simply change the string
constants; the coupling itself is the bug.

---

## Stage 3 — VAT and withholding codes

- Seed the 20 VAT codes from `20_VAT_Codes` and the withholding codes from `21_WHT_Codes`,
  replacing `DefaultTaxDefinitionsTemplate`'s three entries.
- `NA` is a real code meaning "not applicable" and is the default for balance-sheet and payroll
  accounts. It replaces the old misuse of EXEMPT — do not map them to the same thing.
- **R10 (AUTO):** `RC18` must generate two lines automatically — Dr 113300 and Cr 210300, equal
  amounts, same document. This is the reverse-charge case for Google Ads, Meta, Microsoft 365,
  hosting and similar imported services. It is currently unhandled and silently wrong.
- Rates marked "TO VERIFY" in the sheets (SRC scope, BV50's 50% cap, IEX conditions, INV as a
  separate ATK column) stay as seeded values with a `SourceConfidence.NeedsLegalVerification` tag,
  matching the existing pattern in `Pako.Localization.Xk`.

---

## Stage 4 — Posting rules

`60_Posting_Rules` has 28 rules with an explicit severity. Implement by severity:
- **BLOCK** → throw a domain exception from the posting path. Each gets its own exception type and
  its own test, in the style of `UnbalancedJournalEntryException`.
- **AUTO** → posting logic that generates lines (R10, R12, R20, R21).
- **WARN** → a validation result the API returns alongside a successful post (R13, R14, R22).
- **POLICY** → documentation only (R27).

Rules implementable now: R01, R02, R03, R04, R05, R07, R08, R09, R10, R19, R20, R21, R24, R25, R26.

Rules whose prerequisite does not exist yet — **leave a documented TODO and a skipped test, do not
fake an implementation:**
- R06, R15 — need fiscal periods and period close. Only `Company.AccountingLockDate`/`TaxLockDate`
  exist today.
- R11, R12 — need the import/DUD document type.
- R13, R14 — need the landed-cost module and inventory.
- R16 — immutability is enforced; **storno/reversal is not implemented at all.** `Cancelled` is
  defined on `JournalEntry`, `Invoice` and `Bill` and never set. Implementing `Reverse()` is in
  scope for this stage: it writes a mirror entry and sets `Cancelled` on the original. Without it
  R16 is a rule the system cannot comply with.
- R17, R18 — need the fixed-asset subledger.
- R22 — needs bank statement import.
- R28 — needs an audit trail (user id, timestamp, source document id, IP on every posting). None
  exists. Add the columns in this stage even if the IP capture comes later.

R23 is partly satisfied: invoice/credit-note/debit-note/down-payment numbering already reserves
gapless per-series numbers under a `FOR UPDATE` row lock. `JournalEntry.SequenceNumber` is still a
nullable free-text field nothing populates — finish it using the same pattern.

---

## Testing

The existing 106 tests run on EF Core InMemory, which has **no triggers, no unique index
enforcement and no check constraints**. Every invariant added in Stage 1 is a database constraint,
so InMemory cannot test any of it. Move the test project to Testcontainers (or a disposable
Postgres) before Stage 1 lands, or the new constraints ship untested.

## Rules for the agent doing this work

1. Read both source files first. Quote the sheet and column for every value you seed.
2. Produce a plan for the stage you are on and stop for review before writing the migration.
3. One stage per commit. Do not combine stages.
4. Never invent an account, code, rate or rule that is not in the source files.
5. Where a source cell says "TO VERIFY" or the value is unresolved, seed it and tag it — do not
   guess a better value, and do not omit the row.
6. `99_Open_Questions` holds 22 unresolved items. Where an implementation depends on one, reference
   the question ID in a code comment rather than picking an answer.
7. Do not modify: the debit=credit invariant, posted-entry immutability, the tax rounding in
   `TaxComputationService`, or the `FOR UPDATE` numbering lock.
8. Update `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` as you go — they are currently stale and
   describe modules as placeholders that have been built.
