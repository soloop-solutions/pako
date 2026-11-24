# Two-Step Payment Model (Odoo-style Outstanding Payments)

Status: **Plan — not started.**

## Goal

Move from PAKO's current 1-step payment model (`Dr Bank / Cr AR` on "Record Payment") to Odoo's
2-step model: "Register Payment" hits an Outstanding account, and bank reconciliation clears it to
the real bank account. Cash payments stay 1-step.

---

## Design Decisions (confirmed in conversation)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Cash stays 1-step, only Bank goes 2-step | Cash is immediate; Odoo does the same |
| D2 | Opt-in per company via journal config | Existing companies unaffected; new companies default to 2-step for bank journals |
| D3 | "In Payment" is a computed badge, not a hard state | `InvoiceState`/`BillState` referenced in 71/60 occurrences across 29/20 files — adding a state is too much churn for the value |
| D4 | New accounts 100400/100500 (Outstanding Bank Payments/Receipts) | Cleaner than reusing 100300 (Cash in Transit) or 104100 (Transfer Clearing) |
| D5 | Outstanding account config lives on `Journal`, not on `PaymentMethod` | Matches Odoo: each bank journal knows its own outstanding accounts. `PaymentMethod.LedgerAccountId` is the *destination* (bank account), not the transit account |
| D6 | Bank statement "Create Entry" for unmatched lines uses same account restrictions as manual JE (R02/R04/R05: no control, no stock, postable only) | Consistent with existing posting rules |

## Existing Code Map

| File | What it does now | What changes |
|------|-----------------|--------------|
| `PaymentRecorder.cs` | Creates 2-line JE (`AR/AP <-> Bank/Cash`), posts, reconciles in one shot | Branches: if journal has outstanding account, hit Outstanding instead of Bank; create `Payment` record |
| `ReconciliationCreator.cs` | Links a settlement JE line to an invoice/bill | Unchanged — still links the AR/AP settlement line to the document |
| `BankStatementService.cs` | Imports Excel, matches lines to open invoices/bills, confirms by calling `PaymentRecorder` | Gains: (1) match lines to outstanding `Payment` records, (2) "Create Entry" for unmatched lines |
| `BankStatementMatcher.cs` | Suggests invoice/bill matches by amount/reference/partner | Gains a second candidate source: outstanding payments |
| `JournalResolver.cs` | Picks Cash or Bank journal by account subtype | Unchanged |
| `Journal.cs` | 9 fields: Id, CompanyId, Type, Code, Name, DefaultDebit/CreditAccountId, SequencePrefix/NextNumber/Padding | Gains `OutstandingReceiptsAccountId`, `OutstandingPaymentsAccountId` |
| `CompanyAccountDefaults.cs` | 15 role fields (AR, AP, Revenue, Expense, etc.) | Gains `OutstandingReceiptsAccountId`, `OutstandingPaymentsAccountId` |
| `BankStatementLine.cs` | Matches to InvoiceId/BillId | Gains `PaymentId`, `DirectAccountId` |
| `RecordPaymentForm.tsx` | Amount + PaymentMethod select + hardcoded today's date | Gains a date picker |
| `BankStatementDetail.tsx` (frontend) | Shows matched lines, allows manual match to invoice/bill | Gains: match to outstanding payments, "Create Entry" for unmatched lines |

---

## Implementation Steps

Each step is a single commit (or commit pair for contract-first). Steps are ordered so that
each is independently shippable and testable, and no step breaks existing behavior.

### Step 1: COA seed — add Outstanding accounts

**Files:**
- `backend/Pako.Localization.Xk/Data/PAKO_COA_v2_seed.csv` — add two rows
- `docs/coa-v2/PAKO_COA_v2_seed.csv` — same two rows (source-of-truth copy)

**Rows:**
```
100400,Pagesa bankare në pritje,Outstanding Bank Payments,1,10,BS,D,BANK,NA,NA,CORE,NEW,Payments registered but not yet on the bank statement
100500,Arkëtime bankare në pritje,Outstanding Bank Receipts,1,10,BS,D,BANK,NA,NA,CORE,NEW,Receipts registered but not yet on the bank statement
```

Both are Class 1, Group 10, BS, Debit-normal, BANK subledger, CORE profile. They behave like
transit accounts: their balance should be zero once all payments are bank-reconciled.

**Verify:** `dotnet build`, `dotnet test` — no behavior change, just two more rows in the seed.

---

### Step 2: Domain — `Payment` entity

**New files:**
- `backend/Pako.Domain/Payments/Payment.cs`

