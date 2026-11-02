#!/usr/bin/env python3
"""Fill the rest of the demo company with activity, through the API.

Run after scripts/seed_demo.py, seed_pos_demo.py and seed_verticals_demo.py. Adds:
  company   bank accounts, cost centers, Kosovo public holidays
  HR        leave types, allocations and requests, a salary advance and a loan, a commission
            plan, next month's payroll adjustments, this month's timesheets
  sales     a credit note, a sales return and a proforma
  purchase  purchase orders (one received on a goods receipt), lot-tracked goods with expiry
            dates, a T-shirt in sizes (variants), a phone sold by serial number
  tills     live sessions with sales in every shop: groceries with deposits, a coupon and a
            loyalty card, a gift card and a layaway; café tables with kitchen tickets, two paid and
            one open; a salon appointment checked out, a package and a membership sold, a repair
            taken in; a hotel guest checked in with nights posted and dinner charged to the room,
            concert tickets; a prescription dispensed with the health fund paying its share; fuel
            fills (one on a fleet card) and the shift's meter readings; a webshop order dispatched
            with cash on delivery

Each section is skipped when its marker exists; a failing section is reported and the rest run.

    python3 scripts/seed_activity_demo.py
"""

import base64
import json
import os
import sys
import traceback
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
DEMO_EMAIL = "demo.admin@pako.test"
DEMO_PASSWORD = "Demo-Passw0rd!"
COMPANY_NAME = os.environ.get("PAKO_DEMO_COMPANY", "Pako Demo Sh.p.k.")
TODAY = date.today()
NOW = datetime.now(timezone.utc)

GOODS, SERVICE = 0, 1
SALE = 0
CASH, CARD, GIFT, ON_ACCOUNT = 0, 2, 4, 5
CREDIT_NOTE, SALES_RETURN, PROFORMA = 1, 4, 5


class ApiError(Exception):
    pass


class X:
    token = ""
    c = ""
    acc = {}
    tax = {}
    user_id = ""


def call(method, path, body=None):
    headers = {"Accept-Language": "en", "Content-Type": "application/json", "Authorization": f"Bearer {X.token}"}
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
            if not payload:
                return None
            try:
                return json.loads(payload)
            except ValueError:
                return payload.decode()
    except urllib.error.HTTPError as error:
        raise ApiError(f"{method} {path}: HTTP {error.code} {error.read().decode(errors='replace')[:400]}") from None


def get(path):
    return call("GET", X.c + path)


def post(path, body=None):
    return call("POST", X.c + path, body if body is not None else {})


def put(path, body):
    return call("PUT", X.c + path, body)


def items_of(result):
    return result["items"] if isinstance(result, dict) and "items" in result else result


def log(message):
    print(message, flush=True)


def items_by_name():
    return {i["name"]: i for i in items_of(get("/items?pageSize=1000"))}


def item(name, price=None, *, unit="copë", kind=GOODS, vat="S18", tracked=False, barcode=None, **extra):
    existing = items_by_name().get(name)
    if existing:
        return existing
    created = post("/items", {"name": name, "unit": unit, "type": kind, "defaultTaxDefinitionId": X.tax[vat],
                              "defaultRevenueAccountId": X.acc["400100"], "defaultExpenseAccountId": X.acc["500100"],
                              "defaultInventoryAccountId": X.acc["120100"], "defaultUnitPrice": price,
                              "trackInventory": tracked and kind == GOODS, **extra})
    if barcode:
        post(f"/items/{created['id']}/barcodes", {"barcode": barcode})
    return created


def partners():
    return {p["name"]: p for p in items_of(get("/partners?pageSize=1000"))}


def vendor():
    return partners()["Euro Import Sh.p.k."]


def main_warehouse():
    return next(w for w in get("/inventory/warehouses") if w["isDefault"])["id"]


def bill(vendor_id, lines, warehouse_id=None, issue=None, **extra):
    issue = issue or TODAY - timedelta(days=5)
    created = post("/bills", {"partnerId": vendor_id, "vendorReference": f"DEMO-{uuid.uuid4().hex[:8].upper()}",
                              "issueDate": issue.isoformat(), "dueDate": (issue + timedelta(days=30)).isoformat(),
                              "warehouseId": warehouse_id, "lines": lines, **extra})
    post(f"/bills/{created['id']}/post")
    return created


# ---- Till helpers ----

