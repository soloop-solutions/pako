# PAKO Partner Credit Limit — Audit and Fix Report

**Date:** 2026-10-16
**Status:** BUG CONFIRMED — FIXED AND TESTED

## 1. Did enforcement already exist?

No. The `CreditLimit` field existed on the `Partner` entity as a nullable `decimal?` since migration
`20260916072514_AddPartnerSubledgerFields`, but it was explicitly flagged as **inert** in the domain
code comment:

> "B8: stored, inert data — same 'field exists, feature doesn't yet' posture as
> Item.DefaultInventoryAccountId. No document flow reads or enforces this yet."

The field was persisted on create/update and returned in the API response, but never consulted by
any business logic.

## 2. Was the reported bug reproducible?

Yes. A customer with `CreditLimit = 1000` could have unlimited invoices posted against them with no
check whatsoever. The credit limit value was purely cosmetic.

## 3. Root cause

The credit limit was implemented as a storage-only field with no enforcement logic. No outstanding
balance aggregation existed at the partner level, and no guard existed in the invoice posting path.

## 4. Existing outstanding-balance calculation

Per-document `ComputeBalanceAsync` existed in both `InvoicesController` and `BillsController`,
returning `DocumentBalanceResponse(Total, Reconciled, Outstanding)` for a single invoice/bill. No
partner-level aggregate existed.

## 5. Credit exposure formula

```
Outstanding Balance = Sum(Debit - Credit) on receivable account across all posted invoice
                      journal entries for the partner
                    - Sum(reconciled amounts) across those invoices

Available Credit = Credit Limit - Outstanding Balance

Projected Exposure = Outstanding Balance + New Invoice Receivable Amount

Rule: Reject if Projected Exposure > Credit Limit
```

Semantics:
- `CreditLimit = null` → unlimited credit (no check)
- `CreditLimit = 0` → no credit allowed
- `CreditLimit > 0` → maximum permitted outstanding credit
- `CreditLimit < 0` → rejected on create/update

## 6. Implementation plan

| Requirement | Existed? | Working? | Fix Needed? |
|---|---|---|---|
| Credit Limit persistence | Yes | Yes | No |
| Credit Limit editing | Yes | Yes | No |
| Negative value rejection | No | N/A | Yes — added |
| Outstanding balance calculation | No (per-doc only) | N/A | Yes — added partner-level |
| Invoice posting enforcement | No | N/A | Yes — added |
| Partial payments | Reconciliation existed | Yes | Integrated into calc |
| Credit Notes | Reconciliation existed | Yes | Integrated into calc |
| Sales Returns | Reconciliation existed | Yes | Integrated into calc |
| Fully paid sales | N/A | N/A | Exempt (no new exposure) |
| Concurrency protection | No | N/A | Yes — partner row lock |
| Frontend warnings | No | N/A | Yes — added |
| Company isolation | Yes (CompanyId filter) | Yes | Preserved |
| Credit exposure API | No | N/A | Yes — added |
| Localization | No | N/A | Yes — EN + SQ |

## 7. Changes made

### Backend

**`backend/Pako.Api/Controllers/PartnersController.cs`**
- Added negative `CreditLimit` validation in Create and Update endpoints

**`backend/Pako.Api/Controllers/InvoicesController.cs`**
- Added `GetPartnerOutstandingAsync(companyId, partnerId)` — computes total outstanding receivables
  for a partner across all posted invoices (net receivable from journal entry lines minus reconciled)
- Added credit limit check in `PostDraftInvoiceAsync` after `invoice.Post()` but before numbering —
  only for `Invoice` and `DebitNote` document types (which increase receivables). Credit notes,
  sales returns, and down payments are exempt (they reduce exposure)
- Added partner row lock (`SELECT ... FOR UPDATE`) inside the existing transaction to serialize
  concurrent credit checks
- Added `GET /api/companies/{companyId}/invoices/partner/{partnerId}/credit-exposure` endpoint

**`backend/Pako.Api/Contracts/PartnerContracts.cs`**
- Added `CreditExposureResponse(decimal? CreditLimit, decimal OutstandingBalance, decimal? AvailableCredit)`

