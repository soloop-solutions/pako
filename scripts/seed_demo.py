#!/usr/bin/env python3
"""Fill a demo company with ~22 months of realistic activity, through the API, for local demos.

Creates (all posted through the real endpoints, so the ledger, reports and dashboard agree):
  - a demo admin login and the company "Pako Demo Sh.p.k." (fictional names throughout)
  - 5 departments and 14 employees, hired over time, with monthly payroll runs posted and paid
  - 12 customers, 9 vendors, 12 items
  - sales invoices every month from January 2025 to today, with growth and seasonality; most are
    paid, recent ones are open and a few old ones are left overdue
  - vendor bills: stock purchases, rent, utilities, software, fuel, marketing, accounting
  - stock (docs/INVENTORY_PLAN.md): goods are stock-tracked in two categories; opening stock, monthly
    restocking per item, sales that take from stock (cost of goods sold posts itself), a year-end
    count with a shortage and an overage, a damaged-goods write-off and a transfer to a second
    warehouse
  - an opening capital entry

Then gives an existing account admin access, so it appears in that user's company list.

    python3 scripts/seed_demo.py --owner adonis@test.com
    PAKO_API=http://host:port python3 scripts/seed_demo.py --owner you@example.com

Run it once; it refuses to run again for the same demo admin (delete the company first).
Standard library only.
"""

import argparse
import calendar
import json
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
DEMO_EMAIL = "demo.admin@pako.test"
DEMO_PASSWORD = "Demo-Passw0rd!"
COMPANY_NAME = os.environ.get("PAKO_DEMO_COMPANY", "Pako Demo Sh.p.k.")
CLIENT_ADMIN = 2
SERVICE, GOODS = 1, 0

rng = random.Random(2026)
TODAY = date.today()
START = date(TODAY.year - 1, 1, 1)


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status


def call(method, path, token=None, body=None, headers=None):
    headers = {"Accept-Language": "en", "Content-Type": "application/json", **(headers or {})}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, f"{method} {path}: " + error.read().decode(errors="replace")) from None


def month_end(d):
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def months(start, end):
    d = start.replace(day=1)
    while d <= end:
        yield d
        d = (d + timedelta(days=32)).replace(day=1)


def log(message):
    print(message, flush=True)


DEPARTMENTS = [("SALES", "Shitjet"), ("ADM", "Administrata"), ("WH", "Magazina"), ("IT", "IT"), ("FIN", "Financat")]

# first, last, title, department, gross salary, hire date offset in months from START
EMPLOYEES = [
    ("Arben", "Krasniqi", "Drejtor i përgjithshëm", "ADM", 2400, 0),
    ("Vjosa", "Berisha", "Menaxhere e shitjeve", "SALES", 1500, 0),
    ("Driton", "Gashi", "Agjent shitjesh", "SALES", 950, 0),
    ("Blerta", "Hoxha", "Agjente shitjesh", "SALES", 950, 3),
    ("Fatos", "Morina", "Agjent shitjesh", "SALES", 900, 14),
    ("Liridona", "Shala", "Kontabiliste", "FIN", 1200, 0),
    ("Egzon", "Rexhepi", "Asistent financiar", "FIN", 800, 9),
    ("Mimoza", "Kelmendi", "Përgjegjëse e magazinës", "WH", 1000, 0),
    ("Besnik", "Ahmeti", "Magazinier", "WH", 700, 0),
    ("Kujtim", "Bytyqi", "Shofer", "WH", 650, 6),
    ("Ardit", "Hyseni", "Zhvillues softueri", "IT", 1700, 2),
    ("Elira", "Zeqiri", "Administratore sistemi", "IT", 1300, 16),
    ("Teuta", "Osmani", "Burime njerëzore", "ADM", 1100, 1),
    ("Genc", "Sylejmani", "Recepsionist", "ADM", 600, 18),
]

CUSTOMERS = [
    ("Dardania Market Sh.p.k.", 5), ("Prizren Trade L.L.C.", 4), ("Iliria Construction", 3), ("Kosova Pharm", 3),
    ("Rugova Hotels", 2), ("Peja Beverages", 2), ("Mitrovica Steel Works", 2), ("Gjakova Textiles", 1),
    ("Ferizaj Auto Center", 1), ("Albi Distribution", 2), ("Mercator Lux", 1), ("Bajgora Energy", 1),
]
VENDORS = ["Euro Import Sh.p.k.", "Balkan Supply Co", "Fibra Partners", "KEDS Energji", "IPKO Telecom",
           "Microsoft Ireland", "Petrol Lux", "Media Plus Agency", "Kontabilisti Plus"]