class Till:
    def __init__(self, code):
        reg = next(r for r in get("/pos/registers") if r["code"] == code)
        self.r = f"/pos/registers/{reg['id']}"
        boot = get(f"{self.r}/bootstrap")
        self.session = boot["session"] or post(f"{self.r}/sessions", {"openingFloat": 100})
        self.tender = {}
        for t in boot["tenders"]:
            self.tender.setdefault(t["kind"], t["id"])
        self.store_id = reg["storeId"]
        self.catalog = {i["name"]: i for i in get(f"{self.r}/catalog")}

    def line(self, name, quantity=1, **extra):
        it = self.catalog[name]
        return {"itemId": it["id"], "description": it["name"], "quantity": quantity, "unitPrice": it["price"] or 0,
                "taxDefinitionId": it["taxDefinitionId"], **extra}

    def quote(self, lines, **extra):
        return post(f"{self.r}/quote", {"lines": lines, **extra})

    def sell(self, lines, payments=None, kind=CASH, **extra):
        quote_extra = {k: v for k, v in extra.items() if k in ("couponCodes", "loyaltyCardNumber", "tabId", "prescriptionId",
                                                               "fleetCardNumber", "channelOrderId")}
        total = self.quote(lines, **quote_extra)["total"]
        if payments is None:
            payments = [{"paymentMethodId": self.tender[kind], "amount": total}] if total else []
        return post("/pos/orders", {"clientUuid": str(uuid.uuid4()), "sessionId": self.session["id"], "kind": SALE,
                                    "orderedAt": datetime.now(timezone.utc).isoformat(), "lines": lines, "payments": payments, **extra}), total


# ---- Sections ----

def company_setup():
    company_id = X.c.rsplit("/", 1)[1]
    done = []
    try:
        if call("GET", f"/api/companies/{company_id}/bank-accounts"):
            raise ApiError("already there")
        post_bank = lambda body: call("POST", f"/api/companies/{company_id}/bank-accounts", body)
        post_bank({"bankName": "ProCredit Bank", "accountHolder": COMPANY_NAME, "iban": "XK051111000000000055", "swiftBic": "MBKOXKPR", "isDefault": True})
        post_bank({"bankName": "Raiffeisen Bank Kosovo", "accountHolder": COMPANY_NAME, "iban": "XK051501000000000077", "swiftBic": "RBKOXKPR"})
        done.append("2 bank accounts")
    except ApiError as e:
        done.append(f"bank accounts skipped ({str(e)[:80]})")
    existing = {c["code"] for c in items_of(get("/cost-centers"))}
    for code, name, en in [("ADM", "Administrata", "Administration"), ("SHI", "Shitja", "Sales"), ("LOG", "Logjistika", "Logistics")]:
        if code not in existing:
            post("/cost-centers", {"code": code, "name": name, "nameEn": en})
    done.append("3 cost centers")
    holidays = {h["date"] for h in get("/leave/holidays")}
    year = TODAY.year
    for d, name in [(f"{year}-01-01", "Viti i Ri"), (f"{year}-01-02", "Viti i Ri (dita e dytë)"), (f"{year}-01-07", "Krishtlindjet ortodokse"),
                    (f"{year}-02-17", "Dita e Pavarësisë"), (f"{year}-04-09", "Dita e Kushtetutës"), (f"{year}-05-01", "Dita e Punës"),
                    (f"{year}-05-09", "Dita e Evropës"), (f"{year}-12-25", "Krishtlindjet katolike")]:
        if d not in holidays:
            post("/leave/holidays", {"date": d, "name": name})
    done.append("Kosovo public holidays")
    return ", ".join(done)


