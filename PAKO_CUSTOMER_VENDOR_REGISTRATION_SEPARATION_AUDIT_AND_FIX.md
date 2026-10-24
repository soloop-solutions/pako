# PAKO Customer/Vendor Registration Separation — Audit Report

**Date:** 2026-10-16
**Status:** ALREADY IMPLEMENTED AND VERIFIED

## 1. Summary

The Customer/Vendor separation feature has been fully implemented by a previous agent. No changes were needed.

## 2. Existing Implementation

### Backend

- **Partner entity** (`backend/Pako.Domain/Companies/Partner.cs`): Has `IsCustomer` and `IsVendor` boolean fields, both independently settable.
- **PartnersController** (`backend/Pako.Api/Controllers/PartnersController.cs`): Full CRUD (List, Get, Create, Update) supporting both role flags. NUI (TaxNumber) uniqueness enforced at both application level and Postgres unique index (`IX_partners_CompanyId_TaxNumber_Unique`), scoped per company.
- **Contracts** (`backend/Pako.Api/Contracts/`): `CreatePartnerRequest` and `UpdatePartnerRequest` both accept `IsCustomer` and `IsVendor`. `PartnerResponse` returns both flags.

### Frontend — Pages

| Page | File | Behavior |
|---|---|---|
| Customers | `apps/web/src/pages/partners/Customers.tsx` | Filters `p.isCustomer`, passes `defaultRole="customer"` |
| Vendors | `apps/web/src/pages/partners/Vendors.tsx` | Filters `p.isVendor`, passes `defaultRole="vendor"` |
| Partners (all) | `apps/web/src/pages/partners/Partners.tsx` | Shows all partners, no filter |

All three use the shared `PartnerListPage.tsx` component, which handles CRUD, search, DataGrid rendering, and inline editing.

### Frontend — Registration Form

`PartnerRegisterForm.tsx` accepts a `defaultRole` prop:
- From Customers page: `isCustomer=true`, `isVendor=false` by default
- From Vendors page: `isVendor=true`, `isCustomer=false` by default
- From Partners page: `isCustomer=true`, `isVendor=false` by default (general)
- Both checkboxes remain editable, enabling dual-role assignment
- Submit is disabled if neither role is checked

### Frontend — Navigation

- **Sales** category: Customers (`/customers`) with `UserCheck` icon
- **Purchases** category: Vendors (`/vendors`) with `Truck` icon
- **Registers** category: Partners (`/partners`) with `BookUser` icon — combined admin view

### Frontend — Invoice/Bill Integration

| Workflow | File | Filtering |
|---|---|---|
| Sales Invoices | `Invoicing.tsx` | `partners.filter(p => p.isCustomer)` |
| Sales Returns | `SalesReturns.tsx` | `partners.filter(p => p.isCustomer)` |
| Proforma | `Proforma.tsx` | `partners.filter(p => p.isCustomer)` |
| Invoice Detail | `InvoiceDetail.tsx` | `partners.filter(p => p.isCustomer)` |
| Purchase Invoices | `Bills.tsx` | `partners.filter(p => p.isVendor)` |
| Purchase Returns | `PurchaseReturns.tsx` | `partners.filter(p => p.isVendor)` |
| Bill Detail | `BillDetail.tsx` | `partners.filter(p => p.isVendor)` |

Inline partner creation (`PartnerForm.tsx`) correctly sets `isCustomer`/`isVendor` based on the transaction context.

### Translations

Full EN and SQ coverage in `apps/web/src/i18n/messages.ts`:
- `customers.*` — 12 keys (title, description, add, edit, empty, search, created, saved, errors)
- `vendors.*` — 12 keys (same structure)
- `nav.customers` / `nav.vendors` — sidebar labels and descriptions

### Dual-Role Support

- A partner can have both `IsCustomer=true` and `IsVendor=true`
- Dual-role partners appear in both Customers and Vendors lists
- Dual-role partners show both "Customer" and "Vendor" badges in the Type column
- Dual-role partners are selectable on both Sales and Purchase documents
- One underlying Partner record, one NUI — no duplication

### NUI Uniqueness

- Application-level check in `ValidateAsync` (excludes self on update)
- DB-level unique index on `(CompanyId, TaxNumber)` where TaxNumber is not null
- Catches `DbUpdateException` for race conditions, returns 409 Conflict
- Company isolation: same NUI allowed across different companies
- Null TaxNumber allowed for multiple partners

## 3. Test Results

### Frontend (all pass)
- `Customers.test.tsx` — 4 tests: filtering, title, create with defaults, edit, dual-role badges
- `Vendors.test.tsx` — 5 tests: filtering, title, create with defaults, edit, dual-role badges
- `Partners.test.tsx` — 5 tests: list fields, edit, edit name, create, StrictMode

### Backend (all pass)
- `PartnersControllerTests.cs` — 12 tests: CRUD, NUI uniqueness, whitespace normalization, company isolation, concurrent duplicate prevention, unknown partner 404

**Test run:** 146 tests passed across 26 test files (7.15s).

## 4. Coverage Matrix

| Requirement | Implemented | Working | Action Needed |
|---|---|---|---|
| Separate Customers list | Yes | Yes | None |
| Separate Vendors list | Yes | Yes | None |
| Add Customer workflow | Yes | Yes | None |
| Add Vendor workflow | Yes | Yes | None |
| Correct registration defaults | Yes | Yes | None |
| Both roles supported | Yes | Yes | None |
| Edit existing Partner roles | Yes | Yes | None |
| NUI duplicate prevention | Yes | Yes | None |
| Sales Invoice filtering | Yes | Yes | None |
| Purchase Invoice filtering | Yes | Yes | None |
| Sidebar navigation | Yes | Yes | None |
| EN/SQ translations | Yes | Yes | None |
| Frontend tests | Yes | Yes | None |
| Backend tests | Yes | Yes | None |

## 5. No Changes Made

No files were modified. The feature was already complete.

## 6. Remaining Considerations

- **Role removal safety**: The current implementation allows removing a role (e.g., unchecking "Customer" on an existing customer). There is no guard against removing a role if historical invoices/bills exist for that partner in that role. This is a product decision that should be confirmed with stakeholders.
- **Backend filtering**: The API returns all partners; filtering by role happens client-side. For large partner lists, a server-side `?role=customer|vendor` query parameter could improve performance, but is not needed at current scale.
