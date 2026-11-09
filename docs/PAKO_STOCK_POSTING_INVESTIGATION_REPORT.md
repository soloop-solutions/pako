# PAKO Stock & Posting Investigation Report

**Date:** 2026-11-09
**Branch:** `main` at `3e9c26b`
**Investigator:** Claude Code (read-only investigation; no code changes made)
**Company:** Fuel Station demo (`54c8a66a-90ad-4e19-bbcb-11cd2ccb9f9f`)

---

## 1. Environment Snapshot

- **Backend:** ASP.NET Core / .NET 10, Postgres on :5433
- **Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui
- **API client:** NSwag-generated at `packages/shared/src/generated/api-client.ts`
- **Test user:** `fuel.owner@pako.test`
- **Evidence sources:** Code inspection, generated API client analysis, HTTP curl captured during manual testing

---

## 2. Finding-by-Finding Diagnosis

### Finding 1 — Purchase Bill Cannot Be Posted (P1, CONFIRMED BUG)

**Severity:** P1 — blocks all purchase bill posting
**Confidence:** Confirmed
**Root cause:** Frontend method name swap in `PostingPreview.tsx`

#### Evidence

In `apps/web/src/components/shared/PostingPreview.tsx:39-41`:

```typescript
const data = documentKind === "invoice"
  ? await apiClient.postPreview(companyId, documentId)    // ← BILLS endpoint!
  : await apiClient.postPreview2(companyId, documentId);  // ← INVOICES endpoint!
```

The NSwag-generated client names these methods:
- `apiClient.postPreview()` → `GET /api/companies/{companyId}/bills/{id}/post-preview` (line 1403-1404 of api-client.ts)
- `apiClient.postPreview2()` → `GET /api/companies/{companyId}/invoices/{id}/post-preview` (line 7734-7735 of api-client.ts)

**When `documentKind === "bill"`**, the code enters the `else` branch and calls `apiClient.postPreview2()` — the **invoices** endpoint. The invoices controller at `InvoicesController.cs:1227-1229` queries `_db.Invoices` for the provided ID, doesn't find a bill ID in the invoices table, and returns 404.

**The bill detail page passes `documentKind="bill"`** (`BillDetail.tsx:456`), so every bill preview hits the wrong endpoint.

The **actual post** (`handlePost()`) calls `apiClient.post()` which correctly maps to the bills endpoint (`BillDetail.tsx:138`, `api-client.ts:1445`). The user never reaches it because the preview modal shows an error first and blocks confirmation.

#### Backend is correct

The backend bill post-preview endpoint is correctly implemented at `BillsController.cs:901-948`:
- Loads company and bill by ID with company scoping
- Calls `bill.Post()` in a preview context (no SaveChanges)
- Returns the journal entry preview

No backend fix is needed.

#### Proposed Fix

**File:** `apps/web/src/components/shared/PostingPreview.tsx:39-41`
**Change:** Swap the method calls:

```typescript
// Before (WRONG):
const data = documentKind === "invoice"
  ? await apiClient.postPreview(companyId, documentId)
  : await apiClient.postPreview2(companyId, documentId);

// After (CORRECT):
const data = documentKind === "bill"
  ? await apiClient.postPreview(companyId, documentId)
  : await apiClient.postPreview2(companyId, documentId);
```

---

### Finding 5 — Sales Invoice Post Preview / Posting Blocked (P1, CONFIRMED BUG — SAME ROOT CAUSE)

**Severity:** P1 — blocks all sales invoice posting via the preview flow
**Confidence:** Confirmed
**Root cause:** Same swap as Finding 1

When `documentKind === "invoice"` (passed by `InvoiceDetail.tsx:553`), the code enters the `if` branch and calls `apiClient.postPreview()` — the **bills** endpoint. The bills controller queries `_db.Bills` for the invoice ID, doesn't find it, and returns 404.

**Same fix as Finding 1 resolves both.**

The actual invoice post (`apiClient.post2()`) is correctly wired (`InvoiceDetail.tsx:154`, `api-client.ts:7776`).

---

### Finding 2 — Receipt Net Unit Cost Is Not Prefilled (P2, BY DESIGN)

**Severity:** P2
**Confidence:** Confirmed as current behavior; whether it's a defect depends on product decision
**Status:** Not a code bug — no cost source exists to prefill from

#### Evidence

The stock document form at `StockDocumentDetail.tsx:56` initializes lines with:
```typescript
const emptyLine = (): Line => ({ itemId: "", quantity: "", unitCost: "", note: "" });
```

When an item is selected (`StockDocumentDetail.tsx:397`), `setLine(index, { itemId: v })` is called — this sets only the `itemId`, not `unitCost`. There is no lookup for last purchase price, average cost, or any other cost source.

