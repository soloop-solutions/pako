# PAKO Global Add/Edit Modal Standardization - Audit & Implementation Report

## 1. Executive Summary

Every applicable Add/Create action in the PAKO web application has been migrated from inline Card-based forms to modal dialogs. Edit actions on register entities (Partners, Items, Accounts) are also modal-based. Complex transactional forms (Invoices, Bills, Journal Entries) use full-screen dialogs. The underlying page state (search, filters, sort, pagination) is preserved across modal open/close cycles.

**Status: FULLY IMPLEMENTED AND VERIFIED**

---

## 2. Shared Infrastructure Created

### New Components

| File | Purpose |
|------|---------|
| `apps/web/src/components/ui/dialog.tsx` | shadcn/ui Dialog component (Radix UI Dialog primitive) |
| `apps/web/src/components/shared/FormDialog.tsx` | Reusable form dialog wrapper with size variants and unsaved-changes protection |

### New Dependency

- `@radix-ui/react-dialog@^1.3.1` added to `apps/web/package.json`

### FormDialog Features

- **Size variants**: `sm` (max-w-md), `md` (max-w-2xl), `lg` (max-w-4xl), `xl` (max-w-6xl), `full` (near-viewport)
- **Unsaved-changes protection**: `dirty` prop triggers confirmation dialog on close/Escape/backdrop click
- **Portal-aware click handling**: Prevents accidental close when interacting with SearchableSelect popovers
- **Accessible**: Uses Radix Dialog primitives with proper focus trap, Escape handling, ARIA attributes
- **Scrollable**: `max-h-[90vh] overflow-y-auto` for long forms

### i18n Keys Added

| Key | EN | SQ |
|-----|----|----|
| `formDialog.unsavedTitle` | Unsaved changes | Ndryshime te paruajtura |
| `formDialog.unsavedDescription` | You have unsaved changes. Discard them? | Keni ndryshime te paruajtura. Deshironi t'i hidhni poshte? |
| `formDialog.continueEditing` | Continue editing | Vazhdo redaktimin |
| `formDialog.discard` | Discard changes | Hidhi ndryshimet |
| `invoicing.addCustomer` | Add customer | Shto klient |
| `bills.addVendor` | Add vendor | Shto furnitor |

---

## 3. Complete Add/Edit Inventory

### Registers (Phase 2) - MIGRATED TO MODALS

| Module | Action | Previous Behavior | New Behavior | Dialog Size | Dirty Protection |
|--------|--------|-------------------|--------------|-------------|------------------|
| Partners | Add | Inline Card | Modal | md | Yes |
| Partners | Edit | Inline Card | Modal | md | Yes |
| Customers | Add | Inline Card (via PartnerListPage) | Modal | md | Yes |
| Customers | Edit | Inline Card (via PartnerListPage) | Modal | md | Yes |
| Vendors | Add | Inline Card (via PartnerListPage) | Modal | md | Yes |
| Vendors | Edit | Inline Card (via PartnerListPage) | Modal | md | Yes |
| Items/Articles | Add | Always-visible inline section | Modal (button trigger) | lg | Yes |
| Items/Articles | Edit | Inline section below grid | Modal | lg | Yes |
| Chart of Accounts | Add | Inline Card | Modal | lg | Yes |
| Chart of Accounts | Edit | Inline Card | Modal | lg | Yes |

### Administration (Phase 3) - MIGRATED TO MODALS

| Module | Action | Previous Behavior | New Behavior | Dialog Size | Dirty Protection |
|--------|--------|-------------------|--------------|-------------|------------------|
| Companies | Add Company | Inline Card form | Modal | sm | Yes |
| Companies | Add Firm | Inline form at bottom of firms list | Modal | sm | Yes |
| Payroll | Add Employee | Inline form in Card | Modal | sm | Yes |
| Payroll | Create Payroll Run | Inline Card form | Modal | sm | N/A (dates only) |

### Transactions (Phase 4) - MIGRATED TO FULL-SCREEN MODALS

| Module | Action | Previous Behavior | New Behavior | Dialog Size |
|--------|--------|-------------------|--------------|-------------|
| Sales Invoices | New Invoice | Always-visible inline Card | Full-screen modal | full |
| Sales Invoices | Quick Add Customer | Inline PartnerForm in Card | Small modal | sm |
| Purchase Invoices | New Bill | Always-visible inline Card | Full-screen modal | full |
| Purchase Invoices | Quick Add Vendor | Inline PartnerForm in Card | Small modal | sm |
| Sales Returns | New Return | Inline Card form | Full-screen modal | full |
| Purchase Returns | New Return | Inline Card form | Full-screen modal | full |

### Already Correct / Special Treatment