# name, unit, type, gross price (incl. 18% VAT)
ITEMS = [
    ("Laptop Dell Latitude 5440", "copë", GOODS, 1150), ("Monitor 27\" Samsung", "copë", GOODS, 260),
    ("Printer HP LaserJet", "copë", GOODS, 330), ("Router MikroTik", "copë", GOODS, 140),
    ("Kabllo rrjeti Cat6 (305 m)", "rrotull", GOODS, 95), ("UPS APC 1500VA", "copë", GOODS, 420),
    ("Licencë Microsoft 365 (vjetore)", "licencë", SERVICE, 145), ("Instalim rrjeti", "orë", SERVICE, 35),
    ("Mirëmbajtje mujore IT", "muaj", SERVICE, 450), ("Konsulencë teknike", "orë", SERVICE, 45),
    ("Server Dell PowerEdge", "copë", GOODS, 3900), ("Trajnim për stafin", "ditë", SERVICE, 380),
]

# Seasonality by month (Jan..Dec) and yearly growth: this year runs ~22% ahead of last.
SEASON = [0.75, 0.8, 0.95, 1.0, 1.05, 1.0, 0.85, 0.75, 1.1, 1.15, 1.2, 1.35]

# Stock documents (Pako.Domain.Inventory.StockDocumentType / WriteOffReason).
OPENING, TRANSFER, COUNT, WRITE_OFF = 0, 1, 2, 3
DAMAGED = 1
# Goods categories: item name prefix -> category. Everything else is "Pajisje kompjuterike".
NETWORK = ("Router", "Kabllo", "UPS")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--owner", help="email of an existing account to give admin access to the demo company")
    args = parser.parse_args()

    log(f"Seeding demo data against {API}")
    try:
        call("POST", "/api/auth/register", body={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    except ApiError as error:
        if error.status not in (400, 409):
            raise
    token = call("POST", "/api/auth/login", body={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})["token"]
    if any(c["name"] == COMPANY_NAME for c in call("GET", "/api/companies", token)):
        sys.exit(f"'{COMPANY_NAME}' already exists for {DEMO_EMAIL}; nothing to do.")

    company = call("POST", "/api/companies", token, {"name": COMPANY_NAME, "enabledProfiles": 17})
    c = f"/api/companies/{company['id']}"
    log(f"Company {COMPANY_NAME} ({company['id']})")

    accounts = call("GET", f"{c}/accounts", token)
    accounts = accounts["items"] if isinstance(accounts, dict) else accounts
    acc = {a["code"]: a["id"] for a in accounts}
    bank, cash = acc["101003"], acc["100100"]
    capital = next(a["id"] for a in accounts if a["code"].startswith("30") and a.get("isPostable", True)
                   and "capital" in a["name"].lower())
    service_revenue = next((a["id"] for a in accounts if a["code"].startswith("41") and a.get("isPostable", True)), acc["400100"])
    taxes = {t.get("code"): t["id"] for t in call("GET", f"{c}/taxes", token)}
    s18, b18 = taxes["S18"], taxes["B18"]  # sales / domestic purchase VAT 18%
    general = next(j for j in call("GET", f"{c}/journals", token) if j["code"] == "GEN")["id"]

    # ---- Opening capital ----
    # A manual journal entry needs the password confirmed again (an action token).
    action = call("POST", "/api/auth/action-tokens", token,
                  {"password": DEMO_PASSWORD, "action": "create-journal-entry", "companyId": company["id"]})["token"]
    entry = call("POST", f"{c}/journal-entries", token, {
        "journalId": general, "date": START.isoformat(), "reference": "Kapitali fillestar", "remarks": "Opening capital",
        "lines": [
            {"accountId": bank, "partnerId": None, "debit": 40000, "credit": 0, "description": "Kapitali fillestar"},
            {"accountId": capital, "partnerId": None, "debit": 0, "credit": 40000, "description": "Kapitali fillestar"},
        ]}, headers={"X-Action-Token": action})
    call("POST", f"{c}/journal-entries/{entry['id']}/post", token)

    # ---- Departments & employees ----
    depts = {}
    none = {k: 0 for k in ("sales", "purchases", "partners", "accounting", "reports", "hr")}
    for code, name in DEPARTMENTS:
        depts[code] = call("POST", f"{c}/departments", token, {
            "code": code, "name": name, "parentId": None, "managerEmployeeId": None, "costCenterId": None,
            "permissions": none, "partnerScope": 0, "isActive": True})["id"]
    employees = []
    for i, (first, last, title, dept, salary, offset) in enumerate(EMPLOYEES):
        hire = (START.replace(day=1) + timedelta(days=31 * offset)).replace(day=1)
        employees.append(call("POST", f"{c}/employees", token, {
            "firstName": first, "lastName": last, "personalNumber": f"12{i:08d}",
            "email": f"{first.lower()}.{last.lower()}@pakodemo.test", "hireDate": hire.isoformat(), "jobTitle": title,
            "departmentId": depts[dept], "monthlyGrossSalary": salary, "isPrimaryEmployer": True,
            "pensionExempt": False, "isActive": True}))
    log(f"{len(depts)} departments, {len(employees)} employees")

    # ---- Partners & items ----
    def partner(name, customer, i):
        return call("POST", f"{c}/partners", token, {
            "name": name, "taxNumber": None, "isCustomer": customer, "isVendor": not customer,
            "fiscalNumber": f"81{i:07d}", "paymentTermDays": 30})["id"]

    customers = [(partner(name, True, i), weight) for i, (name, weight) in enumerate(CUSTOMERS)]
    vendors = {name: partner(name, False, 100 + i) for i, name in enumerate(VENDORS)}
    category = {name: call("POST", f"{c}/inventory/categories", token, {
        "name": name, "inventoryAccountId": None, "cogsAccountId": None, "revenueAccountId": acc["400100"],
        "expenseAccountId": None})["id"] for name in ("Pajisje kompjuterike", "Pajisje rrjeti")}
    items = []
    for name, unit, kind, price in ITEMS:
        goods = kind == GOODS
        item = call("POST", f"{c}/items", token, {
            "name": name, "unit": unit, "type": kind, "defaultTaxDefinitionId": s18,
            "defaultRevenueAccountId": acc["400100"] if goods else service_revenue,
            "defaultExpenseAccountId": None if goods else acc["500100"], "defaultUnitPrice": price,
            "categoryId": (category["Pajisje rrjeti"] if name.startswith(NETWORK) else category["Pajisje kompjuterike"]) if goods else None,
            "trackInventory": goods, "minimumStock": (2 if price >= 1000 else 8) if goods else None})
        items.append((item["id"], name, kind, price))
    log(f"{len(customers)} customers, {len(vendors)} vendors, {len(items)} items")

    def pay(kind, doc_id, amount, on, account=bank):
        call("POST", f"{c}/{kind}/{doc_id}/record-payment", token,
             {"amount": round(amount, 2), "cashOrBankAccountId": account, "date": on.isoformat()})

    # ---- Stock ----
    goods = [(item_id, name, price) for item_id, name, kind, price in items if kind == GOODS]
    on_hand = {item_id: 0 for item_id, _, _ in goods}  # main warehouse, mirrored here to keep sales in stock
    main_wh = call("GET", f"{c}/inventory/warehouses", token)
    main_wh = main_wh[0]["id"] if main_wh else None

    def stock_document(body):
        nonlocal main_wh
        if main_wh is None:  # created with the first stock movement; the settings name it
            main_wh = call("GET", f"{c}/inventory/settings", token)["defaultWarehouseId"]
        document = call("POST", f"{c}/stock-documents", token, {"warehouseId": main_wh, **body})
        return call("POST", f"{c}/stock-documents/{document['id']}/post", token)

    def cost(price):  # stock is bought at ~60% of its net selling price
        return round(price / 1.18 * 0.6 * rng.uniform(0.95, 1.05), 2)

    def restock(m, growth):
        """Buy each goods item back up to a seasonal target on the 1st, split between two suppliers."""
        on = max(m, START)
        by_vendor = {"Euro Import Sh.p.k.": [], "Balkan Supply Co": []}
        for i, (item_id, name, price) in enumerate(goods):
            target = round((5 if price >= 1000 else 24) * SEASON[m.month - 1] * growth)
            qty = target - on_hand[item_id]
            if qty > 0:
                gross = round(cost(price) * 1.18, 2)
                by_vendor["Euro Import Sh.p.k." if i % 2 == 0 else "Balkan Supply Co"].append(
                    {"description": name, "quantity": qty, "unitPrice": gross, "taxDefinitionId": b18,
                     "expenseAccountId": None, "itemId": item_id})
                on_hand[item_id] += qty
        for vendor, lines in by_vendor.items():
            if not lines:
                continue
            b = call("POST", f"{c}/bills", token, {
                "partnerId": vendors[vendor], "vendorReference": f"{vendor[:3].upper()}-{on:%y%m}-{rng.randint(100, 999)}",
                "issueDate": on.isoformat(), "dueDate": (on + timedelta(days=30)).isoformat(), "lines": lines})
            call("POST", f"{c}/bills/{b['id']}/post", token)
            paid_on = on + timedelta(days=rng.randint(10, 50))
            if paid_on <= TODAY:
                pay("bills", b["id"], sum(line["quantity"] * line["unitPrice"] for line in lines), paid_on)
        return sum(1 for lines in by_vendor.values() if lines)

    # Opening stock on the first day: what the company held before it started using PAKO.
    stock_document({"type": OPENING, "date": START.isoformat(), "notes": "Gjendja fillestare e magazinës",
                    "lines": [{"itemId": item_id, "quantity": 3 if price >= 1000 else 12, "unitCost": cost(price)}
                              for item_id, _, price in goods]})
    for item_id, _, price in goods:
        on_hand[item_id] += 3 if price >= 1000 else 12
    stock_bills = 0

    # ---- Sales: invoices each month ----
    invoice_count = 0
    weights = [w for _, w in customers]
    for m in months(START, TODAY):
        growth = 1.0 + 0.18 * ((m.year - START.year) * 12 + m.month - 1) / 12
        if m.month == 1 and m.year == TODAY.year:
            # The yearly stock count (31 December): one unit short on the first item, one over on the last.
            count_date = m - timedelta(days=1)
            sheet = call("GET", f"{c}/stock-documents/count-sheet?warehouseId={main_wh}&date={count_date.isoformat()}", token)
            counted = {row["itemId"]: row["bookQuantity"] for row in sheet}
            first, last = goods[0][0], goods[-1][0]
            if counted.get(first, 0) >= 1:
                counted[first] -= 1
            counted[last] = counted.get(last, 0) + 1
            stock_document({"type": COUNT, "date": count_date.isoformat(), "notes": "Inventarizimi vjetor",
                            "lines": [{"itemId": i, "quantity": q} for i, q in counted.items()]})
            for i, q in counted.items():
                on_hand[i] = q
        stock_bills += restock(m, growth)
        n = max(4, round(9 * SEASON[m.month - 1] * growth + rng.uniform(-1.5, 1.5)))
        last_day = min(month_end(m), TODAY)
        for _ in range(n):
            issued = m + timedelta(days=rng.randrange((last_day - m).days + 1))
            customer = rng.choices(customers, weights)[0][0]
            lines, total = [], 0.0
            for item_id, name, kind, price in rng.sample(items, rng.choice([1, 2, 2, 3])):
                if price >= 1000:
                    qty = rng.choice([1, 1, 2, 2, 3])
                else:
                    qty = rng.choice([2, 3, 5, 8, 10]) if kind == GOODS else rng.choice([4, 8, 12, 20])
                if kind == GOODS:  # never sell more than the warehouse holds
                    qty = min(qty, on_hand[item_id])
                    if qty <= 0:
                        continue
                    on_hand[item_id] -= qty
                lines.append({"description": name, "quantity": qty, "unitPrice": price, "taxDefinitionId": s18,
                              "revenueAccountId": None, "itemId": item_id})
                total += qty * price
            if not lines:
                continue
            invoice = call("POST", f"{c}/invoices", token, {
                "partnerId": customer, "issueDate": issued.isoformat(), "dueDate": (issued + timedelta(days=30)).isoformat(),
                "lines": lines})
            call("POST", f"{c}/invoices/{invoice['id']}/post", token)
            invoice_count += 1
            # Customers pay 5–60 days after issue, some in two instalments; ~3% never pay (overdue).
            paid_on = issued + timedelta(days=rng.randint(5, 60))
            if paid_on <= TODAY and rng.random() > 0.03:
                if rng.random() < 0.12:
                    pay("invoices", invoice["id"], round(total / 2, 2), paid_on)
                    rest_on = paid_on + timedelta(days=rng.randint(20, 45))
                    if rest_on <= TODAY:
                        pay("invoices", invoice["id"], round(total - round(total / 2, 2), 2), rest_on)
                else:
                    pay("invoices", invoice["id"], total, paid_on)
        log(f"  {m:%Y-%m}: {n} invoices")
        if m == START.replace(month=6):
            # A damaged monitor, destroyed after ATK was told 12 days earlier (AI 03/2015 Art. 61.2).
            monitor = next(i for i, name, _ in goods if name.startswith("Monitor"))
            if on_hand[monitor] >= 1:
                on = month_end(m)
                stock_document({"type": WRITE_OFF, "date": on.isoformat(), "reason": DAMAGED,
                                "atkNoticeDate": (on - timedelta(days=12)).isoformat(),
                                "notes": "Ekran i thyer gjatë transportit",
                                "lines": [{"itemId": monitor, "quantity": 1}]})
                on_hand[monitor] -= 1

    # A second warehouse in Prizren, stocked from the main one today.
    prizren = call("POST", f"{c}/inventory/warehouses", token, {"code": "PZ", "name": "Magazina Prizren",
                                                                  "address": "Rr. Remzi Ademaj, Prizren"})["id"]
    moves = [(i, min(on_hand[i], 2 if price >= 1000 else 6)) for i, _, price in goods]
    stock_document({"type": TRANSFER, "date": TODAY.isoformat(), "destinationWarehouseId": prizren,
                    "notes": "Furnizim i pikës në Prizren", "lines": [{"itemId": i, "quantity": q} for i, q in moves if q > 0]})
    log(f"stock: opening, {stock_bills} purchase bills, a count, a write-off and a transfer")

    # ---- Purchases: stock and running costs ----
    def bill(vendor, on, description, amount, account, paid_after=(3, 35)):
        b = call("POST", f"{c}/bills", token, {
            "partnerId": vendors[vendor], "vendorReference": f"{vendor[:3].upper()}-{on:%y%m}-{rng.randint(100, 999)}",
            "issueDate": on.isoformat(), "dueDate": (on + timedelta(days=30)).isoformat(),
            "lines": [{"description": description, "quantity": 1, "unitPrice": round(amount, 2), "taxDefinitionId": b18,
                       "expenseAccountId": account}]})
        call("POST", f"{c}/bills/{b['id']}/post", token)
        paid_on = on + timedelta(days=rng.randint(*paid_after))
        if paid_on <= TODAY:
            pay("bills", b["id"], round(amount, 2), paid_on)

    bill_count = 0
    for m in months(START, TODAY):
        growth = 1.0 + 0.18 * ((m.year - START.year) * 12 + m.month - 1) / 12
        day = lambda d: min(m.replace(day=d), TODAY)  # noqa: E731
        bill("Fibra Partners", day(1), "Qiraja e zyrës dhe magazinës", 1800, acc["610100"], (0, 5))
        bill("KEDS Energji", day(8), "Energjia elektrike", rng.uniform(180, 320) * (1.3 if m.month in (1, 2, 12) else 1), acc["610200"])
        bill("IPKO Telecom", day(5), "Internet dhe telefoni", 95, acc["660500"])
        bill("Microsoft Ireland", day(3), "Microsoft 365", 160, acc["624120"], (0, 2))
        bill("Petrol Lux", day(20), "Karburant", rng.uniform(250, 420), acc["640100"])
        bill("Kontabilisti Plus", day(10), "Shërbime kontabiliteti", 250, acc["660300"])
        bill_count += 6
        # Stock purchases are posted per item by restock() above, before each month's sales.
        if m.month in (3, 4, 9, 10, 11):
            bill("Media Plus Agency", day(15), "Fushatë marketingu", rng.uniform(600, 1400), acc["631100"])
            bill_count += 1
    log(f"{invoice_count} invoices, {bill_count + stock_bills} bills")

    # ---- Payroll: one run a month, approved, posted and paid ----
    runs = 0
    for m in months(START, TODAY):
        end = month_end(m)
        if end >= TODAY:
            break
        try:
            run = call("POST", f"{c}/payroll-runs", token, {"periodStart": m.isoformat(), "periodEnd": end.isoformat()})
            call("POST", f"{c}/payroll-runs/{run['id']}/approve", token)
            call("POST", f"{c}/payroll-runs/{run['id']}/post", token)
            call("POST", f"{c}/payroll-runs/{run['id']}/pay", token,
                 {"paidOn": (end + timedelta(days=5)).isoformat(), "cashOrBankAccountId": bank})
            runs += 1
        except ApiError as error:
            log(f"  payroll {m:%Y-%m} skipped: {error}")
    log(f"{runs} payroll runs")

    if args.owner:
        call("POST", f"{c}/members", token, {"email": args.owner, "role": CLIENT_ADMIN})
        log(f"{args.owner} is now an administrator of {COMPANY_NAME}")
    log(f"Done. Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  {error}")
        sys.exit(1)