def hr():
    types = {t["code"]: t for t in get("/leave/types")}
    if "PV" in types:
        return timesheets()
    annual = post("/leave/types", {"code": "PV", "name": "Pushim vjetor", "defaultAnnualDays": 20, "payPercent": 100,
                                   "carryOverMaxDays": 5, "carryOverExpiryMonth": 6})
    sick = post("/leave/types", {"code": "PM", "name": "Pushim mjekësor", "defaultAnnualDays": 20, "payPercent": 70})
    post("/leave/types", {"code": "PP", "name": "Pushim pa pagesë", "defaultAnnualDays": None, "payPercent": 0})
    employees = [e for e in items_of(get("/employees?pageSize=200")) if e.get("isActive", True)]
    for e in employees:
        post_put = put("/leave/allocations", {"employeeId": e["id"], "leaveTypeId": annual["id"], "year": TODAY.year, "days": 20})
        put("/leave/allocations", {"employeeId": e["id"], "leaveTypeId": sick["id"], "year": TODAY.year, "days": 20})
    requests = 0
    for i, e in enumerate(employees[:6]):
        start = TODAY + timedelta(days=10 + i * 7)
        while start.weekday() >= 5:
            start += timedelta(days=1)
        req = post("/leave/requests", {"employeeId": e["id"], "leaveTypeId": annual["id"] if i % 3 else sick["id"],
                                       "startDate": start.isoformat(), "endDate": (start + timedelta(days=2 + i % 3)).isoformat(),
                                       "reason": ["Pushim familjar", "Vizitë mjekësore", "Udhëtim", "Dasëm në familje", "Arsye personale", "Pushim veror"][i]})
        if i < 4:
            post(f"/leave/requests/{req['id']}/approve")
        requests += 1
    bank = X.acc.get("101003") or next(v for k, v in X.acc.items() if k.startswith("101"))
    first_period = (TODAY.replace(day=1) + timedelta(days=32)).replace(day=1)
    post("/employee-loans", {"employeeId": employees[0]["id"], "kind": 0, "principal": 300, "issuedOn": TODAY.isoformat(),
                             "installmentAmount": 150, "firstPeriod": first_period.isoformat(), "cashOrBankAccountId": bank,
                             "notes": "Paradhënie për shpenzime mjekësore"})
    post("/employee-loans", {"employeeId": employees[1]["id"], "kind": 1, "principal": 1200, "issuedOn": TODAY.isoformat(),
                             "installmentAmount": 100, "firstPeriod": first_period.isoformat(), "cashOrBankAccountId": bank,
                             "notes": "Kredi pa interes, 12 këste"})
    post("/commission-plans", {"name": "Komision shitjesh 3%", "basis": 0, "rate": 0.03, "minThreshold": 2000})
    for i, (kind, amount, hours, text) in enumerate([(0, 150, None, "Bonus për objektivat e tremujorit"), (3, None, 8, "Inventarizimi i fundvitit"),
                                                     (2, 40, None, "Shtesë transporti"), (5, None, 6, "Punë të shtunën — panair")]):
        post("/payroll-adjustments", {"employeeId": employees[i + 2]["id"], "period": first_period.isoformat(), "kind": kind,
                                      "description": text, "amount": amount, "hours": hours, "rateMultiplier": None})
    return (f"3 leave types, allocations for {len(employees)} employees, {requests} leave requests (4 approved), an advance and a loan, "
            f"3% commission plan, 4 adjustments for {first_period:%m/%Y}; " + timesheets())


def timesheets():
    """Last month's working days for four employees (this month has barely started)."""
    month_start = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)
    month_end = TODAY.replace(day=1) - timedelta(days=1)
    employees = [e for e in items_of(get("/employees?pageSize=200")) if e.get("isActive", True)][:4]
    if items_of(get(f"/time-entries?from={month_start.isoformat()}&to={month_end.isoformat()}")):
        return "timesheets already there"
    entries = 0
    for e in employees:
        d = month_start
        while d <= month_end:
            if d.weekday() < 5:
                post("/time-entries", {"employeeId": e["id"], "date": d.isoformat(), "hours": 8, "kind": 0, "note": None})
                entries += 1
                if d.weekday() == 3:
                    post("/time-entries", {"employeeId": e["id"], "date": d.isoformat(), "hours": 2, "kind": 1, "note": "Mbyllja e muajit"})
            d += timedelta(days=1)
    return f"{entries} timesheet entries for {month_start:%m/%Y}"


