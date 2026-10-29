# PAKO Partner Fiscal Number and Invoice Posting — Audit and Fix

**Date:** 2026-10-16

## 1. Original Report

> "Po te len me regjistru partner pa fiscal number, po tani sales invoice me post nuk po te len pa pas partneri fiscal nr me sale 8%. Nuk munesh me editu partnerin me i shtu fiscal number."

Translation: Partner can be registered without a fiscal number, but 8% VAT sales invoice posting fails because the partner has no fiscal number, and the user cannot edit the partner to add it.

## 2. Root Cause Analysis

Three distinct issues in the original report:

| # | Issue | Status |
|---|---|---|
| 1 | Partner editing does not work | **ALREADY FIXED** — previous agent implemented full PUT endpoint |
| 2 | R07 validation blocks posting without identifier | **CORRECT BUSINESS VALIDATION** — required by ATK |
| 3 | Error message is unhelpful and unlocalized | **BUG CONFIRMED — FIXED AND TESTED** |

## 3. Partner Editing — ALREADY FIXED — VERIFIED

A previous agent implemented full partner editing:

- `PartnersController.Update()` (PUT endpoint) persists all fields including `FiscalNumber`
- `PartnerRegisterForm.tsx` loads `initial.fiscalNumber` in edit mode, field is fully editable
- `PartnerListPage.tsx` sends `fiscalNumber` in the `updateMutation`
- Tests in `Partners.test.tsx`, `Customers.test.tsx`, `Vendors.test.tsx` cover edit workflows

**Verification:** User can open Customers/Vendors/Partners, click Edit on any partner, add/change the Fiscal Number, save, and the change persists through the real backend.

## 4. R07 Posting Validation — CORRECT BUSINESS VALIDATION — PRESERVED

### The Rule (PostingRuleValidator.cs, line 54)

Any invoice/bill line with a non-NA VAT code requires the partner to have a tax identifier:

- **VAT-registered partner** (`IsVatRegistered=true`): must have `TaxNumber` (NUI — Numri Unik Identifikues)
- **Non-VAT-registered partner** (`IsVatRegistered=false`): must have `FiscalNumber` (personal ID number)

### Why This Is Correct

Kosovo ATK requires counterparty identification on tax invoices. The distinction between TaxNumber (business NUI) and FiscalNumber (personal number) reflects the real-world difference between VAT-registered businesses and non-VAT-registered natural persons. This applies to ALL VAT rates (8% and 18%), not just 8%.

### Field Definitions

| Field | Represents | Required When |
|---|---|---|
| `TaxNumber` | Business NUI (Kosovo business registration number) | Partner is VAT-registered and any VAT line exists |
| `FiscalNumber` | Personal identification number (natural person) | Partner is NOT VAT-registered and any VAT line exists |
| `IsVatRegistered` | Whether the partner is a VAT-registered business | Determines which identifier is required |

These fields are NOT interchangeable.

### Registration Policy

FiscalNumber remains **optional** at partner registration. This is correct — a partner may be created before all details are known, and the identifier can be added later via editing (which now works).

## 5. Error Message — BUG CONFIRMED — FIXED AND TESTED

### Before (hardcoded English, generic)

The `MissingCounterpartyTaxNumberException` threw:
```
VAT code S8 requires a counterparty with a NUI / Fiscal Number / Personal Number.
```

This was:
- Hardcoded English — bypassed `IStringLocalizer`, never localized to Albanian
- Generic — did not tell the user which specific field was missing
- Not actionable — did not tell the user to edit the partner

### After (localized, specific, actionable)

The `InvoicesController` and `BillsController` now catch `MissingCounterpartyTaxNumberException` separately and return localized, specific messages:

**VAT-registered partner missing TaxNumber (EN):**
> Cannot post: {name} is VAT-registered but has no Tax Number (NUI). Edit the partner and add the NUI, then retry.

**Non-VAT-registered partner missing FiscalNumber (EN):**
> Cannot post: {name} is not VAT-registered and has no Fiscal Number. Edit the partner and add the Fiscal Number, then retry.

**Albanian equivalents also added.**

## 6. Changes Made

| File | Change |
|---|---|
| `backend/Pako.Api/Controllers/InvoicesController.cs` | Catch `MissingCounterpartyTaxNumberException` separately; return localized, partner-specific error via `_localizer` |
| `backend/Pako.Api/Controllers/BillsController.cs` | Same change |
| `backend/Pako.Api/Resources/ErrorMessages.resx` | Added `MissingPartnerTaxNumber_R07`, `MissingPartnerFiscalNumber_R07`, `MissingPartnerForVat_R07` |
| `backend/Pako.Api/Resources/ErrorMessages.sq.resx` | Albanian translations for the same three keys |

## 7. User Workflow After Fix

1. User creates a partner without a Fiscal Number — **allowed** (optional field)
2. User creates a sales invoice with 8% VAT for that partner
3. User clicks Post
4. PAKO shows: "Cannot post: Acme LLC is not VAT-registered and has no Fiscal Number. Edit the partner and add the Fiscal Number, then retry."
5. Invoice stays in Draft — **no data lost**
6. User navigates to Customers/Partners, finds the partner, clicks Edit
7. User adds the Fiscal Number, clicks Save — **persisted via real backend**
8. User returns to the invoice and clicks Post again
9. **Invoice posts successfully**

## 8. Test Results

### Backend
- 414 passed, 13 failed (pre-existing, all in `ItemsControllerTests` — unrelated uncommitted Item schema changes)
- All 55 PostingRule, Partners, and AccountingWorkflow tests pass

### Frontend
- 146 tests passed across 26 test files

## 9. Coverage Matrix

| Requirement | Current Behavior | Correct Behavior | Fix Needed |
|---|---|---|---|
| Partner creation without Fiscal Number | Allowed | Allowed (optional) | None |
| Partner Fiscal Number editing | Works (real PUT) | Works | None (already fixed) |
| Fiscal Number persistence | Persists via backend | Persists | None |
| 8% VAT invoice validation | Blocks without identifier | Blocks without identifier | None (correct) |
| 18% VAT invoice validation | Blocks without identifier | Blocks without identifier | None (correct) |
| Individual customer handling | Requires FiscalNumber if VAT line | Requires FiscalNumber | None (correct) |
| Clear posting error | Generic, English-only | Localized, specific, actionable | **Fixed** |
| Edit Partner from invoice workflow | Must navigate manually | Navigate to partner list | None (acceptable) |
| Retry posting without losing data | Invoice stays in Draft | Invoice stays in Draft | None |
| Customer/Vendor integration | Works | Works | None |

## 10. Remaining Considerations

- **No inline "Edit Partner" button on the invoice error** — The user must navigate to the partner list to edit. This is acceptable for now; adding an inline edit would require significant UI work and is a separate enhancement.
- The `MissingPartnerForVat_R07` .resx key was added for completeness (used by manual journal entries where partner can be null), but invoices/bills always have a non-null `PartnerId`.