**`backend/Pako.Api/Resources/ErrorMessages.resx`**
- Added `CreditLimitNegative`: "Credit limit cannot be negative."
- Added `CreditLimitExceeded`: "Credit limit exceeded. Available credit: {0}. New unpaid amount: {1}."

**`backend/Pako.Api/Resources/ErrorMessages.sq.resx`**
- Added `CreditLimitNegative`: "Limiti i kredise nuk mund te jete negativ."
- Added `CreditLimitExceeded`: "Eshte tejkaluar limiti i kredise. Kredia e disponueshme: {0}. Shuma e re e papaguar: {1}."

**`backend/Pako.Tests/CreditLimitTests.cs`** (new file)
- 10 tests covering all credit limit scenarios

### Frontend

**`apps/web/src/pages/invoicing/InvoiceForm.tsx`**
- Fetches credit exposure when a customer is selected
- Shows info/warning/error banner with credit limit, outstanding, and available credit
- Red banner when already over limit, yellow when invoice would exceed, neutral otherwise
- Supports light/dark mode

**`apps/web/src/i18n/messages.ts`**
- Added 3 EN keys: `invoicing.creditLimit.info`, `.overLimit`, `.wouldExceed`
- Added 3 SQ keys matching the above

**`apps/web/src/mocks/partnersHandlers.ts`**
- Updated outdated header comment (mock behavior unchanged)

### Generated

**`packages/shared/src/generated/api-client.ts`**
- Regenerated with new `creditExposure()` method and `CreditExposureResponse` type

## 8. Concurrency strategy

The partner row is locked with `SELECT "Id" FROM partners WHERE "Id" = {partnerId} FOR UPDATE`
inside the existing transaction that also locks the company row for invoice numbering. This
serializes concurrent credit checks for the same partner while allowing unrelated partners to
proceed in parallel. The credit exposure is calculated inside this locked transaction, preventing
two concurrent invoices from both passing based on stale balance data.

On EF InMemory (tests), the `FOR UPDATE` is a no-op via the existing `SupportsRowLocking()`
extension method.

## 9. Backend validation behavior

When posting is rejected:
- Returns HTTP 400 with the localized error message including available credit and new amount
- The invoice remains in `Draft` state
- No journal entry or receivable is created
- No number is consumed from the series
- The transaction is rolled back

## 10. Frontend behavior

- Credit info banner appears when a customer with a configured credit limit is selected
- Three states: info (green/neutral), warning (yellow), error (red)
- When posting fails, the backend error is displayed via the existing `Alert` + `toast.error` pattern
- All form values are preserved on rejection
- Works in both EN/SQ and light/dark mode

## 11. Test results

**Backend:** 10/10 credit limit tests pass. 423 total tests pass. 13 pre-existing failures in
`ItemsControllerTests` (unrelated — missing `Description` column migration for InMemory provider).

**Frontend:** `typecheck` clean, `lint` clean, 150 tests pass across 26 files, `build` succeeds.

## 12. Remaining limitations

1. **EF InMemory tests:** The `FOR UPDATE` concurrency lock is a no-op in tests. True concurrency
   testing requires Testcontainers (Phase 0 of the project plan).
2. **Inline payment atomicity:** If a fully-paid invoice is created with an inline payment, the
   credit check currently evaluates the full invoice amount before the payment reduces it. This is
   conservative — a genuinely atomic invoice+payment flow would need the payment to reduce exposure
   within the same credit check.
3. **Partner form doesn't show outstanding/available credit.** Only the invoice form fetches credit
   exposure. Adding it to the partner detail view is a future enhancement.
4. **No audit trail for credit limit changes.** Changing a partner's credit limit is not logged
   beyond standard entity tracking.

## 13. Manual verification instructions

1. Create a customer partner with Credit Limit = 1000 EUR
2. Create and post a sales invoice for 700 EUR → should succeed
3. Create and post a sales invoice for 400 EUR → should be blocked with error message
4. Record a payment of 200 EUR against the first invoice
5. Create and post a sales invoice for 400 EUR → should now succeed (outstanding = 500, available = 500)
6. Try creating a partner with Credit Limit = -100 → should be rejected
7. Set Credit Limit to null → invoices should post without limit
8. Verify the credit warning banner appears in the invoice form when selecting a customer with a limit