def sales_documents():
    invoices = items_of(get("/invoices?pageSize=500"))
    if any(i.get("documentType") in (CREDIT_NOTE, SALES_RETURN, PROFORMA) for i in invoices):
        return "already there"
    posted = [i for i in invoices if i.get("state") == "Posted" and i.get("documentType", 0) == 0]
    posted.sort(key=lambda i: i["issueDate"], reverse=True)
    full = lambda inv: call("GET", f"{X.c}/invoices/{inv['id']}")
    done = []

    def doc(original, doc_type, take):
        inv = full(original)
        lines = [{"description": l["description"], "quantity": take(l), "unitPrice": l["unitPrice"], "taxDefinitionId": l["taxDefinitionId"],
                  "revenueAccountId": l["revenueAccountId"], "discountPercent": l["discountPercent"], "itemId": l.get("itemId"), "unitName": l.get("unitName")}
                 for l in inv["lines"][:1]]
        return post("/invoices", {"partnerId": inv["partnerId"], "issueDate": TODAY.isoformat(), "dueDate": TODAY.isoformat(), "lines": lines,
                                  "documentType": doc_type, "originalInvoiceId": inv["id"], "internalNotes": "Demo"})

    service = next((i for i in posted if all(not l.get("itemId") for l in full(i)["lines"])), posted[0])
    note = doc(service, CREDIT_NOTE, lambda l: l["quantity"])
    post(f"/invoices/{note['id']}/post")
    done.append("credit note")
    goods = next((i for i in posted if any(l.get("itemId") for l in full(i)["lines"]) and i["id"] != service["id"]), None)
    if goods:
        ret = doc(goods, SALES_RETURN, lambda l: 1)
        post(f"/invoices/{ret['id']}/post")
        done.append("sales return of 1 unit")
    customer = next(p for p in partners().values() if p["isCustomer"])
    laptop = next(i for i in items_by_name().values() if i.get("defaultUnitPrice"))
    post("/invoices", {"partnerId": customer["id"], "issueDate": TODAY.isoformat(), "dueDate": (TODAY + timedelta(days=15)).isoformat(),
                       "documentType": PROFORMA, "internalNotes": "Ofertë paraprake",
                       "lines": [{"description": laptop["name"], "quantity": 5, "unitPrice": laptop["defaultUnitPrice"],
                                  "taxDefinitionId": laptop.get("defaultTaxDefinitionId"), "revenueAccountId": None, "itemId": laptop["id"]}]})
    done.append("proforma (draft)")
    return ", ".join(done)