The `Item` entity (`Item.cs:33`) has `DefaultUnitPrice` which is a **selling price**, not a purchase cost. The `ItemCost` entity (used by `StockService`) holds the current weighted average cost, but this is not exposed in the stock document form.

#### Assessment

This is a UX gap rather than a bug. The item model has no dedicated `DefaultPurchaseCost` field. The weighted average cost (`ItemCost.AverageCost`) exists but is an internal valuation figure, not a purchase cost default.

#### Recommendation

1. **Short-term:** Add a "Last purchase cost" lookup: when an item is selected on a receipt line, fetch the most recent `StockMove` of kind `Receipt` for that item and use its `UnitCost` as the editable default. An API endpoint like `GET /api/companies/{companyId}/items/{itemId}/last-cost` would serve this.
2. **Long-term:** Consider adding `DefaultPurchaseCost` to the Item entity, updated on each bill posting or receipt.
3. The selling price (`DefaultUnitPrice`) must **never** be used as a cost default — these are different concepts.

---

### Finding 3 — Receipt Posts Successfully; Accounting Integration (P1 for correctness verification, PASS)

**Severity:** Informational — the receipt posting is correct
**Confidence:** High

#### How Receipt Posting Works

**File:** `StockDocumentService.cs:270-278` (receipt case in `PostAsync`):
1. Creates `StockMoveKind.Receipt` move requests from Supplier virtual location → warehouse stock location
2. Calls `StockService.ApplyAsync` which creates `StockMove` records and updates `StockBalance` and `ItemCost`

**Journal entry** (`StockDocumentService.cs:457-465`):
- **Dr 120100 (Goods for Sale / Inventory)** for the receipt value
- **Cr 120800 (Goods Received Not Invoiced / GRNI)** for the same amount
- This is proper two-step purchasing accounting (Phase 2, §12 P6)

**Example:** 87 liters × €2.66 = €231.42 → Dr 120100 €231.42 / Cr 120800 €231.42

#### Double-Counting Prevention (Bill + Receipt)

**File:** `BillsController.cs:1222-1293` (`PostBillStockAsync`):

When a bill is posted for a tracked item, the system:
1. Calls `OpenReceiptLinesAsync` to find posted receipt lines from the same vendor for the same items
2. **Matches** bill lines against open (un-billed) receipt lines, tracking via `ReceiptMatch` records
3. For **matched quantities**: no new stock receipt — instead, clears 120800 (GRNI) by adding `Dr 120800 / Cr 120100` to the bill's journal entry. If the bill price differs from the receipt cost, a `Revaluation` move adjusts the stock value.
4. For **unmatched quantities** (bill arrives before receipt): creates a normal stock receipt move

**Result:** 87 liters received once via receipt, then billed → total stock is exactly 87 liters, not 174.

#### Standalone Receipt (No Automatic Bill)

A standalone receipt does **not** create a bill. This is by design. The GRNI balance on account 120800 stays until a matching bill is posted. There is no automated bill creation from receipts.

---

### Finding 4 — Sales Invoice Selling-Price Autofill (P2, LIKELY NOT A DEFECT)

**Severity:** P2
**Confidence:** Working as designed; the €1.45 is the item's persisted `DefaultUnitPrice`
**Status:** Suspected data verification issue, not a code bug

#### How Price Autofill Works

**File:** `apps/web/src/lib/item-line-defaults.ts:37`:
```typescript
unitPrice: item.defaultUnitPrice != null ? String(item.defaultUnitPrice) : "",
```

The flow:
1. When an item is selected on an invoice line, `applyItemDefaultsToLine` fills `unitPrice` from `Item.DefaultUnitPrice` (`Item.cs:33`)
2. If the invoice is `GrossInclusive` and not a sales return, `resolvePrices` is called (`InvoiceForm.tsx:392-401`) to check price lists. If a price list price exists (source != "item"), it overrides the item default.
3. The user can always manually override the price.

**The €1.45 value** is whatever is stored as `DefaultUnitPrice` for Naftë D2 in the database. This is distinct from the purchase cost (€2.66). Selling below cost is legitimate (loss-leader, promotional, etc.) — but the tester should verify the stored item price is what they intended.

#### Pricing Precedence

1. Customer-specific price list (via `resolvePrices` endpoint) — highest priority
2. Company price list
3. `Item.DefaultUnitPrice` — base default
4. Empty (user must enter manually)

#### Recommendation

To verify: check the Naftë D2 item's `DefaultUnitPrice` via the item edit screen or API. If it shows €1.45 and the tester intended a different price, they need to update the item. No code fix needed unless a stale-cache or save-failure issue is found.

---

## 3. Shared Dependency Analysis

### Common Root Cause for Finding 1 & 5: YES

Both bill and invoice posting failures share the exact same root cause: the `PostingPreview.tsx` component has its API method mapping **swapped**. The condition `documentKind === "invoice"` calls the bills endpoint, and the else branch (for bills) calls the invoices endpoint.