```csharp
namespace Pako.Domain.Payments;

public enum PaymentState
{
    Posted,       // JE posted, outstanding account hit, awaiting bank rec
    Reconciled,   // Bank statement matched, cleared to bank
    Cancelled     // Reversed
}

public enum PaymentDirection
{
    Inbound,   // Customer paying us (receipt)
    Outbound   // Us paying a vendor (payment)
}

[Pako.Domain.Shared.Audited]
public class Payment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public PaymentDirection Direction { get; set; }
    public Guid PartnerId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly Date { get; set; }
    public string? Reference { get; set; }

    // The JE that hits Outstanding <-> AR/AP
    public Guid JournalEntryId { get; set; }

    // The JE that clears Outstanding <-> Bank (set during bank rec)
    public Guid? ClearingJournalEntryId { get; set; }

    // The bank/cash account this payment ultimately settles to
    public Guid DestinationAccountId { get; set; }

    // The outstanding account used (from journal config)
    public Guid OutstandingAccountId { get; set; }

    // Link to the document being paid (exactly one is set)
    public Guid? InvoiceId { get; set; }
    public Guid? BillId { get; set; }

    // Set when cleared during bank rec
    public Guid? BankStatementLineId { get; set; }

    public PaymentState State { get; set; } = PaymentState.Posted;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? CreatedByUserId { get; set; }
}
```

**No migration yet** — that comes in Step 3.

---

### Step 3: EF Migration — `AddTwoStepPayments`

**Files:**
- `backend/Pako.Domain/Ledger/Journal.cs` — add two nullable Guid fields
- `backend/Pako.Domain/Companies/CompanyAccountDefaults.cs` — add two nullable Guid fields
- `backend/Pako.Domain/Banking/BankStatementLine.cs` — add `PaymentId` and `DirectAccountId`
- `backend/Pako.Infrastructure/PakoDbContext.cs` — add `DbSet<Payment>`, configure entity
- `backend/Pako.Infrastructure/Configurations/PaymentConfiguration.cs` — new
- `backend/Pako.Infrastructure/Migrations/YYYYMMDD_AddTwoStepPayments.cs` — generated

**Schema additions:**
```
journals:
  + outstanding_receipts_account_id  Guid? FK accounts
  + outstanding_payments_account_id  Guid? FK accounts

company_account_defaults:
  + outstanding_receipts_account_id  Guid?
  + outstanding_payments_account_id  Guid?

payments:
  id                       Guid PK
  company_id               Guid FK companies
  direction                int (enum)
  partner_id               Guid FK partners
  amount                   decimal(18,2)
  date                     date
  reference                text?
  journal_entry_id         Guid FK journal_entries
  clearing_journal_entry_id Guid? FK journal_entries
  destination_account_id   Guid
  outstanding_account_id   Guid
  invoice_id               Guid? FK invoices
  bill_id                  Guid? FK bills
  bank_statement_line_id   Guid?
  state                    int (enum)
  created_at               timestamptz
  created_by_user_id       text?

  INDEX (company_id, state)  -- for "outstanding payments" queries
  INDEX (invoice_id) WHERE invoice_id IS NOT NULL
  INDEX (bill_id) WHERE bill_id IS NOT NULL

bank_statement_lines:
  + payment_id              Guid?
  + direct_account_id       Guid?
```

**Verify:** `dotnet build`, `dotnet test` — migration adds columns, no behavior change.

---

### Step 4: Company seed — wire outstanding accounts on bank journals

**Files:**
- `backend/Pako.Api/Controllers/CompaniesController.cs` — in the `Create` method, after seeding
  journals, look up accounts 100400/100500 by code and set them on the Bank journal.
  Also set the two new `CompanyAccountDefaults` fields.

**Logic:**
```
Bank journal:
  OutstandingPaymentsAccountId = account where Code == "100400"
  OutstandingReceiptsAccountId = account where Code == "100500"

Cash journal:
  Both stay null → 1-step mode

CompanyAccountDefaults:
  OutstandingPaymentsAccountId = same 100400
  OutstandingReceiptsAccountId = same 100500
```

Existing companies are unaffected (journals have null, so PaymentRecorder stays 1-step).

**Verify:** Create a new company in a test, assert the Bank journal has the outstanding accounts set.

---

### Step 5: Refactor `PaymentRecorder` — 2-step branch

**Files:**
- `backend/Pako.Api/Services/PaymentRecorder.cs`

**Key change in `PostAndReconcileAsync`:**