def purchasing():
    if items_of(get("/purchase-orders")):
        return "already there"
    names = items_by_name()
    euro = vendor()
    main = main_warehouse()
    received = post("/purchase-orders", {"partnerId": euro["id"], "date": (TODAY - timedelta(days=3)).isoformat(),
                                         "expectedDate": (TODAY + timedelta(days=4)).isoformat(), "warehouseId": main, "vendorReference": "EI-PO-5512",
                                         "lines": [{"itemId": names["Kabllo HDMI 2 m"]["id"], "description": "Kabllo HDMI 2 m", "quantity": 100, "unitPrice": 4.13,
                                                    "taxDefinitionId": X.tax["B18"]},
                                                   {"itemId": names["Bateri Duracell AA (4 copë)"]["id"], "description": "Bateri Duracell AA", "quantity": 200,
                                                    "unitPrice": 3.10, "taxDefinitionId": X.tax["B18"]}]})
    post(f"/purchase-orders/{received['id']}/confirm")
    receipt_id = post(f"/purchase-orders/{received['id']}/receipt")
    post(f"/stock-documents/{receipt_id}/post")
    pending = post("/purchase-orders", {"partnerId": euro["id"], "date": TODAY.isoformat(), "expectedDate": (TODAY + timedelta(days=10)).isoformat(),
                                        "warehouseId": main, "lines": [{"itemId": names["Kufje Sony WH-CH520"]["id"], "description": "Kufje Sony WH-CH520",
                                                                        "quantity": 20, "unitPrice": 35.4, "taxDefinitionId": X.tax["B18"]}]})
    post(f"/purchase-orders/{pending['id']}/confirm")
    post("/purchase-orders", {"partnerId": euro["id"], "date": TODAY.isoformat(), "notes": "Draft për muajin e ardhshëm",
                              "lines": [{"itemId": names["Maus pa tel Logitech M185"]["id"], "description": "Maus Logitech", "quantity": 50,
                                         "unitPrice": 10.5, "taxDefinitionId": X.tax["B18"]}]})

    # Goods with lots and expiry dates.
    oil = item("Vaj ulliri 1 L", 7.90, vat="S08", tracked=True, trackLots=True, barcode="8001234560019")
    yogurt = item("Kos Vita 500 g", 0.85, vat="S08", tracked=True, trackLots=True, barcode="3830001020039")
    bill(euro["id"], [
        {"description": "Vaj ulliri", "quantity": 60, "unitPrice": 5.20, "taxDefinitionId": X.tax["B08"], "expenseAccountId": None,
         "itemId": oil["id"], "lotNumber": "L2401", "expiryDate": (TODAY + timedelta(days=400)).isoformat()},
        {"description": "Vaj ulliri", "quantity": 40, "unitPrice": 5.30, "taxDefinitionId": X.tax["B08"], "expenseAccountId": None,
         "itemId": oil["id"], "lotNumber": "L2409", "expiryDate": (TODAY + timedelta(days=620)).isoformat()},
        {"description": "Kos", "quantity": 120, "unitPrice": 0.48, "taxDefinitionId": X.tax["B08"], "expenseAccountId": None,
         "itemId": yogurt["id"], "lotNumber": f"K{TODAY:%m%d}", "expiryDate": (TODAY + timedelta(days=12)).isoformat()},
        {"description": "Kos", "quantity": 30, "unitPrice": 0.48, "taxDefinitionId": X.tax["B08"], "expenseAccountId": None,
         "itemId": yogurt["id"], "lotNumber": f"K{(TODAY - timedelta(days=20)):%m%d}", "expiryDate": (TODAY + timedelta(days=2)).isoformat()},
    ], main)

    # A T-shirt in three sizes and two colours.
    attributes = {a["name"]: a for a in get("/items/attributes")}
    size = attributes.get("Madhësia") or post("/items/attributes", {"name": "Madhësia", "sortOrder": 0, "values": [
        {"id": None, "value": v, "sortOrder": i} for i, v in enumerate(["S", "M", "L"])]})
    colour = attributes.get("Ngjyra") or post("/items/attributes", {"name": "Ngjyra", "sortOrder": 1, "values": [
        {"id": None, "value": v, "sortOrder": i} for i, v in enumerate(["E zezë", "E bardhë"])]})
    shirt = item("Bluzë PAKO (pambuk)", 12.00, tracked=True)
    variants = post(f"/items/{shirt['id']}/variants", {"attributeValueIds": [v["id"] for v in size["values"]] + [v["id"] for v in colour["values"]]})
    variants = variants if isinstance(variants, list) else items_of(variants)
    bill(euro["id"], [{"description": v["name"], "quantity": 12, "unitPrice": 5.90, "taxDefinitionId": X.tax["B18"], "expenseAccountId": None,
                       "itemId": v["itemId"]} for v in variants], main)

    # A phone sold by serial number.
    phone = item("Telefon Samsung Galaxy A15", 189.00, tracked=True, trackSerials=True, warrantyMonths=24, barcode="8806095300112")
    bill(euro["id"], [{"description": "Samsung A15", "quantity": 5, "unitPrice": 130.0, "taxDefinitionId": X.tax["B18"], "expenseAccountId": None,
                       "itemId": phone["id"]}], main)
    return (f"3 purchase orders (one received on a goods receipt, one confirmed, one draft), olive oil and yogurt in lots "
            f"(one yogurt lot expiring in 2 days), T-shirt in {len(variants)} variants, Samsung A15 with serials")


def till_grocery():
    till = Till("PR-K4")
    names = till.catalog
    sales = 0
    done_before = any(o.get("couponCodes") for o in items_of(get(f"/pos/orders?sessionId={till.session['id']}")))
    if not any(m["kind"] == GIFT for m in get("/payment-methods")):
        post("/payment-methods", {"name": "Kartë dhuratë", "kind": GIFT, "ledgerAccountId": X.acc["240300"]})
    if done_before:
        pass
    else:
        till.sell([till.line("Banane", 1.234), till.line("Qumësht Vita 1 L", 2), till.line("Birrë Peja 0,5 L", 6, ageVerified=True),
               till.line("Shishe kthyese (depozitë)", 6)], kind=CASH)
        flash = "USB flash SanDisk 64GB" if "USB flash SanDisk 64GB" in names else None
        lines = [till.line("Kufje Sony WH-CH520")] + ([till.line(flash)] if flash else [])
        till.sell(lines, kind=CARD, couponCodes=["MIRESEVINI"], loyaltyCardNumber="LOY-0001")
        sales += 2
    # A gift card of 50 €.
    if items_of(get("/pos/gift-cards")):
        return "already there"
    till.sell([{"itemId": None, "description": "Kartë dhuratë", "quantity": 1, "unitPrice": 50, "taxDefinitionId": None,
                "giftCardNumber": ""}], kind=CARD)
    sales += 1
    customers = partners()
    if items_of(get("/pos/customer-orders")):
        return f"{sales} sales and a 50 € gift card"
    order = post("/pos/customer-orders", {"storeId": till.store_id, "kind": 0, "customerId": customers["Arben Krasniqi"]["id"],
                                          "dueDate": (TODAY + timedelta(days=30)).isoformat(), "notes": "Paguan me këste",
                                          "lines": [{"itemId": till.catalog["Kufje Sony WH-CH520"]["id"], "quantity": 2}]})
    return f"{sales} grocery sales (deposits, age check, coupon MIRESEVINI + loyalty card), a 50 € gift card, layaway {order.get('number', '')}"


