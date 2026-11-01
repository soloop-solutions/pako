# ERP verticals next to the POS — master plan

*Construction, real estate sales and property rental (POS_PLAN §15 P8). Phase 1 of each is built
(2026-11-01, branch `adonis/pos-foundation`); this plan records what it does, the decisions behind
it, and what the next phases add. Read the code before trusting this file.*

## Shared design

- **Ledger projects carry the vertical.** Each site and building creates a ledger `Project`
  (`Pako.Domain/Ledger/Project.cs`). Bills and invoices have a header `ProjectId`; posting tags
  their expense or revenue lines (and an invoice's cost of goods sold) with it. Site issues tag
  their cost of sales. Cost and revenue per site or building are therefore read from posted
  ledger lines, never kept as separate totals.
- **Draft invoices, posted by people.** Progress bills, installments and rent runs create *draft*
  invoices (`ProjectBilling.DraftAsync`) on an item the user chooses (its VAT code and revenue
  account). They are checked and posted on the invoice screen with every existing rule (numbering,
  credit limit, VAT eligibility, locks).
- **Access**: Sales (Edit to work, Approve to approve progress bills, release retention and cancel
  contracts); site issues post as stock documents (Inventory: Approve).

## 1. Construction

**Phase 1 (built).** `ConstructionSite` (client, contract value net, retention %, billing item,
state) with `CostCode` budgets and the bill of quantities (`BoqLine`: code, description, unit,
quantity, net unit price). Progress bills (*situacione*) record cumulative quantities per BoQ line;
approval fixes this period's quantity and amount (cumulative − last certified, never backwards) and
the retention held; invoicing makes a draft invoice for the period's amount, VAT-inclusive on the
billing item. Materials go to the site on `SiteIssue` stock documents (FDK-…; Dr cost of sales
tagged with the project / Cr stock) with a cost code per line. Bill lines take a cost code.
Percentage of completion is cost-to-cost: actual cost (ledger classes 5–6 tagged with the project)
÷ budget (sum of cost codes), earned revenue = that share of the contract value, against billed
(approved progress bills) → over/under billing; retention held and released as a memo.

**Decisions taken.** Retention is not split on the invoice (the client withholds it on payment;
PAKO tracks what is held). Revenue in the ledger follows invoices; the PoC figures are a report,
not journal entries.

**Next phases.**
1. Subcontracts (vendor, value, retention, progress certificates against them) and equipment usage
   (hours × internal rate to the site).
2. Variation orders on the BoQ (approved changes with their own lines and value).
3. Optional PoC journal (contract asset/liability for over/under billing, IFRS 15 over time).
4. Site store as its own warehouse; transfers to sites instead of issues for materials not used yet.
5. Payroll hours by site (timesheets → labour cost on the project).
6. [VERIFY] Kosovo VAT reverse charge on construction services between registered persons.

## 2. Real estate sales

**Phase 1 (built).** `Building` (project, sale item) with `PropertyUnit`s (kind, floor, area, list
price, state Available/Reserved/Sold/Compensation/Rented). Reservations with expiry and deposit
(lapse automatically); a reserved unit sells only to its holder. Sale contracts (KSH-…) with an
installment plan — explicit, or down payment plus equal monthly installments (the last takes the
rounding); compensation contracts for the landowner's units. Installments are invoiced on demand
(several on one draft invoice), and the contract reads invoiced, paid (reconciliations), outstanding
and overdue back from the invoices.

**Next phases.**
1. Reservation deposits as down-payment invoices, deducted on the final invoice.
2. Compensation accounting: the matching purchase of the land (bill) and the barter clearing.
3. Price lists per building and floor, discounts with approval, sales pipeline (leads → offers).
4. Handover: notary contract date, keys, defects list; title transfer tracking.
5. Printable contract and payment plan from templates; reminders before each due date.
6. [VERIFY] VAT on the first supply of new residential buildings and on advance payments.

## 3. Property rental

**Phase 1 (built).** `Lease` (QR-…) of a unit or free-text property: tenant, rent (VAT-inclusive
per month) on a rent item, due day, deposit with received/returned dates, utility meters re-billed
at their item's price. The rent run makes one draft invoice per running lease and month (part
months by the day; ended leases for their last month; a month is never invoiced twice —
`LeaseInvoice` is unique per lease and month). Activating a lease marks the unit Rented; ending it
frees it. The lease shows its last invoiced month and arrears (open amounts of its invoices).

**Next phases.**
1. Security deposits on a liability account (received, applied to damages, returned).
2. Indexation (yearly % or CPI) and rent reviews; service charges split by area across tenants.
3. Automatic monthly run (job) with e-mailed invoices — this is also the recurring-invoice feature
   the accounting side lacks.
4. Tenant statements and late fees; maintenance requests.
5. [VERIFY] VAT on residential vs commercial lettings in Kosovo.