```
1. Resolve the journal (existing code).
2. NEW: Check journal.OutstandingReceiptsAccountId (inbound) or
        journal.OutstandingPaymentsAccountId (outbound).
3. If outstanding account exists (2-step):
   a. counterAccountId = outstandingAccountId (not cashOrBankAccountId)
   b. Create JE: AR/AP <-> Outstanding
   c. Post, SaveChanges
   d. Create Reconciliation (existing ReconciliationCreator — links AR/AP line to document)
   e. Create Payment record (State = Posted, DestinationAccountId = cashOrBankAccountId,
      OutstandingAccountId = outstandingAccountId)
   f. Return outcome with Payment info
4. If outstanding account is null (1-step, existing behavior):
   a. counterAccountId = cashOrBankAccountId
   b. Everything else unchanged
```

**The JE lines for a 2-step inbound payment (customer pays invoice):**
```
Dr  Outstanding Receipts 100500   €1,000
Cr  Accounts Receivable 110100    €1,000
```

**The JE lines for a 2-step outbound payment (we pay vendor bill):**
```
Dr  Accounts Payable 200100       €500
Cr  Outstanding Payments 100400   €500
```

**Outcome record** gains an optional `Payment?` field:
```csharp
public readonly record struct Outcome(
    Reconciliation? Reconciliation, JournalEntry? Entry,
    Payment? Payment, string? Error, bool NotFound = false)
```

**Verify:** Existing tests pass unchanged (they use Cash accounts → null outstanding → 1-step).
New tests: create a company, set Bank journal outstanding accounts, record a bank payment on an
invoice, assert the JE hits Outstanding (not Bank) and a Payment record exists.

---

### Step 6: `PaymentClearingService` — clears Outstanding to Bank

**New file:** `backend/Pako.Api/Services/PaymentClearingService.cs`

**Method:**
```csharp
public async Task<ClearingOutcome> ClearAsync(
    Company company, Payment payment, DateOnly date)
{
    // 1. Create clearing JE:
    //    Inbound:  Dr Bank / Cr Outstanding Receipts
    //    Outbound: Dr Outstanding Payments / Cr Bank
    // 2. Post the JE
    // 3. Update payment: State = Reconciled, ClearingJournalEntryId = JE.Id
    // 4. Return outcome
}
```

The clearing JE uses the same journal as the original payment JE (the Bank journal).

**Verify:** Unit test: create a Posted payment, call ClearAsync, assert:
- Clearing JE has the right accounts and amounts
- Payment.State == Reconciled
- Payment.ClearingJournalEntryId is set

---

### Step 7: Extend `BankStatementService` — match outstanding payments

**Files:**
- `backend/Pako.Api/Services/BankStatementService.cs`
- `backend/Pako.Api/Services/BankStatementMatcher.cs` (or wherever matching lives)

**Changes to `OpenBookAsync` (or new sibling):**

Add `OpenPaymentsAsync(companyId)`:
```csharp
// All Payments where State == Posted and DestinationAccountId == statement.BankAccountId
// Returns: PaymentId, Direction, PartnerId, Amount, Reference, Date, InvoiceId/BillId
```

**Changes to matching:**

For each bank statement line:
1. First try to match against outstanding payments (exact amount + partner or reference)
2. If matched → set `line.PaymentId` (not InvoiceId/BillId)
3. If no payment match → fall back to current invoice/bill matching

**Changes to `RecordAsync` (the confirm loop):**

Currently only handles invoice/bill matches. Add a third branch:
```
if (line.PaymentId is { } paymentId)
{
    var payment = await db.Payments.FirstOrDefaultAsync(p => p.Id == paymentId);
    // Call PaymentClearingService.ClearAsync(company, payment, line.Date)
    // Set line.State = Matched, line.JournalEntryId = clearing JE id
}
```

**Verify:**
1. Create invoice → record bank payment (2-step) → Payment exists, Outstanding account hit
2. Import bank statement with matching line → line matches the Payment
3. Confirm → PaymentClearingService clears Outstanding to Bank
4. Payment.State == Reconciled, invoice balance still zero

---

### Step 8: Bank statement "Create Entry" for unmatched lines

**Files:**
- `backend/Pako.Api/Services/BankStatementService.cs` — `UpdateLineAsync` and `RecordAsync`
- `backend/Pako.Api/Controllers/BankStatementsController.cs` — if contract changes needed
- `backend/Pako.Api/Contracts/BankStatementContracts.cs`