### Why Stock Document Posting Works

Stock documents (`StockDocumentDetail.tsx`) use a **direct post** flow without a post-preview step:
- The post button calls `apiClient.postStockDocument(companyId, id)` directly
- There is no `PostingPreview` component involved
- Therefore the method-swap bug does not affect stock documents

### Posting Flow Comparison

| Document | Preview | Post | Working? |
|----------|---------|------|----------|
| Bill | `postPreview` (→ bills, correct) but called for invoices | `post` (→ bills, correct) | Preview: BROKEN |
| Invoice | `postPreview2` (→ invoices, correct) but called for bills | `post2` (→ invoices, correct) | Preview: BROKEN |
| Stock Doc | No preview step | `postStockDocument` (correct) | WORKING |

---

## 4. Inventory & Accounting Correctness

### Scenario: 87 received → 7 sold → 80 remaining

Assuming the preview bug is fixed and all transactions post:

1. **Receipt (standalone):** 87 L × €2.66 = €231.42
   - Stock: +87 L at €2.66 avg cost
   - Journal: Dr 120100 €231.42 / Cr 120800 €231.42

2. **Bill (for same goods):** 87 L (matched to receipt)
   - Stock: no additional quantity (receipt already brought it in)
   - Journal: Dr 120800 €231.42 / Cr 211000 (Payables) €231.42 (plus VAT lines)
   - GRNI cleared; if bill price ≠ receipt cost, a revaluation move adjusts

3. **Sales Invoice:** 7 L × selling price
   - Stock: -7 L (issue at weighted average cost €2.66)
   - Journal: Dr COGS €18.62 / Cr 120100 €18.62 (plus Dr Receivables / Cr Revenue)
   - **Remaining:** 80 L at €2.66 avg = €212.80

### Valuation Method

Weighted average cost (AVCO) per `INVENTORY_PLAN.md`. The `AverageCost` calculator in `Pako.Domain/Inventory/AverageCost.cs` handles receipt, issue, and revaluation operations.

### Double-Counting Prevention

- `ReceiptMatch` table (`BillsController.cs:1268`) tracks which receipt lines have been matched to bill lines
- `OpenReceiptLinesAsync` (`BillsController.cs:1317`) subtracts already-matched quantities
- A receipt dated after the bill is still matched (line 1316 comment) — prevents bringing goods in twice
- Company-level row lock (`BillsController.cs:1219`) serializes concurrent bill posts against the same receipts

---

## 5. Proposed Changes (Priority Order)

### Change 1 — Fix PostingPreview Method Swap (P1, CRITICAL)

**File:** `apps/web/src/components/shared/PostingPreview.tsx`
**Line:** 39-41
**Change:** Swap the condition from `documentKind === "invoice"` to `documentKind === "bill"`
**Risk:** None — pure logic fix
**Tests needed:** See §6

### Change 2 — Receipt Cost Prefill (P2, ENHANCEMENT)

**Backend:**
- Add `GET /api/companies/{companyId}/items/{itemId}/cost-hint` endpoint returning the latest `ItemCost.AverageCost` or last receipt's `UnitCost`
- Or include `averageCost` in the existing `ItemResponse`

**Frontend:**
- In `StockDocumentDetail.tsx`, when an item is selected on a receipt line, fetch the cost hint and set `unitCost` as a default
- Only for receipt types; not for delivery, count, etc.

### Change 3 — Verify Item Prices (P3, DATA CHECK)

No code change. Verify that the Fuel Station's Naftë D2 item has the intended `DefaultUnitPrice`. If the tester set a different price and it didn't persist, investigate the item save flow.

---

## 6. Test Plan

### Automated Tests for Change 1

**Frontend unit test** (new file or extend existing):

```typescript
// PostingPreview.test.tsx
describe("PostingPreview", () => {
  it("calls bills postPreview for documentKind=bill", async () => {
    // Mock apiClient.postPreview to verify it's called (not postPreview2)
    const spy = vi.spyOn(apiClient, "postPreview").mockResolvedValue({ lines: [] });
    render(<PostingPreview companyId="c1" documentKind="bill" documentId="b1" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("c1", "b1"));
  });

  it("calls invoices postPreview2 for documentKind=invoice", async () => {
    const spy = vi.spyOn(apiClient, "postPreview2").mockResolvedValue({ lines: [] });
    render(<PostingPreview companyId="c1" documentKind="invoice" documentId="i1" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("c1", "i1"));
  });
});
```

### Manual Verification Steps