def till_cafe():
    till = Till("CF-K1")
    if get(f"/pos/stores/{till.store_id}/tabs") or get(f"/pos/stores/{till.store_id}/kitchen-tickets"):
        return "already there"
    plan = get(f"/pos/stores/{till.store_id}/floor-plan")
    tables = [t for f in plan["floors"] for t in f["tables"]]
    groups = {g["name"]: g for g in get("/pos/modifier-groups")}
    extra_cheese = next(m["id"] for m in groups["Ekstra për pica"]["modifiers"] if m["name"] == "Djathë ekstra")
    c = till.catalog
    orders = [
        [("Pizza Margherita", 2, [extra_cheese]), ("Coca-Cola 0,33 L", 2, []), ("Tiramisu", 1, [])],
        [("Burger me patate", 1, []), ("Sallatë Cezar", 1, []), ("Makiato", 2, [])],
        [("Espresso", 3, []), ("Çaj me limon", 1, [])],
    ]
    paid = 0
    for i, lines in enumerate(orders):
        tab = post("/pos/tabs", {"storeId": till.store_id, "tableId": tables[i]["id"], "kind": 0, "covers": 2 + i})
        tab = post(f"/pos/tabs/{tab['id']}/lines", {"lines": [{"itemId": c[n]["id"], "quantity": q, "modifierIds": m, "course": 1} for n, q, m in lines]})
        tab = post(f"/pos/tabs/{tab['id']}/send")
        if i < 2:
            pay = [{"itemId": l["itemId"], "description": l["description"], "quantity": l["remaining"], "unitPrice": l["unitPrice"],
                    "taxDefinitionId": None, "tabLineId": l["id"]} for l in tab["lines"] if l["remaining"] > 0 and l.get("parentLineId") is None]
            till.sell(pay, kind=CASH if i == 0 else CARD, tabId=tab["id"])
            paid += 1
    return f"3 tables served (kitchen and bar tickets sent), {paid} paid, table {tables[2]['name']} still open"


def till_salon():
    till = Till("SB-K1")
    if items_of(get(f"/pos/orders?sessionId={till.session['id']}")):
        return "already there"
    start = datetime.combine(TODAY, datetime.min.time()) - timedelta(days=1)
    stamp = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    appointments = get(f"/pos/appointments?storeId={till.store_id}&from={stamp(start)}&to={stamp(start + timedelta(days=10))}")
    done = []
    if appointments:
        a = appointments[0]
        till.sell([till.line(a["serviceName"])], kind=CASH, appointmentId=a["id"])
        done.append(f"appointment {a['number']} checked out")
    customers = partners()
    holder = customers.get("Arben Krasniqi")
    till.sell([till.line("Paketë 10 masazhe")], kind=CARD, customerId=holder["id"] if holder else None)
    till.sell([till.line("Anëtarësim mujor palestër")], kind=CASH, customerId=holder["id"] if holder else None)
    done += ["a 10-massage package", "a gym membership"]
    repair_item = item("Riparim — ndërrim ekrani", 45.00, kind=SERVICE)
    ticket = post("/pos/repairs", {"storeId": till.store_id, "customerName": "Leutrim Hyseni", "device": "iPhone 12", "problem": "Ekran i thyer",
                                   "phone": "+38349777888", "serialOrPlate": "IMEI 356789104455662", "accessories": "Pa karikues",
                                   "lines": [{"itemId": repair_item["id"], "quantity": 1}]})
    done.append(f"repair {ticket['number']} taken in")
    return ", ".join(done)