**Changes to `UpdateBankStatementLineRequest`:**
```csharp
// Existing: InvoiceId?, BillId?, Amount?, Ignore?
// Add:
public Guid? DirectAccountId { get; init; }
public Guid? DirectPartnerId { get; init; }
```

When `DirectAccountId` is set:
- Validate the account is postable, non-control, non-stock (same as JE posting rules)
- Store on `line.DirectAccountId` and optionally `line.PartnerId`
- Line status becomes "Ready" (has a match)

**Changes to `RecordAsync`:**

Add a branch for lines with `DirectAccountId`:
```
if (line.DirectAccountId is { } accountId)
{
    // Create 2-line JE:
    //   Money in:  Dr Bank / Cr DirectAccount
    //   Money out: Dr DirectAccount / Cr Bank
    // Post the JE
    // Set line.State = Matched, line.JournalEntryId = JE.Id
    // If line.PartnerId is set, tag both JE lines with it
}
```

**Verify:** Import a bank statement with an unmatched line → assign an expense account and
partner → confirm → JE created with correct accounts, line is Matched.

---

### Step 9: Contract commit — Payment endpoints + response changes

**Files:**
- `backend/Pako.Api/Contracts/PaymentContracts.cs` — new
- `backend/Pako.Api/Controllers/PaymentsController.cs` — new
- `backend/Pako.Api/Contracts/ReconciliationContracts.cs` — extend `RecordPaymentResponse`
- `backend/Pako.Api/Contracts/BankStatementContracts.cs` — extend line response
- `apps/web/src/mocks/payments.json` — fixture
- Regenerate API client: `pnpm generate:api-client`

**New contracts:**
```csharp
public record PaymentResponse(
    Guid Id, string Direction, Guid PartnerId, string? PartnerName,
    decimal Amount, DateOnly Date, string? Reference,
    string State, Guid? InvoiceId, Guid? BillId, string? DocumentNumber,
    Guid DestinationAccountId, string? DestinationAccountName,
    Guid? BankStatementLineId, DateTime CreatedAt);

public record PaymentListResponse(List<PaymentResponse> Items, int Total, int Page, int PageSize);

// On RecordPaymentResponse — add:
public record RecordPaymentResponse(
    ReconciliationResponse Reconciliation, DocumentBalanceResponse Balance,
    PaymentResponse? Payment);  // null when 1-step (Cash)

// On BankStatementLineResponse — add:
// PaymentId, DirectAccountId, DirectAccountName
```

**New endpoints:**
```
GET  api/companies/{id}/payments?state=&direction=&partnerId=&page=&pageSize=&sort=
GET  api/companies/{id}/payments/{paymentId}
POST api/companies/{id}/payments/{paymentId}/cancel
GET  api/companies/{id}/payments/outstanding  (shortcut for state=Posted)
```

**Verify:** `dotnet build`, API client regenerates cleanly, contract tests pass.

---

### Step 10: `PaymentsController` implementation

**New file:** `backend/Pako.Api/Controllers/PaymentsController.cs`

**Endpoints:**
- `List` / `Outstanding`: query `db.Payments` with filters, join partner/account names
- `Detail`: single payment with related info
- `Cancel`: reverse the payment JE (create a reversal entry), set Payment.State = Cancelled.
  If the payment was Reconciled, also reverse the clearing JE. Update reconciliation.

**Verify:** Full round-trip test: create invoice → record bank payment → list outstanding → cancel
→ invoice balance restored.

---

### Step 11: Invoice/Bill response — payment status

**Files:**
- `backend/Pako.Api/Controllers/InvoicesController.cs` — in the detail/balance response
- `backend/Pako.Api/Controllers/BillsController.cs` — same
- `backend/Pako.Api/Contracts/InvoiceContracts.cs` — extend response
- `backend/Pako.Api/Contracts/BillContracts.cs` — extend response

**Add to balance/detail response:**
```csharp
// Existing: Total, Reconciled, Outstanding
// Add:
public decimal InPayment { get; }  // sum of Payment.Amount where State == Posted for this document
```

Computed:
```
InPayment = Payments.Where(State == Posted).Sum(Amount)
Paid = Reconciled  (payments that have been bank-reconciled OR 1-step cash payments)
Outstanding = Total - Reconciled - InPayment
```