1. **Bill posting:** Create bill → save → click Post → preview should show Dr/Cr lines → Confirm → bill state becomes Posted
2. **Invoice posting:** Create invoice → save → click Post → preview should show Dr/Cr lines → Confirm → invoice state becomes Posted
3. **Stock scenario:** Receipt 87 L → Bill 87 L → Invoice 7 L → verify Stock Levels shows 80 L
4. **Journal check:** After all three are posted, verify no orphan GRNI balance (120800 should be cleared)
5. **Idempotency:** Attempting to post an already-posted document should return "only Draft can be posted"

### Regression Tests (Backend, existing)

Run `dotnet test backend/Pako.Tests/Pako.Tests.csproj` — all 198+ tests must stay green. The bill and invoice posting tests exercise the backend logic, which is correct; only the frontend method mapping is wrong.

---

## 7. Trello-Ready Subtickets

### Ticket 1: Fix PostingPreview API Method Swap

**Title:** Fix: PostingPreview calls wrong API endpoint (bills↔invoices swapped)
**Priority:** P1 — blocks all bill and invoice posting
**Dependencies:** None
**Implementation:**
1. Open `apps/web/src/components/shared/PostingPreview.tsx`
2. Line 39: change `documentKind === "invoice"` to `documentKind === "bill"`
3. Add unit test for PostingPreview verifying correct API method per document kind
4. Run `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test && pnpm --filter web build`

**Acceptance Criteria:**
- [ ] Bill post-preview returns journal entry lines (not 404)
- [ ] Invoice post-preview returns journal entry lines (not 404)
- [ ] Both bills and invoices can be posted through the preview flow
- [ ] Unit test covers both document kinds
- [ ] `pnpm --filter web typecheck`, `lint`, `test`, `build` all pass

**Definition of Done:** Merged to main, manual smoke test on Fuel Station company confirms both flows work.

### Ticket 2: Add Receipt Cost Prefill (Enhancement)

**Title:** Enhancement: Prefill unit cost on stock receipt from item's average cost
**Priority:** P2
**Dependencies:** None (independent of Ticket 1)
**Implementation:**
1. Backend: add cost-hint field to item response or new lightweight endpoint
2. Frontend: in `StockDocumentDetail.tsx`, on item selection for receipt lines, fetch and set `unitCost`
3. Ensure cost is editable (not locked)
4. Do not prefill for delivery, count, transfer, write-off types

**Acceptance Criteria:**
- [ ] Selecting an item on a receipt line prefills the cost field if a previous cost exists
- [ ] The prefilled cost is editable
- [ ] New items with no history show blank cost
- [ ] Non-receipt document types are unaffected

**Definition of Done:** Merged to main, manual test confirms prefill on receipt.

### Ticket 3: Verify Fuel Station Item Prices

**Title:** Data check: Verify Naftë D2 default selling price
**Priority:** P3
**Dependencies:** None
**Implementation:**
1. Open Fuel Station company → Items → Naftë D2
2. Verify `DefaultUnitPrice` matches the intended selling price
3. If wrong, update the item
4. If the item edit flow has a save bug, investigate separately

**Acceptance Criteria:**
- [ ] Naftë D2's selling price is confirmed correct
- [ ] Creating a new invoice line for Naftë D2 shows the expected price

---

## 8. Open Questions

1. **Should the post-preview be skippable?** Currently the UX requires preview before post. If the preview is failing (e.g., due to a missing account configuration), the user cannot post at all — even if they're confident. Consider adding a direct "Post without preview" option for experienced users.

2. **Receipt cost prefill source:** Should the prefill come from `ItemCost.AverageCost` (current weighted average), the last purchase bill price, or a dedicated `DefaultPurchaseCost` field? The weighted average may differ from the actual vendor price. Product decision needed.

3. **NSwag naming collision:** The generated client uses `postPreview` / `postPreview2` because two controllers expose the same action name. Consider renaming one to avoid future confusion — e.g., `[ActionName("BillPostPreview")]` in BillsController. This is a quality-of-life improvement, not urgent.

4. **Price lists for Fuel Station:** Are any price lists configured for this company? If so, the €1.45 selling price may come from a price list rather than the item's `DefaultUnitPrice`. Check via API: `GET /api/companies/{companyId}/price-lists`.

---

## Summary

| Finding | Severity | Status | Root Cause |
|---------|----------|--------|------------|
| F1: Bill can't post | P1 | **Confirmed bug** | PostingPreview.tsx method swap |
| F2: Receipt cost blank | P2 | By design (no prefill source) | Enhancement opportunity |
| F3: Receipt accounting | P1 (verify) | **PASS** — correct GRNI flow | No issue |
| F4: Invoice price €1.45 | P2 | Likely correct (data check needed) | Reads Item.DefaultUnitPrice |
| F5: Invoice can't post | P1 | **Confirmed bug** | Same swap as F1 |

**The single-line fix** in `PostingPreview.tsx:39` unblocks both P1 issues (Finding 1 & 5). The backend posting logic, stock movement, GRNI matching, and double-counting prevention are all correctly implemented.
