# Stock & inventory — analysis and plan

Status: **master plan, 2026-10-31.** The decisions are taken in §9 and the build order is in §11.
Phase 1 is complete (§11). Phase 2 is built except FIFO (§12).

This plan is based on three pieces of research done for this document:
- the Odoo **19.0** source (`addons/stock`, `stock_account`, `purchase_stock`, `sale_stock`,
  `stock_landed_costs`), compared with 18.0 and 17.0;
- QuickBooks Online and Desktop, from Intuit's documentation and API reference;
- PAKO's own code and the Kosovo chart of accounts.

---

## 1. Summary

PAKO's customers are mostly **traders**: they buy goods with a supplier invoice and sell them with an
invoice. PAKO has an item register (`Item`, type Goods/Service/Normative, with an inert
`DefaultInventoryAccountId`), but no quantities, no warehouses and no stock value.

Today a bill for goods posts **Dr 500100 Cost of goods sold** immediately. That is periodic
accounting with no closing entry, so the balance sheet never shows stock and gross margin is wrong
in any month where purchases and sales don't match.

What we build:

| | Decision | Comes from |
| --- | --- | --- |
| Ledger | One `stock_move` per quantity change: from location → to location, at a cost. Balances are a cache that can be rebuilt from the moves. | Odoo (all versions) |
| Valuation | **Continuous (perpetual) stock accounting, posted on the document itself, with no in-between accounts.** A bill debits stock; an invoice credits stock and debits cost of goods sold in the same entry. | Odoo 19.0 (which removed the 18.0 interim accounts) |
| Cost method | **Weighted average (AVCO)** in v1; FIFO in a later phase. Never LIFO, which IAS 2 and IFRS for SMEs forbid. | Odoo, QuickBooks, Kosovo practice |
| What moves stock | **A posted bill or invoice moves the stock itself**, so no purchase or sales order is needed. Separate receipt and delivery notes come in phase 2. | QuickBooks (Odoo always needs an order) |
| Negative stock | Company setting, **blocked by default**. | Lesson from QuickBooks complaints |
| Warehouses | Several per company, with transfers between them. | Odoo (QuickBooks Online can't do this) |

---

## 2. What PAKO has today

- **`Item`** (`Pako.Domain/Companies/Item.cs`):
  - `Type`: Goods, Service or Normative (a recipe-costed item such as a restaurant dish);
  - `Unit`;
  - `DefaultRevenueAccountId` and `DefaultExpenseAccountId`;
  - `DefaultInventoryAccountId`, currently unused ("field exists, feature doesn't yet");
  - barcodes.
- **Bill lines and invoice lines** already carry `ItemId`. A bill line's account comes from
  `line.ExpenseAccountId ?? item.DefaultExpenseAccountId ?? company default`
  (`BillsController`, around line 169). Invoices do the same with the revenue account.
- **Posting** is in `Invoice.Post` / `Bill.Post`, through `DocumentLineCalculator`. Credit notes,
  sales returns and purchase returns flip debit and credit.
- **The chart already has the stock accounts** (`PAKO_COA_v2_seed.csv`):

  | Code | Account | Use |
  | --- | --- | --- |
  | 120100 | Goods for Sale | stock valuation |
  | 120200–120500 | Raw materials, work in progress, finished goods, consumables | manufacturing, later |
  | 120600 / 120700 | Goods in transit / in customs warehouse | imports, phase 3 |
  | 120800 | Goods received not invoiced | phase 2, receipt before bill |
  | 120900 | Inventory write-down (contra) | phase 2 |
  | 500100 | Cost of Goods Sold | cost of goods sold |
  | 510100–510900 | Customs duty, excise, freight… and *Landed cost absorbed* (contra) | landed costs, phase 3 |
  | 520100 / 520200 | Inventory shortages / overages | stock counts (the chart notes that VAT may have to be repaid on unexplained shortages) |
  | 520300 | Write-offs and scrap | scrap |

- **No opening-balance clearing account** exists; the equity accounts are 300100–307100. See
  decision D3.
- **The design debt already noted in `docs/ODOO_COMPARISON.md`:** invoice, bill and journal entry are
  three separate document models where Odoo has one. Stock adds receipt and delivery notes,
  transfers, counts and opening stock. See §5.

---

## 3. How Odoo does it (19.0 source)

### Operations (`addons/stock`)

- **Locations form a tree, and each has a `usage`**: `internal` (real stock), `supplier`,
  `customer`, `inventory` (count losses and scrap), `transit`, `view` (grouping only), and
  `production`.
  - Only `internal` and `transit` count as stock on hand.
  - Supplier, customer and inventory are virtual counterparts. They go negative, so every
    quantity change is double-entry, like the ledger.
- **A warehouse** (`stock_warehouse.py`) is a root location plus a main stock location, operation
  types, and the routes and rules generated for its 1, 2 or 3-step receipts and deliveries.
- **`stock.move`** is the line of an operation: product, demand quantity, from and to location,
  state.
  - It moves through `draft → waiting/confirmed → partially_available → assigned → done → cancel`:
    - `_action_confirm` confirms;
    - `_action_assign` reserves (raises `stock.quant.reserved_quantity`);
    - `_action_done` validates; each move line then calls `_synchronize_quant`, which updates the
      balances.
  - `stock.move.line` carries the lot, package and the actual quantity.
- **`stock.quant`** holds one row per (product, location, lot, package, owner), with `quantity` and
  `reserved_quantity`.
  - Stock on hand = the sum over internal locations.
  - Forecast = on hand + incoming − outgoing over open moves (`_compute_quantities_dict`).
  - `_update_available_quantity` locks the quant row before writing.
- **Negative stock is allowed silently.** Core Odoo never refuses; only scrap warns.
- **Counting is per quant**, since the old count document was removed in 15.0:
  - the user enters `inventory_quantity`;
  - `action_apply_inventory` creates a done move to or from the "Inventory loss" location;
  - a conflict wizard appears if stock moved after the count.
  - **Scrap** is the same: a move to a scrap location.
- **Removal strategies** (FIFO/LIFO/FEFO by `in_date`) choose *which units physically leave*.
  They are separate from cost.
- **Putaway rules** decide where incoming stock is stored. Routes, rules, procurement and reordering
  rules automate replenishment. **Most of this is warehouse-management machinery a small trader
  doesn't need.**
- **Purchases and sales.**
  - A confirmed purchase order or sales order creates the receipt or delivery.
  - Received or delivered quantities drive what can be billed or invoiced.
  - **A bill or invoice on its own never moves stock in Odoo**: no code path creates a
    `stock.move` from an `account.move`.
  - We deliberately do the opposite (§4.3).

### Valuation (`addons/stock_account`)

**19.0 rebuilt valuation.**
- In 17.0 and 18.0 cost sat in a `stock.valuation.layer` table, and every receipt or delivery
  posted through two in-between accounts, *Stock Input* and *Stock Output*, which were reconciled
  later.
- 19.0 removes both:
  - the value is stored on `stock.move.value`;
  - FIFO's remaining quantities are computed, not stored;
  - manual revaluations live in `product.value`;
  - continuous accounting now means **"Perpetual (at invoicing)"**.

**What 19.0 posts:**

| Event | Entry |
| --- | --- |
| Vendor bill | **Dr Stock / Cr Payable**. The line's account is swapped to the stock account, and the bill price becomes the receipt's value. |
| Customer invoice | Normal lines, **plus cost of goods sold lines: Dr COGS / Cr Stock** at the delivery's cost (`_stock_account_prepare_realtime_out_lines_vals`). |
| Credit note | The same, reversed. Average and standard cost reuse the original invoice's cost. |
| Receipt / delivery / internal transfer | **No entry.** |
| Count adjustment / scrap | Dr/Cr against the location's account. If none is set, a periodic closing entry catches the difference. |
| Value check | `stock_value()` compared with `stock_accounting_value()`, the GL balance of the stock account. |

**Cost methods:**
- **Average:** `new = (on_hand × cost + incoming value) / (on_hand + incoming)`. When stock was zero
  or below, it resets to the incoming unit cost. Issues are valued at the current average.
  `_run_average_batch` replays moves by `(date, id)`, which handles back-dated documents.
- **FIFO:** consumes the oldest incoming moves still in stock.
- **Standard:** a fixed cost, with differences going to a price-difference account.

**The order of sources for an incoming move's cost** is: a manual value, the posted bill, the
purchase order price, the original move (for returns), then the product's standard price.

**Negative stock.**
- 18.0 had a "vacuum" that re-valued earlier negative issues when a receipt arrived.
- 19.0 values them at the last cost and leaves the closing entry to correct.

**Landed costs** (`stock_landed_costs`):
- Freight and duty are split over receipts by quantity, value, weight or volume. Only FIFO and
  average-cost items qualify.
- The share still in stock is debited to Stock; the share already sold stays in expense.
- The cost is then recomputed.

---

## 4. How QuickBooks does it

**Items.**
- An item tracks quantity when its type is *Inventory* (`TrackQtyOnHand`). This needs QuickBooks
  Online Plus or Advanced.
- Each item has three accounts: income, cost of goods sold (`ExpenseAccountRef`) and inventory asset
  (`AssetAccountRef`).
- The starting quantity is entered with an "as of" date and posts **Dr Inventory / Cr Opening
  Balance Equity**.

**Cost method.**
- QuickBooks Online is **FIFO, or moving average for companies created recently**. The choice is
  made once and can't be changed.
- QuickBooks Desktop uses average cost; Enterprise can switch to FIFO.

**Postings.** Cost of goods sold is posted **on the invoice or sales receipt**:
- a bill debits inventory;
- a quantity adjustment posts against an "inventory shrinkage" account;
- a vendor credit credits inventory;
- a customer credit memo reverses cost of goods sold.

**Purchase orders, receipts and locations.**
- **A bill moves stock directly.** Purchase orders post nothing.
- There's no "receive before bill" in Online. Desktop has *Item Receipts*.
- **Online has no warehouses.** "Location" is only a reporting tag: no stock per location, no
  transfers, no lots or serials, no bins.

**What accountants complain about**, which we should avoid:
- The cost method can't be changed.
- There's **no revaluation**, so write-downs to net realisable value are awkward.
- There's **no landed cost**, which hurts importers.
- **Selling below zero quietly rewrites cost of goods sold in past, already-reported periods.**
- Journal entries to the Inventory account let the ledger drift from the stock report.

**Worth copying:**
- one switch makes an item stock-tracked, with accounts pre-filled;
- **quantity on hand shown in the invoice line item picker**, with a warning when you exceed it;
- an adjustment grid showing current, counted and difference;
- a printable count sheet;
- a "low stock" filter that drafts reorders by supplier;
- valuation detail as the drill-down behind the balance-sheet stock figure.

---

## 5. Proposed design for PAKO

### 5.1 Model

**`Item`** gains:
- `TrackInventory` (bool; only for Goods, and Normative later);
- the existing `DefaultInventoryAccountId`, now used: default 120100;
- `DefaultExpenseAccountId`, which becomes **cost of goods sold** (default 500100) for tracked items;
- `MinimumStock`, optional, for the low-stock report.

The company gains:
- `CostMethod` (Average; FIFO in phase 2);
- `NegativeStockPolicy` (Block | Warn);
- `DefaultWarehouseId`;
- a stock start date.

**`Warehouse`** (company, code, name, address, IsActive) and **`StockLocation`** (warehouse, parent,
name, `Usage`):
- `Usage` is Internal, Transit, Supplier, Customer, Adjustment, Scrap or Opening.
- Each company gets one set of virtual locations (supplier, customer, adjustment, scrap, opening).
- Each warehouse gets one Internal "Stock" location. Sub-locations and bins come later.

**`StockMove`, the immutable stock ledger.** One row per quantity change:
- company, date, item;
- `Quantity` in the item's base unit;
- `FromLocationId` and `ToLocationId`;
- `UnitCost` and `Value` (2 decimals), with the sign coming from the direction;
- `State` (Draft | Done | Cancelled);
- the source: `SourceType` (Bill, Invoice, StockDocument) + `SourceId` + `SourceLineId`;
- `JournalEntryId`, when the move was posted to the ledger.

Done moves are never edited. A correction is a new, reversing move, the same rule as the ledger.

**`StockBalance`, Odoo's quant:**
- one row per (item, location, later lot): `Quantity`;
- one row per (company, item): `AverageCost` and `Value`;
- updated in the same transaction as the move, under a row lock;
- **rebuildable from moves**, with a "rebuild balances" admin tool.

**`StockDocument` is one aggregate for every stock-only document**: opening stock, transfer, count
(adjustment), scrap, and in phase 2 receipt and delivery notes.
- Fields: `Type`, number series, date, warehouse(s), state Draft → Posted → Cancelled, lines (item,
  quantity, unit cost where relevant, from/to location).
- **This settles the document-model question for stock:** one aggregate for all of these documents
  instead of one per type. Bills and invoices stay as they are.

### 5.2 Cost: weighted average (AVCO)

On each incoming move:
- `avg = (qty_on_hand × avg + incoming value) / (qty_on_hand + incoming qty)`;
- if quantity on hand is 0 or less, `avg = incoming unit cost`.

On each outgoing move:
- `value = round₂(avg × qty)`;
- the move that empties stock takes the exact remaining value, so value is zero when quantity is
  zero and rounding never accumulates.

All of this lives in **one domain service (`StockCostingService`)**, never in a controller or the
browser. That follows the repo rule on money arithmetic.

**Back-dated documents** (a bill entered after later sales):
- replay average cost from that date forward, as `_run_average_batch` does;
- any change to cost of goods sold already posted is booked as **one correction entry in the
  current open period**, never in a closed one. This avoids the QuickBooks complaint and respects
  PAKO's lock dates.

### 5.3 What moves stock, and what it posts

For tracked items, posting a document creates its moves and adds lines to its **own** journal
entry. There are no in-between accounts, as in Odoo 19.

**Account notation:** **Inv** = the item's inventory account (120100); **COGS** = the item's cost of
goods sold account (500100).

| Document | Stock move | Ledger (added to the document's own entry) |
| --- | --- | --- |
| **Bill** (Goods line, tracked item) | Supplier → bill's warehouse, valued at the line's net amount | The line debits **Inv** instead of an expense account. VAT and payable are unchanged. |
| **Purchase return / supplier credit note** | Warehouse → Supplier, at the credit amount | **Cr Inv** (instead of the expense account). A difference from the average is absorbed into the average, or posted to COGS if stock is zero. |
| **Invoice** (Goods line, tracked item) | Warehouse → Customer, at the average cost | Revenue, VAT and receivable unchanged, **plus Dr COGS / Cr Inv** |
| **Sales return / credit note** with goods coming back | Customer → warehouse, at the **original invoice's cost** | **Dr Inv / Cr COGS**. A price-only credit note (no goods back) moves no stock. |
| **Opening stock** | Opening → warehouse, at the cost entered | **Dr Inv / Cr opening account** (D3) |
| **Count adjustment** | Warehouse ↔ Adjustment | Shortage **Dr 520100 / Cr Inv**; overage **Dr Inv / Cr 520200** |
| **Scrap / write-off** | Warehouse → Scrap | **Dr 520300 / Cr Inv** |
| **Transfer between warehouses** | Warehouse A → Warehouse B (or via transit) | none |

**Lock dates and controls:**
- Stock documents follow the same lock dates as everything else. A stock document dated in a locked
  period is refused.
- The **inventory account becomes a control account**: manual journal entries to 120100 are refused
  (rule R04, `IsControl`). Only stock documents post there, so the ledger and the stock report can't
  drift apart.
- A **stock value vs ledger** report checks they agree at any date.

### 5.4 Negative stock

- **Block (default):** posting an invoice, transfer or scrap that would take a warehouse below zero
  is refused, with "Only 3 left in Main warehouse".
- **Warn:** posting is allowed and issues at the current average. When stock arrives, the difference
  is posted as a correction in the current period (a simple version of Odoo 18's "vacuum").
- Most Kosovo traders sometimes invoice before entering the supplier bill, so some will want Warn.
  Blocking is the safe default, though: it keeps past cost of goods sold stable.

### 5.5 Reports

| Report | Contents |
| --- | --- |
| **Stock list** | Quantity on hand per warehouse, average cost, value, below-minimum flag |
| **Item card** ("kartela e artikullit") | Every move with running quantity, cost and value. This is what Kosovo accountants and ATK auditors look for. |
| **Valuation at a date** | Total and per item, exportable to Excel |
| **Stock vs ledger** | Difference per stock account |
| **Count sheet** | Printable list to count against, which becomes the count document |
| **Low stock** | Items below minimum, grouped by usual supplier |
| **Sales margin by item / customer** | Becomes possible once invoices carry cost |
| **Dashboard widgets** | Stock value, low stock, gross margin trend |

### 5.6 Interface

**Items**
- "Track stock" switch; on-hand quantity and value per warehouse.
- An item-card tab and opening stock entered from the item.

**Bills**
- A warehouse field in the header, defaulting to the company's.

**Invoices**
- Warehouse in the header; **on-hand quantity in the item picker**.
- Over-quantity warning (Warn) or refusal (Block) before posting.
- The line shows its cost and margin to users who can see cost.

**New "Stock" menu section**
- Stock list, transfers, counts, scrap, opening stock, warehouses, reports.

**Settings**
- Cost method (locked once stock has moved), negative-stock policy, default warehouse, stock start
  date.

**Access**
- A new area, **Inventory**, with View / Edit / Approve:
  - Edit drafts stock documents;
  - Approve posts them;
  - users without access don't see cost or margin.
- It is a switchable **module** in the platform panel.

---

## 6. Kosovo specifics

- **Cost formula:** IAS 2 and IFRS for SMEs (§13) allow FIFO and weighted average and forbid LIFO.
  Average is what local tools (Pantheon, Financa and others) default to.
- **Annual count ("inventarizimi"):** the Law on Accounting requires a physical count at least at year
  end. Count documents, the count sheet and the shortage/overage postings cover this. Year-end close
  should warn when no count was posted that year.
- **VAT on shortages:** unexplained shortages may require repaying the input VAT (noted on 520100).
  Phase 1 records the reason on every shortage line. Phase 2 can suggest a VAT adjustment for
  "unexplained" lines.
- **Receipt and delivery notes ("fletëhyrje", "fletëdalje", "fletëdërgesë")** are used everywhere,
  often before the invoice. They come in phase 2 as `StockDocument` types linked to bills and
  invoices.
- **Imports (IM4) and landed cost:** customs duty, excise and international freight (group 51) belong
  in the cost of imported goods, which QuickBooks can't do. This is phase 3 and builds on 510900
  "Landed cost absorbed".

---

## 7. Phases

### Phase 1 — stock that follows bills and invoices (the core)

1. **Model:** warehouses, locations, `StockMove`, `StockBalance`, item and company settings, one
   migration.
2. **Valuation:** `StockCostingService` (average cost, rounding, back-date replay, corrections in
   the open period), with heavy unit tests.
3. **Posting:**
   - bills, invoices, credit notes and returns create moves and the stock and cost-of-goods-sold
     lines;
   - negative-stock policy;
   - lock dates;
   - 120100 becomes a control account.
4. **`StockDocument`:** opening stock, transfer, count, scrap.
5. **Reports:** stock list, item card, valuation at a date, stock vs ledger, count sheet, low stock.
6. **Web:** stock section, item tab, warehouse on bills and invoices, on-hand quantity in pickers,
   settings, the Inventory access area and module.
7. **Seed and e2e:** extend `scripts/seed_demo.py` with stock, plus an e2e script that checks the
   numbers end to end.

### Phase 2 — the document flow traders expect

- Receipt and delivery notes linked to bills and invoices (120800 for goods received but not yet
  invoiced).
- FIFO as an option.
- Lots with expiry dates.
- Purchase and sales units (box = 24 pieces).
- Write-downs (120900).
- Purchase orders and the low-stock-to-purchase-order flow.
- Margin reports.

### Phase 3 — importers and growth

- Landed costs and import documents (IM4).
- Sales orders with reservation.
- Barcode scanning.
- Serial numbers.
- Bins.

**Deliberately not planned:** Odoo's routes, rules and procurement engine; 2- and 3-step
receipts and deliveries; putaway rules; packages; consignment ownership.

---

## 8. Risks

- **This changes how existing bills post.** For tracked items, a bill debits 120100 instead of
  500100. Existing companies must opt in per item, from a stock start date with an opening count, so
  past periods stay untouched.
- **Back-dated documents** can ripple through average cost; the replay must be fast and correct.
  It's tested at 10,000+ moves per item.
- **Concurrency:** two invoices selling the last unit at the same time. Row locks on `StockBalance`,
  and tests on real Postgres (the suite already runs on Postgres).
- **Three document models:** `StockDocument` keeps stock to one new aggregate, but phase 2 notes
  must link cleanly to bills and invoices. The links are designed in phase 1.

---

## 9. Decisions (taken 2026-10-31, after the second research round)

These come from the Kosovo research (Law 06/L-032, VAT Law 05/L-037 with AI 03/2015, CIT Law
06/L-105, AI MF 01/2026, the Consumer Protection Law 06/L-034, and local ERP manuals) and from
Odoo 19, ERPNext and Business Central.

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Weighted average (perpetual)** is the only cost method in phase 1; FIFO comes in phase 2. The method is stored with an **effective date** and can't be changed once stock has moved. | IFRS for SMEs §13 and the CIT instruction allow FIFO and average and forbid LIFO. The CIT instruction keeps the chosen method for that year plus at least 3 tax periods, with changes only by ATK ruling. Local tools and the item card ("kartela") work on average cost. |
| D2 | **Negative stock is blocked by default.** "Warn" is a company setting. The check also catches a back-dated issue that would make a *later* balance negative. | ERPNext's default, and it avoids the QuickBooks problem of cost of goods sold changing in past periods. |
| D3 | **Opening stock credits a new "Opening balance clearing" account (390100)**, a class-3 control account that must end at zero, never Retained Earnings. The account is added to the chart and created on demand for existing companies. | ERPNext's *Temporary Opening* and Odoo's opening balancing account. It makes a count-vs-books difference visible instead of hiding it in equity. |
| D4 | An invoice that would take a warehouse below zero is refused under Block and allowed under Warn. Under Warn, the next receipt posts a **correction** for the cost difference. | Simplified form of Odoo's FIFO/AVCO "vacuum". |
| D5 | **Tracking is switched on per item.** Each tracked item starts from an opening stock document. Untracked items keep posting exactly as today. | Existing companies migrate item by item without touching past periods. |
| D6 | **Phase 1 has no separate delivery or receipt notes.** Posted bills and invoices move the stock themselves. | No Kosovo rule requires a document to accompany goods in domestic transport (Road Transport Law 04/L-179 Art. 45). The tax invoice or fiscal receipt is the legal document. |
| D7 | **A new Inventory access area (None/View/Edit/Approve)** and a switchable **Inventory module**. Cost and margin are visible only with Inventory: View. | Same pattern as Payroll. |
| D8 | **Normative (recipe) items don't carry stock** in phase 1. | They need bills of materials (phase 3). |
| D9 | **Product categories (`ItemCategory`)** carry the stock, cost-of-goods-sold, revenue and expense accounts. Accounts are resolved item → category → company default. | Odoo `product.category`, ERPNext Item Group, Business Central posting groups. Without categories, every item has to be set up by hand. |
| D10 | **The stock ledger stores running totals.** Each move records the company-wide quantity after it, average cost after it and value after it, plus a sequence number that breaks ties on the same date. Stock at a date is one lookup. | ERPNext's Stock Ledger Entry. |
| D11 | **Back-dated documents recalculate synchronously**, in the posting transaction, from that date forward, and never into a locked period. Changes to cost of goods sold already booked are posted as **one correction entry dated with the triggering document**. Posted entries are never rewritten. | ERPNext's background re-posting is a known source of pain. PAKO's companies are small enough to recalculate in place, and lock dates stop it at closed periods. |
| D12 | **Average cost is per company, not per warehouse.** Quantities are per warehouse. A transfer changes neither cost nor the ledger. | Odoo's model, and what local item cards show. |
| D13 | **Supplier credit notes for tracked items are value-only moves.** They lower stock value without changing quantity, or go to cost of goods sold when nothing is in stock. **Purchase returns** take quantity out. **Sales returns** bring goods back at the original invoice's cost. **Customer credit notes** are price-only and move no stock. | Odoo's `_get_lines_from_original_invoice` and QuickBooks credit-memo behaviour. |
| D14 | **Write-offs carry a reason** (expired / damaged / theft / disaster / count shortage) and an attachment. Expired or damaged goods also record the date the ATK notice was sent; posting is refused until 10 days after it. Theft and unexplained shortages are flagged for **input VAT repayment**. The automatic VAT entry comes in phase 2; phase 1 records it and warns. | AI 03/2015 Arts. 61–62: theft and unexplained shortages lose the input VAT, and destruction needs ATK notice at least 10 days before. |

## 10. Connected modules

These sit next to stock and make it work. Each is rated for a Kosovo trader, with the phase it
belongs to.

| Module | Rating | What, minimally | Phase |
| --- | --- | --- | --- |
| **Product categories** | must | Accounts per category, items inherit them (D9) | 1 |
| **Stock valuation & margin reports** | must | Valuation at a date, stock vs ledger, margin per item, customer and month | 1 |
| **Yearly count** | must | Count sheet → count document → shortage/overage postings. Year-end close warns when no count was posted in the year. | 1 (count); 2 (year-end warning) |
| **Write-offs with ATK procedure** | must | D14 | 1 (record and warn); 2 (VAT entry) |
| **Low-stock report** | should | Minimum per item; list grouped by usual supplier | 1 |
| **Price lists & retail shelf price + "Nivelim" (price change)** | should | A sale price list per warehouse or shop, VAT-inclusive. A dated price-change document that lists old and new price × on-hand quantity, printable as the shelf record (Consumer Protection Law Art. 26). Pricing only, no ledger postings. | 2 |
| **Units of measure** | should | Base unit plus purchase/sale unit with a fixed factor | 2 |
| **Purchase orders** | should | Order → bill with a line link and a soft three-way match | 2 |
| **Receipt & delivery notes** | should | Linked to bills and invoices (120800 goods received not invoiced) | 2 |
| **FIFO** | could | Second cost method | 2 |
| **Lots & expiry** | could (must for food and pharma) | Optional per item | 2 |
| **Import costing ("Kalkulimi IM4") / landed cost** | should for importers | Supplier bill + transport bills + customs declaration (duty, excise) spread by value or quantity onto the receipt's cost. Duty and excise go through 51xxxx and 510900; import VAT stays deductible. | 3 |
| **Sales orders & reservation** | could | "Committed" quantity, then real reservation | 3 |
| **Barcode scanning on documents** | could | Barcodes already exist on items | 3 |
| **Bundles / recipes (Normative)** | could | A component list that expands into component moves | 3 |

## 11. Phase 1 build order and status

**Backend**
- [x] 1. **Model and migration.** `ItemCategory`; item fields (`CategoryId`, `TrackInventory`,
  `MinimumStock`); `StockSettings` per company; `Warehouse`; `StockLocation`; `StockMove` (with
  running totals); `StockBalance` per (item, location); `ItemCost` per (company, item);
  `StockDocument` + lines; `WarehouseId` on invoices and bills; the Inventory area on roles; the
  Inventory module; account 390100.
- [x] 2. **`StockCostingService`.** Average cost, rounding, value-only moves, synchronous
  back-dated recalculation with a correction entry, the negative-stock check (including future
  balances), row locks.
- [x] 3. **Posting.** Bills (stock account on tracked lines, incoming / value-only / purchase-return
  moves), invoices (cost-of-goods-sold lines inside the invoice's own entry, sales returns at the
  original cost), refusals under Block.
- [x] 4. **Stock documents.** Opening, transfer, count, write-off: draft → post, numbered, lock dates,
  ledger entries.
- [x] 5. **Read APIs and reports.** Warehouses, categories, settings, stock list, item card,
  valuation at a date, stock vs ledger, low stock, margin.
- [x] 6. **Tests.** Postgres, every posting path, back-dating, concurrency, negative stock, rounding.
  *Status:* `AverageCostTests` (11) and `StockTests` (14) on Postgres, including four sales racing
  for the same stock on separate connections (`ParallelSales_ForTheSameStock_NeverOversell`).

**Web**
- [x] 7. **Stock section.** Stock list, item card, documents (opening, transfer, count, write-off),
  warehouses, categories, stock settings.
- [x] 8. **Items, bills, invoices.** The item form's category, tracking and minimum stock, plus a
  stock tab. The warehouse on bills and invoices. On-hand quantity in the item picker.
  Over-quantity warning.
  *Status:* the item editor has a Stock tab (the item card) for stock-tracked items. On-hand shows
  under each line's quantity rather than inside the picker.
- [x] 9. **Reports and access.** Reports, dashboard widgets (stock value, low stock, margin), the
  Inventory area in roles, the Inventory module in the admin panel.
- [x] 10. **Demo data and e2e.** `seed_demo.py` with categories, warehouses, opening stock and
  stock-tracked bills and invoices; `scripts/e2e/stock.py`.

Gaps closed after the first merge: write-off attachments (D14) through the real attachments API —
which also moved invoice and bill attachments off their browser mock; the low-stock list names
each item's usual supplier (latest posted purchase bill) and the shortfall, grouped by supplier;
the count sheet prints as a PDF, optionally blind (without book quantities).

Verified 2026-10-31: backend 703 tests, web 250 tests, typecheck/lint/build, `scripts/e2e/stock.py`
(24 checks), and a full `seed_demo.py` run whose stock value ties to account 120100 to the cent.

## 12. Phase 2 build order and status

Ordered so each step stands on its own and the riskiest changes to posting come last.

- [x] P1. **Input VAT on lost goods (D14).** A theft or unexplained-loss write-off reverses the
  input VAT in its own entry: Dr 520100 / Cr the deductible input VAT account, tagged with the tax
  code of the item's latest purchase bill (B18 when it was never bought on a bill). The VAT return
  reads tax-coded journal lines, so the month's deductible VAT drops by that amount. Non-deductible
  VAT (113900) is never reversed. A locked VAT period refuses the post. *Open:* the ATK purchase
  book's adjustment box 61 is not emitted yet (the book is built from bills only).
- [x] P2. **Year-end count check.** `inventory/year-end-check?year=` lists every warehouse that
  held stock in the year with its last posted count, the ones with none, and stock vs ledger on
  31 December. Shown on the Year end page.
- [x] P3. **Write-downs to net realisable value (IAS 2).** A `WriteDown` stock document: each line
  gives NRV per unit; the item's allowance becomes quantity × (average cost − NRV), floored at
  zero, and the change is posted Dr 520300 / Cr 120900 (or reversed). No stock moves; average cost
  unchanged. Write-downs post in date order per item. The valuation shows the allowance and the
  net value.
- [x] P4. **Sales price lists and "Nivelim".** A price list per company, optionally per warehouse
  (shop), VAT-inclusive, with dated prices per item. A price-change document (Nivelim) lists old
  price, new price and the quantity on hand in that warehouse, prints as the shelf record, and on
  posting makes the new prices current from its date. No ledger entry (stock is carried at cost).
  Invoices take the item's price from the warehouse's price list when there is one.
  *Built:* `price-lists`, `price-changes` (draft → post, NIV- numbers, printable record) and
  `prices/resolve` (shop list → company list → item price), used by the invoice line picker.
- [x] P5. **Purchase orders.** Vendor, dates, lines (item, quantity, expected price); draft →
  confirmed → partly received/billed → closed, or cancelled. A bill can be created from a PO and
  its lines keep the link, so ordered vs billed quantity is tracked (soft match: a difference
  warns, never blocks). The low-stock list creates one draft PO per usual supplier.
  *Built:* `purchase-orders` (PO- numbers on confirm; close, cancel while unbilled), bill lines
  carry `PurchaseOrderLineId` (validated: confirmed order, same vendor), billed / in-draft /
  remaining per line read from the bills, "Create bill for the rest", and
  `purchase-orders/from-low-stock` at the last purchase price.
- [x] P6. **Receipt notes (GRNI, 120800).** Goods counted in before the bill arrives: Dr stock /
  Cr 120800 at the PO price (or an entered cost). The bill then debits 120800 for the matched
  quantity; a price difference adjusts the stock value while the goods are in stock and goes to
  cost of goods sold for what was already sold. 120800 must age to zero; a report lists open
  receipts. Delivery notes (goods out before the invoice) follow the same pattern on the sales side.
  *Built:* a `Receipt` stock document (FP- numbers, vendor, optional order line), posted Dr stock /
  Cr 120800. A vendor bill matches open receipts automatically by vendor and item (the ordered
  line first, then the oldest receipt), records each match (`receipt_matches`), clears 120800 at
  the receipt cost and revalues the stock by any price gap. Orders show received quantities
  (receipts plus goods a bill brought in directly) and create the draft receipt for the rest.
  `inventory/grni?asOf=` lists open receipts and ties them to 120800. *Not built:* delivery notes
  on the sales side.
- [x] P7. **Units of measure.** Each item keeps one base (stock) unit; purchase and sale units are
  named multiples of it (box = 24). Document lines carry the unit and quantity as entered; stock
  moves always in base units.
  *Built:* item `PurchaseUnit`/`SalesUnit` with factors; invoice and bill lines take `UnitName`
  (validated against the item) and store `UnitName`/`UnitFactor`, so changing an item's units
  never rewrites past documents. Stock, receipt matching, returns and the margin report use
  quantity × factor. Purchase-order and stock-document lines stay in base units.
- [x] P8. **Lots and expiry dates.** Optional per item. Receipts record the lot and expiry; issues
  take the earliest expiry first (FEFO) unless a lot is chosen; quantities per lot per warehouse;
  an expiry report feeds the write-off flow.
  *Built:* `Item.TrackLots` (fixed once stock moved); lots sit beside the cost engine — each stock
  move records its lot allocations (`stock_move_lots`) and `lot_balances` keep quantity per lot
  per location. Receipts (bills, receipt/opening documents, count overages) must name the lot;
  issues take the named lot or the earliest expiry first; transfers carry the lots; a sales
  return goes back to the lot it was sold from. `inventory/lots?expiringBefore=` is the expiry
  report. Average cost stays per item.
- [ ] P9. **FIFO.** *(Deferred: the POS analysis was prioritised; AVCO stays the only method.)* A second cost method, chosen before the first stock movement (D1 lock still
  applies). Cost layers per item; issues consume the oldest layers; back-dated documents replay the
  layers from that date, as AVCO does today.
