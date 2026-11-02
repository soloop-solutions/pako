# PAKO — testing guide

This guide covers the main features of PAKO for each one:
- what it is;
- where it lives (web route);
- what it needs (business type / pack, module, role, data);
- how to test it, with the expected results.

It is written for the demo data set that ships in `backend/seed/pako_demo.sql.gz`.

- Logins, roles and permission tables: **`docs/DEMO_ACCOUNTS.md`**.
- Company types and packs: **`docs/COMPANY_TYPES.md`**.

---

## 1. Getting started

### What you need

| Tool | Version | Check |
| --- | --- | --- |
| Docker Desktop | any recent | `docker ps` |
| .NET SDK | 10 | `dotnet --version` |
| Node.js + pnpm | Node 20+, pnpm 10 | `pnpm --version` |
| Python 3 | 3.9+ (only to rebuild the demo data) | `python3 --version` |

### Start it

```bash
git pull origin main
pnpm install

# 1. Database (Postgres on :5433)
docker compose -f backend/docker-compose.yml up -d

# 2. API on http://127.0.0.1:5248. On start it brings the local database onto the demo data:
#    when backend/seed/pako_demo.version is newer than what pako_dev holds, the old database is
#    kept as pako_dev_backup_<time> and pako_dev is reloaded. Then it applies newer migrations.
dotnet run --project backend/Pako.Api/Pako.Api.csproj --launch-profile http

# 3. Web app on http://127.0.0.1:5180
pnpm --filter web dev -- --host 127.0.0.1 --port 5180
```

Your own local data is not lost: it stays in `pako_dev_backup_<time>` (the three newest backups are
kept). To keep working on your own data instead, start the API with `Demo__AutoLoad=false`. To
reload the demo data by hand at any time: `scripts/demo/load_demo_db.sh`.

Open **http://127.0.0.1:5180**. Use exactly that address: the API only accepts the web app's own origin.

### Logins

- **Every demo user:** password **`Demo-Passw0rd!`**.
- **Platform administrator:** `test@test.com` / `Test123!`.

| Use this login | To test |
| --- | --- |
| `demo.admin@pako.test` | Everything at once ("Pako Demo Sh.p.k.", type General, all packs, 22 months of history) |
| `market.owner@pako.test` | Supermarket (Market) |
| `restaurant.owner@pako.test` | Restaurant |
| `hotel.owner@pako.test` | Hotel and events |
| `salon.owner@pako.test` | Services (salon) |
| `pharmacy.owner@pako.test` | Pharmacy |
| `fuel.owner@pako.test` | Fuel station |
| `wholesale.owner@pako.test` | Wholesale and van sales |
| `construction.owner@pako.test` | Construction (managed by an accounting firm) |
| `realestate.owner@pako.test` | Real estate sales and rentals (managed by an accounting firm) |
| `autoparts.owner@pako.test` | Auto parts |
| `firm.admin@pako.test`, `firm.accountant@pako.test` | Accounting firm with two clients |
| `investor@pako.test` | One user, three companies, read-only |
| `test@test.com` | Platform administration |

All tills run in **training mode**. Coupons print "TRAINING" and nothing is sent to ATK, so you can sell, return and cancel freely.

---

## 2. How access works (read this first)

Three layers decide what a user sees. Test them together.