def till_hotel():
    till = Till("HP-K1")
    if items_of(get(f"/pos/orders?sessionId={till.session['id']}")):
        return "already there"
    calendar = get(f"/pos/hotel/calendar?storeId={till.store_id}&from={(TODAY - timedelta(days=1)).isoformat()}&to={(TODAY + timedelta(days=10)).isoformat()}")
    bookings = [b for r in calendar["rooms"] for b in r.get("bookings", [])] + calendar.get("unassigned", [])
    guest = next((b for b in bookings if b["arrival"] == TODAY.isoformat()), None)
    done = []
    if guest:
        put(f"/pos/hotel/bookings/{guest['id']}/guests", {"guests": [
            {"id": "00000000-0000-0000-0000-000000000000", "fullName": guest["guestName"], "nationality": "DE", "documentType": "Pasaportë",
             "documentNumber": "C01X00T47", "birthDate": "1978-04-12", "isPrimary": True},
            {"id": "00000000-0000-0000-0000-000000000000", "fullName": "Anna Müller", "nationality": "DE", "documentType": "Pasaportë",
             "documentNumber": "C01X00T52", "birthDate": "1981-09-03", "isPrimary": False}]})
        booking = post(f"/pos/hotel/bookings/{guest['id']}/check-in")
        post(f"/pos/hotel/bookings/{guest['id']}/post-nights")
        done.append(f"{booking['guestName']} checked in, tonight posted")
        cafe = next(s for s in get("/pos/stores") if s["code"] == "CF1")
        dinner = post("/pos/tabs", {"storeId": till.store_id, "kind": 0, "name": "Darkë — dhoma " + (booking.get("roomNumber") or "")})
        menu = items_by_name()
        post(f"/pos/tabs/{dinner['id']}/lines", {"lines": [{"itemId": menu["Pizza Capricciosa"]["id"], "quantity": 2}, {"itemId": menu["Coca-Cola 0,33 L"]["id"], "quantity": 2}]})
        post(f"/pos/tabs/{dinner['id']}/charge-to-room?bookingId={guest['id']}")
        done.append("dinner charged to the room")
    event = next(e for e in get("/pos/ticketed-events") if e["name"].startswith("Koncert"))
    till.sell([till.line("Biletë koncerti — standard", 2), till.line("Biletë koncerti — VIP")], kind=CARD)
    done.append(f"3 tickets for {event['name']}")
    return ", ".join(done)


def till_pharmacy():
    till = Till("BP-K1")
    if items_of(get(f"/pos/orders?sessionId={till.session['id']}")):
        return "already there"
    rx = next(p for p in items_of(get("/pos/pharmacy/prescriptions")) if p["number"] == "RX-2026-0001")
    lines = [till.line(next(n for n in till.catalog if n.startswith(l["itemName"][:10])), l["remaining"], prescriptionLineId=l["id"]) for l in rx["lines"]]
    quote = till.quote(lines, prescriptionId=rx["id"])
    on_account = till.tender.get(ON_ACCOUNT)
    if on_account is None:
        receivable = X.acc.get("111100") or next(v for k, v in X.acc.items() if k.startswith("111"))
        on_account = post("/payment-methods", {"name": "Në llogari", "kind": ON_ACCOUNT, "ledgerAccountId": receivable})["id"]
    share = next((p for p in quote.get("tenderPartners") or []), None)
    payments = []
    if share:
        payments.append({"paymentMethodId": on_account, "amount": share["max"], "partnerId": share["partnerId"]})
    rest = round(quote["total"] - (share["max"] if share else 0), 2)
    if rest > 0:
        payments.append({"paymentMethodId": till.tender[CASH], "amount": rest})
    till.sell(lines, payments, prescriptionId=rx["id"])
    till.sell([till.line("Paracetamol 500 mg (20 tableta)", 2)], kind=CASH)
    return f"prescription RX-2026-0001 dispensed ({share['name'] + ' paid ' + str(share['max']) if share else 'no payer'}), an OTC sale"