Wait — this changes the existing `Outstanding` calculation. Currently:
```
Outstanding = Total - Reconciled
```
With 2-step payments, a payment that's been registered (Posted) but not bank-reconciled IS
already reconciled against the document (the AR/AP line is reconciled). So `Reconciled` already
includes the in-payment amount. The `InPayment` field is purely informational ("of the reconciled
amount, this much hasn't cleared the bank yet").

So actually:
```
InPayment = sum of Payment.Amount where State == Posted for this document
// Outstanding stays: Total - Reconciled (unchanged, because reconciliation happened at step 1)
// InPayment is a subset of Reconciled — the part awaiting bank rec
```

This means the existing Outstanding calculation is correct and unchanged. We just add `InPayment`
as extra info.

**Verify:** Existing balance tests unchanged. New test: 2-step payment → `InPayment > 0`,
`Outstanding == 0`, `Reconciled == Total`.

---

### Step 12: i18n strings

**Files:**
- `backend/Pako.Api/Resources/ErrorMessages.resx` — new keys
- `backend/Pako.Api/Resources/ErrorMessages.sq.resx` — Albanian translations
- `apps/web/src/i18n/messages.ts` — new keys in EN and SQ

**Backend keys:**
```
PaymentNotFound = Payment not found.
PaymentAlreadyCancelled = This payment has already been cancelled.
PaymentCannotCancel = Cannot cancel a payment that has been bank-reconciled. Reverse the bank statement first.
BankStmtDirectAccountNotPostable = This account cannot be used for direct entries.
BankStmtDirectAccountIsControl = Control accounts (AR/AP) cannot be used. Record a bill or invoice instead.
OutstandingPaymentsLabel = Outstanding Bank Payments
OutstandingReceiptsLabel = Outstanding Bank Receipts
```

**Frontend keys (EN + SQ):**
```
payments.title / Payments / Pagesat
payments.outstanding / Outstanding / Në pritje
payments.reconciled / Reconciled / Të rakorduar
payments.cancelled / Cancelled / Të anuluara
payments.direction.inbound / Receipt / Arkëtim
payments.direction.outbound / Payment / Pagesë
payments.cancel / Cancel Payment / Anulo pagesën
payments.cancelConfirm / Cancel this payment? The journal entry will be reversed. / ...
payment.inPayment / In Payment / Në pagesë
payment.awaitingBankRec / Awaiting bank reconciliation / Në pritje të rakordimit bankar
bankStatement.createEntry / Create Entry / Krijo regjistrim
bankStatement.assignAccount / Assign account / Cakto llogarinë
bankStatement.matchedPayment / Matched to outstanding payment / ...
```

---

### Step 13: Frontend — `RecordPaymentForm` date picker

**File:** `apps/web/src/pages/shared/RecordPaymentForm.tsx`

Currently hardcodes: `date: new Date().toISOString().slice(0, 10)`

**Change:** Add a date `<Input type="date">` field (renders as `DatePicker` per CLAUDE.md
conventions), defaulting to today, letting the user set the actual payment date.

---

### Step 14: Frontend — Invoice/Bill detail payment status

**Files:**
- `apps/web/src/pages/invoicing/InvoiceDetail.tsx`
- `apps/web/src/pages/bills/BillDetail.tsx`

**Show below the existing Outstanding line:**
```
Outstanding: €0.00
In Payment:  €1,000.00  (awaiting bank reconciliation)  ← badge, yellow
```

If `inPayment > 0`, show a collapsible list of pending payments with links to the payment detail.

---

### Step 15: Frontend — Bank statement outstanding payment matching

**Files:**
- `apps/web/src/pages/bank-statements/BankStatementDetail.tsx`

**Changes:**
- When a line is matched to a `PaymentId` (not an invoice/bill), show:
  "Matched to outstanding payment: Payment for INV-0042 (€1,000.00)"
- In the candidates dropdown, show outstanding payments as a separate section above invoices/bills
- Status "Ready" when matched to a payment

---

### Step 16: Frontend — Bank statement "Create Entry" for unmatched lines

**Files:**
- `apps/web/src/pages/bank-statements/BankStatementDetail.tsx`

**For lines with status "None":**
- Show an account select (filterable, postable non-control non-stock accounts only)
- Show an optional partner select
- When account is selected, line status becomes "Ready"
- On confirm, the backend creates the direct JE

---

### Step 17: Frontend — Payments list page

**New files:**
- `apps/web/src/pages/payments/PaymentsPage.tsx`

**Features:**
- DataGrid with server-side paging
- Columns: Date, Partner, Direction, Amount, Document, State, Bank Statement
- Filter tabs: All / Outstanding / Reconciled
- Click-through to source document (invoice/bill)
- Cancel button on Outstanding payments (with confirm dialog)

**Route:** `/payments` — add to sidebar under Bank & Cash / Accounting section.

---

### Step 18: Frontend — Dashboard outstanding widget

**Files:**
- `apps/web/src/pages/dashboard/Dashboard.tsx` (or relevant dashboard component)

**Add a KPI tile:**
- "Outstanding Payments: €X" with count
- Links to the Payments page filtered to Outstanding

Requires a backend endpoint or extending the existing dashboard response:
```
GET api/companies/{id}/dashboard → add: outstandingPaymentsCount, outstandingPaymentsTotal
```

---

### Step 19: Tests — full coverage

**File:** `backend/Pako.Tests/PaymentTests.cs` (new)

| Test | Asserts |
|------|---------|
| `RecordPayment_CashAccount_OneStep_NoPaymentRecord` | Cash payment → direct bank JE, no Payment record, existing behavior |
| `RecordPayment_BankAccount_TwoStep_CreatesPaymentRecord` | Bank payment → Outstanding JE, Payment record (Posted) |
| `RecordPayment_BankAccount_TwoStep_ReconcilesToDocument` | The AR/AP line is reconciled, invoice outstanding == 0 |
| `RecordPayment_BankAccount_TwoStep_OutstandingAccountBalance` | Outstanding account has the right balance |
| `PaymentClearing_ClearsToBank` | ClearAsync → Dr Bank / Cr Outstanding, Payment.State == Reconciled |
| `PaymentClearing_UpdatesPaymentFields` | ClearingJournalEntryId and BankStatementLineId set |
| `BankStatement_MatchesOutstandingPayment` | Import matches a Posted Payment |
| `BankStatement_Confirm_ClearsPayment` | Confirm → Payment cleared, bank account balance correct |
| `BankStatement_DirectEntry_CreatesJE` | Unmatched line + DirectAccountId → 2-line JE |
| `BankStatement_DirectEntry_RespectsPostingRules` | Control/stock accounts rejected |
| `PaymentCancel_ReversesJE` | Cancel → reversal JE, Payment.State == Cancelled |
| `PaymentCancel_ReconciledPayment_Rejected` | Cannot cancel a bank-reconciled payment |
| `InvoiceBalance_ShowsInPayment` | InPayment field on balance response |
| `ExistingCompany_NullOutstanding_OneStepUnchanged` | Backward compat: no outstanding accounts → old behavior |
| `NewCompany_BankJournalHasOutstandingAccounts` | Company seed wires outstanding accounts |
| `Reports_OutstandingAccountExcludedFromBankBalance` | Trial balance / reports still correct |

---

## Execution Order Summary

```
Backend (Steps 1-12):
  1. COA seed rows
  2. Payment entity (domain)
  3. EF migration
  4. Company seed wiring
  5. PaymentRecorder refactor (the core change)
  6. PaymentClearingService
  7. BankStatementService — outstanding payment matching
  8. BankStatementService — "Create Entry" for unmatched lines
  9. Contract commit + API client regen
 10. PaymentsController implementation
 11. Invoice/Bill response — InPayment field
 12. i18n strings (backend)

Frontend (Steps 13-18):
 13. RecordPaymentForm date picker
 14. Invoice/Bill detail — payment status badge
 15. Bank statement — outstanding payment matching UI
 16. Bank statement — "Create Entry" UI
 17. Payments list page
 18. Dashboard outstanding widget

Tests (Step 19):
 19. Full test suite

i18n (Step 12, frontend part in 13-18):
  Backend keys in both .resx files
  Frontend keys in messages.ts (EN + SQ)
```

## Risk Notes

- **Step 5 is the riskiest change.** `PaymentRecorder` is called by invoice record-payment, bill
  record-payment, inline payment on create, and bank statement confirm. All four callers must work
  in both 1-step and 2-step mode. Test all four paths.
- **Outstanding accounts affect reports.** The trial balance, balance sheet, and cash flow report
  will show balances on 100400/100500. This is correct (they're real assets — money owed to us or
  by us that hasn't cleared the bank). But the reconciliation check
  `stock-total-matches-inventory-accounts` and similar checks are unaffected. The
  `balance-sheet-balances` check will still pass because Outstanding accounts are Current Assets
  (Class 1, Group 10), same as Bank accounts.
- **Existing payments are unaffected.** They were recorded as 1-step, their JEs are correct, and
  no Payment records exist for them. The Payment table starts empty.
- **One migration rule.** Steps 1-4 share one migration. Do not generate a second migration on the
  same day.