1. **Business type → packs.** Each company has a type (Market, Hotel, …) that switches on its vertical packs. A pack that is off is hidden in the sidebar and its pages, and the API answers **403**. See `docs/COMPANY_TYPES.md`.
2. **Modules.** Sales, Purchases, Accounting, Reports, HR, Payroll, Inventory and POS are licensed per company by the platform administrator. Construction has no POS; Real estate has no POS or Inventory.
3. **The user's access in that company.**

   | Access | What it gives |
   | --- | --- |
   | Administrator / owner | everything, including users and settings |
   | Read-only member (viewer) | sees everything, changes nothing |
   | Firm administrator / accountant | full access to every client company of the firm (the accountant can't manage users) |
   | Staff with a role | per area, one of: — / **View** / **Edit** (create and change drafts) / **Approve** (also post, approve, pay, cancel, refund, close a till) |

The role tables are in `docs/DEMO_ACCOUNTS.md`.

---

## 3. Common features (every company)

### 3.1 Company lobby, creating a company, business type

- **Where:** after login, `/select-company`; inside a company, `/settings` → Business type.
- **Needs:** any account.
  - Creating a company needs your own account (company limits apply).
  - Changing the type needs the company's administrator.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Log in as `investor@pako.test` | The lobby lists 3 companies (Market, Restaurant, Hotel). Each opens read-only. |
| 2 | Create a company, pick type **Hotel** | The new company's sidebar has Hotel and Events pages, but no Pharmacy, Forecourt or Construction. |
| 3 | In that company, open Settings → Business type and change it to **Pharmacy** | A confirmation lists the new packs. After saving, the sidebar shows Pharmacy and Hotel is gone. |
| 4 | As `market.owner`, type `/pos/hotel` in the address bar | The page says "This feature isn't used by this company". |

### 3.2 Users, roles and permissions

- **Where:** `/admin/users`, the users and roles tabs.
- **Needs:** the company administrator, or a role with Users: Approve.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | As `market.owner`, open `/admin/users` | 8 users (including the investor), each with their access (administrator, role, viewer) and linked employee. |
| 2 | Open the role "Menaxher dyqani" | Shows its levels per area (POS Approve, Inventory Approve, …). |
| 3 | Invite a new user with the role "Arkëtar" | You get an invitation link (shown even without e-mail set up). Opening it and setting a password signs the user in. |
| 4 | Log in as `market.cashier` | Only POS and reference data are visible. Accounting, Payroll and Settings are not. |
| 5 | As `market.viewer`, open an invoice | It's readable, and every action button is hidden or refused. |
| 6 | As `market.employee` | Only "My HR" is visible: payslips, leave, expenses. |
| 7 | Deactivate a user, then try to log in as them | They're refused on their very next request. |

### 3.3 Partners (customers and vendors)

- **Where:** `/customers`, `/vendors`, `/partners`, `/partner-statement`.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Create a customer with a fiscal number and payment terms | It appears in the list and can be picked on invoices. |
| 2 | Open a customer's statement for a period | Opening balance, invoices, payments, closing balance. |
| 3 | `wholesale.owner`: open "Market Viva Ferizaj" | Shows the credit limit 6,000, the overdue block (45 days) and the customer price list "Shumicë A". |

### 3.4 Items

- **Where:** `/items`, `/item-categories`.
- **Needs:** an item needs **revenue, expense and stock accounts**; saving is disabled without them.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Create an item without accounts | The Save button stays disabled. |
| 2 | `market.owner`: open "Banane" | PLU 4011, sold by weight. |
| 3 | `market.owner`: open "Birrë Peja" | Minimum age 18 and a deposit item (the bottle). |
| 4 | `pharmacy.owner`: open "Amoksicilinë" | Pharmacy section: ATC code, prescription-only, maximum retail price 7.50. |
| 5 | `autoparts.owner`: open "Filtër vaji Bosch", tab "References & fitment" | Bosch, VW and Mann numbers; VW Golf / Škoda Octavia 2008–2013. |
| 6 | `market.owner`: open any item | No Pharmacy section and no References tab (those packs are off). |

### 3.5 Sales: invoices, credit notes, returns, proformas

- **Where:**
  - `/invoicing`, `/invoicing/:id`;
  - `/sales-returns`, `/proforma`;
  - `/reconciliation` for payments.
- **Needs:** Sales Edit to draft; **Sales Approve to post**. Posting numbers the invoice and writes the journal entry; posted invoices can't be edited.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Draft an invoice with 2 lines and post it | It gets a number. The journal has receivable, revenue and VAT lines (Ledger). For stock items, stock goes down and cost of goods sold is posted. |
| 2 | Record a payment | The open amount goes to 0 and the invoice shows as paid. |
| 3 | Create a sales return of 1 unit from a posted invoice | Stock comes back at the original cost, and the receivable is reduced. |
| 4 | Try to return more than was sold | Refused, with the amount still returnable. |
| 5 | Invoice a customer above their credit limit | Refused with the available credit, e.g. `wholesale.owner` → "Kioska Shkolla" (limit 800). |
| 6 | As `market.cashier`, try to open `/invoicing` | Not visible or refused (no Sales access). |

### 3.6 Purchases: bills, purchase orders, receipts

- **Where:** `/bills`, `/purchase-orders`, `/purchase-returns`, `/stock-documents` (Receipt type).
- **Needs:** Purchases Edit / Approve; Inventory Approve to post stock documents.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Create and post a bill for stock items | Stock goes up at the net cost; input VAT is posted. |
| 2 | `demo.admin`: open purchase order "EI-PO-5512" | Confirmed and received: the goods came in on a receipt. |
| 3 | Create a PO → Confirm → "Receive" → post the receipt → create the bill from the PO | The bill matches the receipt and doesn't bring the goods in twice. The order shows billed and received quantities. |

### 3.7 Stock

- **Where:**
  - `/stock` (levels), `/stock-documents`, `/stock-reports`;
  - `/warehouses`, `/price-lists`.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Post a Transfer between two warehouses | Quantities move; no journal entry. |
| 2 | Post a Count with a shortage | Shortage moves and a journal entry to the shortage account. |
| 3 | `demo.admin`: stock of "Kos Vita" | Two lots, one expiring in 2 days. A sale takes the earliest expiry first. |
| 4 | Sell more than is in stock (the negative-stock rule is Block) | Refused, with the quantity available. |
| 5 | Post a price change (Nivelim) on a list | Records the old price, quantity and difference; no journal entry. |
| 6 | `wholesale.owner`: price list "Shumicë A", items tab | Volume tiers (a lower price from 100 pieces). |

### 3.8 Accounting and reports

- **Where:**
  - `/ledger`, `/chart-of-accounts`, `/cost-centers`;
  - `/reports` (P&L, balance sheet, VAT declaration, ATK books, aging, cash flow, …);
  - `/year-end`, `/withholding-tax`.
- **Needs:** Accounting / Reports access. A manual journal entry asks for the user's password again.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `demo.admin`: Reports → P&L for this year | Revenue, cost of goods sold, expenses. Row links open the source document. |
| 2 | Reports → VAT declaration for last month | ATK boxes, and an Excel export. |
| 3 | Reports → checks | The 7 reconciliation checks; stock value equals the stock accounts. |
| 4 | Create a manual journal entry | Asks for the password. Posting needs debits = credits. |
| 5 | `market.accountant` (Accountant role) | Can post invoices and journal entries, but can't manage users. |

### 3.9 HR, leave, timesheets, payroll, My HR

- **Where:**
  - `/employees`, `/departments`;
  - `/leave`, `/timesheets`, `/employee-loans`, `/commission-plans`;
  - `/payroll`, `/expense-claims`;
  - employee self-service: `/my/payslips`, `/my/leave`, `/my/expenses`, `/my/profile`.
- **Needs:** HR / Payroll roles. "My HR" needs a login linked to an employee.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `demo.admin`: `/leave` | Leave types, allocations (20 days each), 6 requests (4 approved, 2 pending). |
| 2 | Approve a pending request | The balance goes down by the working days (public holidays are skipped). |
| 3 | `/employee-loans` | An advance of €300 and a loan of €1,200, recovered from December's payroll. |
| 4 | Create, approve, post and pay next month's payroll | Payslips; the loan installment and the adjustments (bonus, overtime) appear. Journal and payment entries are posted. |
| 5 | Log in as `market.employee` | Only My HR. Own payslips; can request leave. |
| 6 | `hotel.hr` (HR officer) | Employees and leave yes; **no payroll or salary figures**. |
| 7 | `construction.payroll` (Payroll officer) | HR and payroll including posting and paying runs. |

---

## 4. Point of sale (POS) — common to every shop

- **Where:**
  - `/pos` (stores and tills), `/pos/setup` (stores, registers, barcode rules);
  - `/pos/till/:registerId` (the till);
  - `/pos/programs` (promotions, coupons, loyalty), `/pos/cards` (gift cards, loyalty cards);
  - `/pos/customer-orders` (layaway / special orders), `/pos/reports`.
- **Needs:** POS module.
  - **POS Edit** (cashier) to sell.
  - **POS Approve** (manager) for returns, cancellations, discounts and closing a session.
- **Notes:**
  - Tills are in training mode.
  - Cash from an individual above €2,000 is refused.
  - Totals always come from the server.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `market.cashier` → `/pos` → till **DR-K2** (session open) | The till opens with the catalogue. Scan or type a barcode (e.g. `3830001020022`) to add milk. |
| 2 | Add "Banane" and enter 1.234 kg | The line shows the weight × price per kg. |
| 3 | Add "Birrë Peja" | Asks to confirm the age (18+) and adds the bottle deposit line automatically. |
| 4 | Pay cash with €20 for a smaller total | Change is calculated and the coupon prints (80 mm), marked TRAINING. |
| 5 | As the cashier, try to return an item | Refused (needs POS Approve). Log in as `market.manager`: allowed. |
| 6 | Manager closes the session: count the cash | A difference needs a reason. The session is posted as one journal entry (revenue, VAT, cash, card, cost of goods sold). |
| 7 | `demo.admin`: sell with coupon code `MIRESEVINI` (basket ≥ €20) and loyalty card `LOY-0001` | €2 off; points earned on the card. |
| 8 | Sell a gift card, then pay with it | Its balance goes down; the liability is on account 240300. |
| 9 | `/pos/reports` | Sales by item, category, day or tender, with margin; shelf labels as PDF. |
| 10 | `market.owner`: till **DR-SC** (self-checkout) | Card only, no returns. An age-restricted item asks for an attendant PIN. |

---

## 5. Vertical packs — one per business type

Each section says which login to use. That company's type already has the pack on.

### 5.1 Market — groceries (`market.owner`)

- **Needs:** pack **grocery**; POS.
- **Data:**
  - "Supermarket Dardania — Qendra" with tills DR-K1, DR-K2 and DR-SC;
  - goods with PLUs, deposits and lots;
  - a weekend −10% on fruit, the loyalty card `DRD-0001`.
- **Test:**
  - the sales in §4;
  - the fruit promotion on Saturday or Sunday;
  - a lot that expires soon;
  - the online channel (§5.10).

### 5.2 Restaurant (`restaurant.owner`, `restaurant.waiter`, `restaurant.manager`)

- **Where:**
  - `/pos/floors` (floors and tables), `/pos/menu-setup` (production centres, modifiers, combos);
  - the till with profile Restaurant (**TU-K1**);
  - `/pos/kds` (kitchen screen), `/pos/usage-variance`;
  - `/pos/events` for the party hall.
- **Needs:** pack **hospitality** (events for the hall); POS. The waiter has POS Edit; voids and closing need the manager.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | As `restaurant.waiter`, open TU-K1 | The floor plan: Salla and Tarraca with 14 tables. 2 tables already have open tabs. |
| 2 | Open table S6, add Qebapa with "Ajvar" and 2 Coca-Cola, then Send | Tickets go to the grill and the bar. `/pos/kds` shows them live. |
| 3 | Void a sent line as the waiter | Needs the manager's PIN (`restaurant.manager`). |
| 4 | Pre-bill, then split the bill in two and pay each part | Each part is a coupon; the tab closes when everything is paid. |
| 5 | Move a tab to another table, or merge two tabs | Lines move with their state. |
| 6 | `/pos/events` | "Familja Bytyqi — synet" in 21 days. Set the final headcount to see the bill. |

### 5.3 Hotel and events (`hotel.owner`, `hotel.reception`, `hotel.manager`)

- **Where:**
  - `/pos/hotel` (reservation chart), `/pos/hotel/setup` (room types, rooms), `/pos/hotel/guests` (guest register);
  - `/pos/events` (venues), `/pos/tickets` (ticketed events), `/pos/scan` (door scanner);
  - till **PP-REC**.
- **Needs:** packs **hotel**, **hospitality**, **events**.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `/pos/hotel` | 12 rooms over the next weeks. Hans Müller and Sara Rossi are checked in today; 3 more bookings follow. |
| 2 | Open a checked-in booking | Folio: tonight's room and tourist tax per adult. |
| 3 | Check in the next arriving guest without guest details | Refused until a guest with a name and document is registered. |
| 4 | Charge a restaurant tab to a room | The amount appears on the guest's folio. |
| 5 | Check-out: pay at the till, or "Bill company" for a city-ledger invoice | The folio closes; the room becomes dirty. |
| 6 | `/pos/hotel/guests` with "foreign only" | The police register: non-Kosovo guests with document numbers. |
| 7 | `/pos/tickets` → "Mbrëmje jazz", then scan a sold ticket's QR at `/pos/scan` twice | First VALID, then ALREADY USED with the time. |

### 5.4 Services: salon, clinic, gym, repairs (`salon.owner`, `salon.reception`)

- **Where:**
  - `/pos/appointments` (calendar), `/pos/resources` (staff, rooms, hours);
  - `/pos/memberships` (packages and memberships), `/pos/repairs`;
  - the public booking page `/book/:token` (the link is on the store in `/pos/setup`).
- **Needs:** pack **services**.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `/pos/appointments` for tomorrow | 4 appointments with Teuta. Free slots respect hours and the 10-minute buffer. |
| 2 | Book an overlapping time | Refused. |
| 3 | "Check out at till" on an appointment | The till opens with the service. After payment the appointment is completed and credited to the stylist (commission). |
| 4 | Sell "Paketë 10 masazhe", then use one session at the till | Remaining 9; the session line is paid by the package. |
| 5 | Open the online booking link in a private window | Choose service, day, time; the booking appears in the calendar as Online. |
| 6 | `/pos/repairs` | Repair of "Tharëse Philips" received. Move it through the states and print the intake receipt. |

### 5.5 Pharmacy (`pharmacy.owner`, `pharmacy.pharmacist`, `pharmacy.cashier`)

- **Where:** `/pos/pharmacy` (prescriptions, payers, controlled register) and till **BS-K1** (Prescription and Substitutes buttons).
- **Needs:** pack **pharmacy**. The controlled register needs POS Approve (the pharmacist).

| # | Steps | Expected |
| --- | --- | --- |
| 1 | At the till, add "Amoksicilinë" without a prescription | Refused: prescription-only. |
| 2 | Prescription → RX-2026-1002 (Tramadol) | Lines added with the remaining quantity. The quote shows "FSSH pays 80%" as an on-account tender; the rest is cash. |
| 3 | Dispense more than prescribed | Refused, with the quantity left. |
| 4 | Change a medicine's price above its maximum (e.g. Paracetamol > €3.00) | Refused at the till and in price changes. |
| 5 | Substitutes on a Paracetamol line | Panadol (same ingredient) with price and stock. |
| 6 | As `pharmacy.pharmacist`, open the controlled register for Tramadol | Every receipt and sale with prescription, patient and doctor; running balance; printable. |
| 7 | Scan a GS1 DataMatrix code (GTIN + lot + expiry) | Lot and serial land on the line; an expired pack is flagged. |

### 5.6 Fuel station (`fuel.owner`, `fuel.attendant`)

- **Where:** `/pos/forecourt`, with tabs:
  - shift readings, dips, reconciliation;
  - tanks & nozzles, fleet cards.

  The till **RG-K1** has pump/nozzle buttons and a fleet card button.
- **Needs:** pack **forecourt**.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Till: pump 1 nozzle 1, 40 litres, cash | A diesel line in litres, tied to the nozzle. |
| 2 | Fleet card **FC-2001**, 120 L of diesel | The company "Trans Kosova" is charged on account (limit €300 per fill). |
| 3 | Fleet card + a coffee | Refused: the card is fuel only. |
| 4 | Reconciliation for today | Litres pumped vs sold per nozzle (pump 1/1 is 0.4 L over); book stock vs dips per grade. |
| 5 | Enter the next shift's readings with an opening that isn't the last closing | Refused: a meter only counts up. |

### 5.7 Wholesale and van sales (`wholesale.owner`, `wholesale.salesrep`, `wholesale.warehouse`)

- **Where:**
  - `/sales-orders` (quotes and orders);
  - `/stock-documents` (Delivery notes, type "Fletëdërgesë");
  - `/distribution/my-day`, `/distribution/routes`, `/distribution/visits`;
  - `/distribution/van-load`, `/distribution/van-settlement`;
  - `/price-lists` (customer lists, tiers).
- **Needs:** pack **distribution** for the van pages. Sales orders are in every company.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | New sales order for "Market Viva Ferizaj" with 120 × Vegeta | The price comes from the customer list. From 100 pieces the tier price applies. |
| 2 | Quote → Confirm | Numbered OF-… then SO-…. |
| 3 | Confirm an order that takes "Kioska Shkolla" over its €800 limit | Refused. An approver (owner) can override with a reason, which is kept on the order. |
| 4 | Order → Deliver → post the delivery note → Invoice delivered | Stock leaves on the delivery. The invoice has no second stock move; invoicing more than delivered is refused. |
| 5 | As `wholesale.salesrep`, open `/distribution/my-day` | The route "Ferizaj — Qendra" with 4 shops and their balances and blocks. Check in (GPS), record "Order" and the cash collected. |
| 6 | `/distribution/visits` | Visits, strike rate, drop size, collected, and a map link. |
| 7 | `/distribution/van-load` for VAN1 → Create transfer | A transfer main → van with what confirmed orders need. |
| 8 | `/distribution/van-settlement` for VAN1 today | Per item: opening, loaded, sold, returned, unloaded, closing; invoices and cash collected. |

### 5.8 Construction (`construction.owner`, `construction.sitemanager`, `firm.accountant`)

- **Where:**
  - `/construction` (sites); `/construction/:id` with the tabs Overview, Progress bills, Costs & completion, Materials;
  - on bills: a **Project** field and a **cost code** per line.
- **Needs:** pack **construction** (no POS in this company). Approving progress bills and releasing retention need Sales Approve.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Open "Shkolla fillore Mitrovicë" | Cost code budgets and the BoQ with certified quantities. |
| 2 | Progress bills → new bill: raise 2.1 to more of its quantity → Approve → Create invoice | The amount for the period only (cumulative − previous) and 5% retention. A draft invoice tagged with the project is created. |
| 3 | Enter a cumulative quantity below the last certified | Refused. |
| 4 | Materials → issue 50 bags of cement to cost code 01 | The stock leaves; the cost lands on the site. |
| 5 | Costs & completion | Actual vs budget per cost code; % complete; earned vs billed (over/under billing); retention held. |
| 6 | Log in as `firm.accountant` | Sees Ndërtimi Ilir and Arbëria Residence (the firm's clients) with full bookkeeping access. |

### 5.9 Real estate and rentals (`realestate.owner`, `realestate.agent`)

- **Where:**
  - `/real-estate/buildings` (unit board), `/real-estate/reservations`, `/real-estate/contracts`;
  - `/rentals/leases`, `/rentals/rent-run`.
- **Needs:** packs **realEstate** and **rentals** (no POS or Inventory in this company).

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Open "Kulla A" | Units coloured by state: available, reserved (A-202), sold (A-101, A-303), compensation (A-403), rented (shops). |
| 2 | Sell A-202 to someone other than the holder of the reservation | Refused. Selling to the holder converts the reservation. |
| 3 | New contract: down payment + 12 installments | The plan adds up to the price exactly. |
| 4 | Contract page: select 2 installments → Create invoice | One invoice with 2 lines. The installments show open / overdue / paid as invoices are paid. |
| 5 | `/rentals/rent-run` for the current month | Says "already invoiced" for the three leases (never twice). Next month creates new drafts. |
| 6 | Lease → read the electricity meter, then run next month | The rent line plus the kWh used × price. A lease that starts mid-month is charged by the day. |

### 5.10 Online channels / webshop (Market, Pharmacy, Auto parts)

- **Where:** `/pos/online`, with tabs Orders, Cash on delivery, Channels. Webshops use the public API `/api/public/channel/{token}/...`.
- **Needs:** pack **onlineSales**.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | `autoparts.owner` → Orders | "AP-WEB-1001" for pickup. Accept → Ready → "Checkout at till": the order is fiscalised and completed. |
| 2 | Channels tab | The token and the public URLs. Rotating the token makes the old one stop working. |
| 3 | `demo.admin` → Cash on delivery | Orders the courier still owes, per courier. Select them → Remit with a reference. |

### 5.11 Auto parts (`autoparts.owner`, `autoparts.seller`)

- **Where:** `/pos/parts` (search) and the item tab "References & fitment".
- **Needs:** pack **autoParts**.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Search `03c115561h` (no spaces or dashes) | Finds the Bosch filter through the VW number. |
| 2 | Search by vehicle: Volkswagen / Golf / 2010 | The filter and the brake discs. |
| 3 | Search Golf 2015 | Not the filter (fitment ends in 2013). |

---

## 6. Platform administration (`test@test.com`)

- **Where:** `/platform`, with tabs for accounts, companies, account requests and the audit log.

| # | Steps | Expected |
| --- | --- | --- |
| 1 | Companies tab | Every company with its business type, packs, modules, users and activity. |
| 2 | Switch off the **hotel** pack for "Hotel Prishtina Plaza" | `hotel.owner` no longer sees the Hotel pages; the API answers 403. Switch it back on. |
| 3 | Switch off the **POS** module for a company | Its POS pages and API disappear for every user. |
| 4 | Audit log | Each change, with who, when, and before/after. |
| 5 | Set a company limit on an account and create one company too many | Refused. |

---

## 7. Permission test matrix

Log in as each user and check what's visible and what's refused. The company comes from the login.

| User | Should be able to | Should NOT be able to |
| --- | --- | --- |
| `market.cashier` | sell at DR-K1 / DR-K2, see items | return, cancel, close a session, open invoices, accounting, payroll, settings |
| `market.manager` | everything at the till, stock, prices, purchases (draft) | accounting, payroll, users |
| `market.stock` (Purchasing) | draft bills, items, stock documents (draft) | post stock documents (needs Approve), sales |
| `market.accountant` | post invoices, bills, journal entries, payroll | manage users |
| `market.viewer` | see everything | change anything |
| `market.employee` | My HR only | anything else |
| `restaurant.waiter` | open tabs, send to the kitchen, take payment | void sent lines, close the till |
| `hotel.reception` | bookings, check-in/out, guest bills | refunds, rates, closing the till |
| `hotel.hr` | employees, leave | payroll, salaries |
| `pharmacy.cashier` | sell, dispense against prescriptions | the controlled register, refunds |
| `wholesale.salesrep` | my day, visits, sales orders (draft) | post invoices, stock approvals |
| `wholesale.warehouse` | deliveries, receipts, transfers (post) | sales orders, accounting |
| `construction.sitemanager` | sites, materials, bills (draft) | approve progress bills, accounting |
| `realestate.agent` | reservations, contracts (draft) | posting invoices, rentals setup |
| `autoparts.accountant` (Reports only) | reports | everything else |
| `firm.accountant` | full bookkeeping in both firm clients | user management |
| `investor@pako.test` | read three companies | change anything |

---

## 8. Known limits (not bugs)

- **Fiscal (ATK):** every till is in training mode. Real SEF fiscalisation needs the company's ATK certificate and registered tills.
- **Not built:** the card-terminal and fuel-pump hardware links, and the offline phone app for van sales (the server side exists).
- **Online shipping fee:** shown on the order but not on the coupon (there's no shipping item).
- **Draft invoices:** progress bills, installments and rent runs create **drafts**. Post them in Invoicing to see the ledger effect.
- **Demo dates:** "today" in the data is the day the demo set was built (see the top of `docs/DEMO_ACCOUNTS.md`). Bookings and appointments are relative to that day.
- **VAT points to confirm with an accountant:** prepaid packages, agency commission, hotel fiscalisation at check-out, new-build residential sales, rentals.

## 9. Reporting a bug

Please include:

1. the login and the company;
2. the page URL;
3. the steps;
4. what you expected and what happened;
5. any error message, a screenshot, and the time.

API errors are shown in the page. The API console log has the details.