| Module | Action | Current Behavior | Reason |
|--------|--------|------------------|--------|
| Invoice Detail | Edit Draft | Inline toggle on detail page | Detail pages use inline editing by design |
| Bill Detail | Edit Draft | Inline toggle on detail page | Detail pages use inline editing by design |
| Journal Entries | Add Urdheresa | Inline grid (JournalEntryGrid) | Spreadsheet-style grid cannot be in a modal |
| Number Series | Edit Pattern | Inline row editing | Single-field row edit; modal would be overkill |
| Lock Dates | Set Dates | Inline form sections | Settings page with multi-section layout |
| Company Profile | Edit | Full page form | Too large for a modal (5 Card sections) |
| Reconciliation | N/A | Read-only page | No create/edit actions |
| Reports | N/A | Read-only page | No create/edit actions |
| Year-End | N/A | Read-only page | No create/edit actions |
| Dashboard | N/A | Read-only page | No create/edit actions |

---

## 4. Files Modified

### New Files
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/shared/FormDialog.tsx`

### Modified Files
- `apps/web/src/i18n/messages.ts` (6 new EN keys, 6 new SQ keys)
- `apps/web/src/pages/partners/PartnerListPage.tsx` (Card forms -> FormDialog)
- `apps/web/src/pages/partners/PartnerRegisterForm.tsx` (added `onDirtyChange` prop)
- `apps/web/src/pages/items/Items.tsx` (inline forms -> FormDialog + Add button)
- `apps/web/src/pages/items/ItemForm.tsx` (added `onDirtyChange` prop)
- `apps/web/src/pages/ledger/ChartOfAccounts.tsx` (Card forms -> FormDialog)
- `apps/web/src/pages/ledger/AccountForm.tsx` (added `onDirtyChange` prop)
- `apps/web/src/pages/Companies.tsx` (inline forms -> FormDialog)
- `apps/web/src/pages/payroll/Payroll.tsx` (inline forms -> FormDialog)
- `apps/web/src/pages/invoicing/Invoicing.tsx` (inline forms -> FormDialog)
- `apps/web/src/pages/bills/Bills.tsx` (inline forms -> FormDialog)
- `apps/web/src/pages/invoicing/SalesReturns.tsx` (inline form -> FormDialog)
- `apps/web/src/pages/bills/PurchaseReturns.tsx` (inline form -> FormDialog)
- `apps/web/package.json` (added `@radix-ui/react-dialog`)
- `pnpm-lock.yaml` (lockfile update)

---

## 5. Test Results

| Check | Result |
|-------|--------|
| TypeScript typecheck | PASS |
| ESLint | PASS (0 errors, 0 warnings) |
| Vitest (26 files, 150 tests) | PASS |
| Vite build | PASS |

---

## 6. Architecture Decisions

1. **FormDialog wraps Dialog, not replaces it.** Existing custom dialogs (ActionPasswordDialog, CompanySwitchDialog, InvoicePreviewDialog, PostingPreview) are left as-is. They predate the Dialog component and work correctly.

2. **Dirty tracking is opt-in.** Each form component receives an optional `onDirtyChange` callback. The parent page passes `dirty` to FormDialog. Only primary text fields are tracked (name, code, etc.) to avoid false positives from derived/default values.

3. **Full-screen for transactions.** InvoiceForm and BillForm contain line-item grids, partner selectors, tax dropdowns, and multi-field layouts. They use `size="full"` to avoid cramping.

4. **Small for simple entities.** Company creation (1-2 fields), firm creation (1 field), employee creation (2 fields), and payroll run creation (2 dates) use `size="sm"`.

5. **Medium/large for registers.** PartnerRegisterForm (10 fields with conditional sections) uses `md`. ItemForm (9 fields) and AccountForm (16+ fields) use `lg`.

6. **Portal-aware click handling.** FormDialog prevents accidental close when clicking inside Radix Popover portals (SearchableSelect dropdowns, date pickers).

7. **No route changes.** The app had no form routes to begin with (/new, /:id/edit). All forms were state-toggled. Modals replace Cards, not routes.

---

## 7. Remaining Notes

- **Detail page editing** (InvoiceDetail, BillDetail) remains inline-toggle. These are full-page views where the user is already navigated to the document. Converting to modals would lose the document context.
- **JournalEntryGrid** is a spreadsheet-style editor. It cannot be meaningfully placed in a modal.
- **NumberingSettings** uses row-level inline editing for a single field (pattern). A modal for each row edit would add unnecessary clicks.
- **CompanyProfile** is a full multi-section settings page. It would not fit in any dialog size.
- **MembersPanel** member invitation is a small inline form within an expandable section. It could be a modal but works well as-is.