def till_fuel():
    till = Till("PK-K1")
    if items_of(get(f"/pos/orders?sessionId={till.session['id']}")):
        return "already there"
    nozzles = get(f"/pos/forecourt/nozzles?storeId={till.store_id}")
    by = {(n["pump"], n["number"]): n for n in nozzles}
    fills = [((1, 1), "Naftë D2", 42.5, CASH), ((1, 2), "Benzinë 95", 30.0, CARD), ((2, 1), "Naftë D2", 61.2, CASH)]
    for key, name, litres, kind in fills:
        till.sell([till.line(name, litres, nozzleId=by[key]["id"])], kind=kind)
    on_account = till.tender.get(ON_ACCOUNT) or next(m["id"] for m in get("/payment-methods") if m["kind"] == ON_ACCOUNT)
    line = [till.line("Naftë D2", 120, nozzleId=by[(2, 1)]["id"])]
    quote = till.quote(line, fleetCardNumber="FC-1001")
    card = next(p for p in quote["tenderPartners"])
    till.sell(line, [{"paymentMethodId": on_account, "amount": quote["total"], "partnerId": card["partnerId"], "reference": "01-123-AB"}],
              fleetCardNumber="FC-1001")
    readings = []
    pumped = {(1, 1): 42.5, (1, 2): 30.0, (2, 1): 181.2, (2, 2): 0}
    for key, n in by.items():
        opening = n["lastClosing"] or 100000.0 + key[0] * 1000 + key[1]
        readings.append({"nozzleId": n["id"], "opening": opening, "closing": round(opening + pumped[key] + (0.3 if key == (1, 1) else 0), 3)})
    post("/pos/forecourt/readings", {"storeId": till.store_id, "date": TODAY.isoformat(), "sessionId": till.session["id"], "readings": readings})
    return "4 fills (120 L on fleet card FC-1001), the shift's meter readings (0.3 L unexplained on pump 1/1)"


def till_webshop():
    till = Till("PR-K1")
    order = next((o for o in items_of(get("/pos/channel-orders")) if o["externalRef"] == "SHOP-1002"), None)
    if order is None or order["posOrderId"]:
        return "already there"
    on_account = till.tender.get(ON_ACCOUNT) or next(m["id"] for m in get("/payment-methods") if m["kind"] == ON_ACCOUNT)
    by_id = {i["id"]: i for i in till.catalog.values()}
    lines = [{"itemId": l["itemId"], "description": l["description"], "quantity": l["quantity"], "unitPrice": l["unitPrice"],
              "taxDefinitionId": by_id[l["itemId"]]["taxDefinitionId"]} for l in order["lines"]]
    quote = till.quote(lines, channelOrderId=order["id"])
    courier = next(p for p in quote["tenderPartners"])
    till.sell(lines, [{"paymentMethodId": on_account, "amount": quote["total"], "partnerId": courier["partnerId"], "reference": order["trackingNumber"]}],
              channelOrderId=order["id"])
    pickup = next((o for o in items_of(get("/pos/channel-orders")) if o["externalRef"] == "SHOP-1001"), None)
    if pickup and pickup["state"] == 0:
        post(f"/pos/channel-orders/{pickup['id']}/state", {"state": 1})
    return f"{order['number']} dispatched with Postakos (cash on delivery {quote['total']}), SHOP-1001 accepted for pickup"


def till_phone():
    till = Till("PR-K1")
    if "Telefon Samsung Galaxy A15" not in till.catalog:
        return "phone not in the catalogue"
    try:
        get("/pos/serials/SN-A15-0001")
        return "already there"
    except ApiError:
        pass
    till.sell([till.line("Telefon Samsung Galaxy A15", serialNumber="SN-A15-0001")], kind=CARD)
    return "Samsung A15 sold with serial SN-A15-0001 (24-month warranty)"


def main():
    log(f"Seeding activity against {API}")
    X.token = call("POST", "/api/auth/login", {"email": DEMO_EMAIL, "password": DEMO_PASSWORD})["token"]
    payload = X.token.split(".")[1]
    X.user_id = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]
    company = next((c for c in call("GET", "/api/companies") if c["name"] == COMPANY_NAME), None)
    if company is None:
        sys.exit(f"'{COMPANY_NAME}' not found; run the other seed scripts first.")
    X.c = f"/api/companies/{company['id']}"
    X.acc = {a["code"]: a["id"] for a in items_of(get("/accounts"))}
    X.tax = {t.get("code"): t["id"] for t in get("/taxes")}
    failed = 0
    for name, section in [("company", company_setup), ("HR", hr), ("sales documents", sales_documents), ("purchasing & stock", purchasing),
                          ("till: groceries", till_grocery), ("till: café", till_cafe), ("till: salon", till_salon), ("till: hotel", till_hotel),
                          ("till: pharmacy", till_pharmacy), ("till: fuel", till_fuel), ("till: webshop", till_webshop), ("till: phone", till_phone)]:
        try:
            log(f"ok    {name}: {section()}")
        except Exception as error:  # noqa: BLE001
            failed += 1
            log(f"FAIL  {name}: {error}")
            if not isinstance(error, ApiError):
                traceback.print_exc()
    log("Done." if not failed else f"Done with {failed} failed section(s).")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
