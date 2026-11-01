#!/usr/bin/env python3
"""Add point-of-sale demo data to the demo company (docs/POS_PLAN.md), through the API.

Run scripts/seed_demo.py first; this builds on its company "Pako Demo Sh.p.k.". Creates:
  - shop items with barcodes (accessories at 18%, books and magazines at 8%), bought in on a
    bill and partly transferred to a second warehouse for the Prizren shop
  - two stores (Prishtina, Prizren), three training registers and one SEF register (no ATK
    certificate yet, so it shows what onboarding still needs)
  - per training register: two closed and posted sessions of sales (cash with change, card,
    split), discounts, a return, a cancellation and cash movements, one closing a little short
  - a session left open on Prishtina K1 with a few sales, so the till opens ready to sell

POS sessions open on the day the script runs (the API has no back-dating).

    python3 scripts/seed_pos_demo.py
    PAKO_API=http://host:port python3 scripts/seed_pos_demo.py

Refuses to run again once the company has POS coupons; an interrupted run can simply be repeated. Standard library only.
"""

import json
import math
import os
import random
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
DEMO_EMAIL = "demo.admin@pako.test"
DEMO_PASSWORD = "Demo-Passw0rd!"
COMPANY_NAME = os.environ.get("PAKO_DEMO_COMPANY", "Pako Demo Sh.p.k.")

GOODS = 0
TRANSFER = 1
RETAIL = 0
TRAINING, SEF = 0, 1
SALE, RETURN, CANCEL = 0, 1, 2
FLOAT_IN, TO_BANK, PETTY_OUT, PAID_OUT = 0, 1, 3, 4
CASH, CARD = 0, 2

rng = random.Random(2610)
TODAY = date.today()

# name, unit, gross price, VAT code, barcode, weight (how often it sells)
SHOP_ITEMS = [
    ("Maus pa tel Logitech M185", "copë", 17.90, "S18", "5099206027295", 8),
    ("Tastierë Logitech K120", "copë", 14.50, "S18", "5099206020869", 5),
    ("USB flash SanDisk 64GB", "copë", 9.90, "S18", "0619659187449", 9),
    ("Kufje Sony WH-CH520", "copë", 54.90, "S18", "4548736143661", 3),
    ("Karikues Samsung USB-C 25W", "copë", 19.90, "S18", "8806090960977", 7),
    ("Kabllo HDMI 2 m", "copë", 6.50, "S18", "3830042110021", 8),
    ("Bateri Duracell AA (4 copë)", "pako", 4.80, "S18", "5000394052543", 10),
    ("Mbrojtëse ekrani për laptop", "copë", 7.90, "S18", "3830042110038", 3),
    ("Çantë laptopi 15,6\"", "copë", 29.00, "S18", "3830042110045", 3),
    ("Libër: Programimi në Python", "copë", 14.00, "S08", "9789951000017", 2),
    ("Revistë PC World", "copë", 3.50, "S08", "9771234567003", 4),
]
# Bigger items from seed_demo.py that also sell over the counter now and then.
COUNTER_EXTRAS = {"Monitor 27\" Samsung": 1, "Router MikroTik": 1, "Printer HP LaserJet": 1}

OPERATORS_NOTE = "Demo POS"


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:500]}")
        self.status = status


def call(method, path, token=None, body=None):
    headers = {"Accept-Language": "en", "Content-Type": "application/json"}
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


def log(message):
    print(message, flush=True)


def handed_over(total):
    """What a customer hands over for a cash total: exact, or the next round note."""
    if rng.random() < 0.25:
        return total
    for note in (5, 10, 20, 50, 100):
        if total < note:
            return float(note)
    return float(math.ceil(total / 50) * 50)


def main():
    log(f"Seeding POS demo data against {API}")
    token = call("POST", "/api/auth/login", body={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})["token"]
    company = next((c for c in call("GET", "/api/companies", token) if c["name"] == COMPANY_NAME), None)
    if company is None:
        sys.exit(f"'{COMPANY_NAME}' not found for {DEMO_EMAIL}; run scripts/seed_demo.py first.")
    c = f"/api/companies/{company['id']}"
    if call("GET", f"{c}/pos/orders", token)["total"]:
        sys.exit(f"'{COMPANY_NAME}' already has POS coupons; nothing to do.")

    accounts = call("GET", f"{c}/accounts", token)
    accounts = accounts["items"] if isinstance(accounts, dict) else accounts
    acc = {a["code"]: a["id"] for a in accounts}
    taxes = {t.get("code"): t["id"] for t in call("GET", f"{c}/taxes", token)}
    expense = acc.get("660300") or next(a["id"] for a in accounts if a["code"].startswith("66"))
    bank = acc.get("101003") or next(a["id"] for a in accounts if a["code"].startswith("101"))

    # ---- Shop items, bought in and split between two warehouses ----
    # Each step reuses what an interrupted earlier run already made.
    warehouses = call("GET", f"{c}/inventory/warehouses", token)
    main_wh = next(w for w in warehouses if w["isDefault"])["id"]
    prizren_wh = next((w["id"] for w in warehouses if w["code"] == "PZ"), None) or call(
        "POST", f"{c}/inventory/warehouses", token, {"code": "PZ", "name": "Dyqani Prizren", "address": "Rr. Shën Flori, Prizren"})["id"]
    category = next((k["id"] for k in call("GET", f"{c}/inventory/categories", token) if k["name"] == "Aksesorë dhe libra"), None) or call(
        "POST", f"{c}/inventory/categories", token, {"name": "Aksesorë dhe libra", "inventoryAccountId": None, "cogsAccountId": None,
                                                     "revenueAccountId": acc["400100"], "expenseAccountId": None})["id"]
    existing = {i["name"]: i for i in call("GET", f"{c}/items?pageSize=500", token)["items"]}
    shop_items, new_items = [], []
    for name, unit, price, vat, barcode, weight in SHOP_ITEMS:
        item = existing.get(name)
        if item is None:
            item = call("POST", f"{c}/items", token, {
                "name": name, "unit": unit, "type": GOODS, "defaultTaxDefinitionId": taxes[vat],
                "defaultRevenueAccountId": acc["400100"], "defaultExpenseAccountId": acc["500100"],
                "defaultInventoryAccountId": acc["120100"], "defaultUnitPrice": price, "categoryId": category,
                "trackInventory": True, "minimumStock": 10})
            new_items.append(item["id"])
        if not item.get("barcodes"):
            call("POST", f"{c}/items/{item['id']}/barcodes", token, {"barcode": barcode})
        shop_items.append((item["id"], name, price, vat))
    if new_items:
        partners = call("GET", f"{c}/partners", token)
        partners = partners["items"] if isinstance(partners, dict) else partners
        vendor = next((p["id"] for p in partners if p["name"] == "Euro Import Sh.p.k."), None) or call(
            "POST", f"{c}/partners", token, {"name": "Euro Import Sh.p.k.", "isCustomer": False, "isVendor": True,
                                             "fiscalNumber": "810000100", "paymentTermDays": 30})["id"]
        bought_on = TODAY - timedelta(days=7)
        fresh = [x for x in shop_items if x[0] in new_items]
        bill = call("POST", f"{c}/bills", token, {
            "partnerId": vendor, "vendorReference": f"EUR-POS-{TODAY:%y%m%d}", "issueDate": bought_on.isoformat(),
            "dueDate": (bought_on + timedelta(days=30)).isoformat(),
            "lines": [{"description": name, "quantity": 120, "unitPrice": round(price * 0.55, 2),
                       "taxDefinitionId": taxes["B08" if vat == "S08" else "B18"], "expenseAccountId": None, "itemId": item_id}
                      for item_id, name, price, vat in fresh]})
        call("POST", f"{c}/bills/{bill['id']}/post", token)
        transfer = call("POST", f"{c}/stock-documents", token, {
            "type": TRANSFER, "date": bought_on.isoformat(), "warehouseId": main_wh, "destinationWarehouseId": prizren_wh,
            "notes": "Furnizim i dyqanit në Prizren", "lines": [{"itemId": item_id, "quantity": 45} for item_id, *_ in fresh]})
        call("POST", f"{c}/stock-documents/{transfer['id']}/post", token)
    log(f"{len(shop_items)} shop items with barcodes ({len(new_items)} new, bought in and split between MAIN and PZ)")

    # ---- Stores and registers ----
    stores = {x["code"]: x for x in call("GET", f"{c}/pos/stores", token)}
    registers = {x["code"]: x for x in call("GET", f"{c}/pos/registers", token)}
    prishtina = stores.get("PR1") or call("POST", f"{c}/pos/stores", token, {
        "code": "PR1", "name": "Dyqani Prishtina", "address": "Rr. Agim Ramadani 15", "fiscalBranchNumber": 1,
        "location": "Prishtinë", "warehouseId": main_wh,
        "receiptHeader": "PAKO DEMO — Teknologji për zyrën", "receiptFooter": "Faleminderit për blerjen!\nKthimi brenda 14 ditëve me kupon."})
    prizren = stores.get("PZ1") or call("POST", f"{c}/pos/stores", token, {
        "code": "PZ1", "name": "Dyqani Prizren", "address": "Rr. Shën Flori 4", "fiscalBranchNumber": 2,
        "location": "Prizren", "warehouseId": prizren_wh, "receiptFooter": "Ju mirëpresim sërish!"})

    def register(store, code, name, pos_no, mode=TRAINING):
        if code in registers:
            return registers[code]
        return call("POST", f"{c}/pos/registers", token, {
            "storeId": store["id"], "code": code, "name": name, "profile": RETAIL, "fiscalMode": mode,
            "fiscalPosNumber": pos_no, "cashAccountId": acc["100100"]})

    tills = [register(prishtina, "PR-K1", "Prishtina — Arka 1", 1), register(prishtina, "PR-K2", "Prishtina — Arka 2", 2),
             register(prizren, "PZ-K1", "Prizren — Arka 1", 1)]
    register(prishtina, "PR-K3", "Prishtina — Arka 3 (SEF)", 3, SEF)
    log("2 stores, 3 training registers and 1 SEF register awaiting its ATK certificate")

    # ---- Sessions ----
    totals = {"orders": 0, "returns": 0, "cancellations": 0, "sessions": 0}

    def run_session(reg, sales, *, close=True, short=0.0):
        r = f"{c}/pos/registers/{reg['id']}"
        boot = call("GET", f"{r}/bootstrap", token)
        session = boot["session"] or call("POST", f"{r}/sessions", token, {"openingFloat": rng.choice([50, 100, 150])})
        tender = {t["kind"]: t["id"] for t in boot["tenders"]}
        catalog = {i["id"]: i for i in call("GET", f"{r}/catalog", token)}
        pool = [(item_id, weight) for (item_id, _, _, _), (*_, weight) in zip(shop_items, SHOP_ITEMS)]
        pool += [(i["id"], w) for i in catalog.values() for n, w in COUNTER_EXTRAS.items() if i["name"] == n]
        ids, weights = zip(*[(i, w) for i, w in pool if catalog.get(i, {}).get("price") is not None])
        clock = datetime.now(timezone.utc) - timedelta(hours=sales * 0.2)
        recorded = []

        def submit(kind, lines, payments, **extra):
            nonlocal clock
            clock += timedelta(minutes=rng.randint(3, 15))
            order = call("POST", f"{c}/pos/orders", token, {
                "clientUuid": str(uuid.uuid4()), "sessionId": session["id"], "kind": kind,
                "orderedAt": min(clock, datetime.now(timezone.utc)).isoformat(), "lines": lines, "payments": payments, **extra})
            totals["orders"] += 1
            return order

        for _ in range(sales):
            basket = {}
            for item_id in rng.choices(ids, weights, k=rng.choice([1, 1, 2, 2, 3, 4])):
                basket[item_id] = basket.get(item_id, 0) + 1
            lines = []
            for item_id, qty in basket.items():
                item = catalog[item_id]
                discount = round(item["price"] * qty * 0.1, 2) if rng.random() < 0.1 else 0
                lines.append({"itemId": item_id, "description": item["name"], "quantity": qty, "unitPrice": item["price"],
                              "taxDefinitionId": item["taxDefinitionId"], "discountAmount": discount})
            total = call("POST", f"{r}/quote", token, {"lines": lines})["total"]
            roll = rng.random()
            if roll < 0.55 and total <= 2000:
                payments = [{"paymentMethodId": tender[CASH], "amount": total, "tendered": handed_over(total)}]
            elif roll < 0.9 or total < 20:
                payments = [{"paymentMethodId": tender[CARD], "amount": total}]
            else:
                cash = float(int(total / 2))
                payments = [{"paymentMethodId": tender[CASH], "amount": cash, "tendered": cash},
                            {"paymentMethodId": tender[CARD], "amount": round(total - cash, 2)}]
            recorded.append(submit(SALE, lines, payments))

        if close and len(recorded) >= 6:
            # One item comes back, refunded the way it was paid for.
            sold = rng.choice([o for o in recorded[:-2] if o["lines"]])
            first = sold["lines"][0]
            back = [{"itemId": first["itemId"], "description": first["description"], "quantity": 1,
                     "unitPrice": first["unitPrice"], "taxDefinitionId": None, "discountAmount": 0, "originalLineId": first["id"]}]
            refund = call("POST", f"{r}/quote", token, {"lines": back, "originalOrderId": sold["id"]})["total"]
            submit(RETURN, back, [{"paymentMethodId": sold["payments"][0]["paymentMethodId"], "amount": refund}],
                   originalOrderId=sold["id"], reason=rng.choice(["Defekt në fabrikë", "Klienti ndërroi mendje", "Madhësi e gabuar"]))
            totals["returns"] += 1
            # The last sale was rung up by mistake and cancelled.
            last = recorded[-1]
            submit(CANCEL, [], [{"paymentMethodId": last["payments"][0]["paymentMethodId"], "amount": last["total"]}],
                   originalOrderId=last["id"], reason="Gabim në regjistrim")
            totals["cancellations"] += 1

        movements = f"{c}/pos/sessions/{session['id']}/cash-movements"
        call("POST", movements, token, {"kind": PETTY_OUT, "amount": rng.choice([3.5, 6.0, 8.2]),
                                        "reason": "Kafe dhe ujë për stafin", "counterpartAccountId": expense})
        if rng.random() < 0.5:
            call("POST", movements, token, {"kind": PAID_OUT, "amount": 15.0, "reason": "Pastrim i dyqanit",
                                            "counterpartAccountId": expense})
        if not close:
            return session
        report = call("GET", f"{c}/pos/sessions/{session['id']}/report", token)
        if report["cashExpected"] > 300:
            call("POST", movements, token, {"kind": TO_BANK, "amount": 200.0, "reason": "Depozitë në bankë",
                                            "counterpartAccountId": bank})
            report = call("GET", f"{c}/pos/sessions/{session['id']}/report", token)
        counted = []
        for t in report["tenders"]:
            is_cash = t["paymentMethodId"] == tender[CASH]
            value = round(t["expected"] + (short if is_cash else 0), 2)
            counted.append({"paymentMethodId": t["paymentMethodId"], "counted": value,
                            "differenceReason": ("Gabim në kusur" if short < 0 else "Tepricë e pa shpjeguar") if is_cash and short else None})
        call("POST", f"{c}/pos/sessions/{session['id']}/close", token, {"counted": counted})
        totals["sessions"] += 1
        return session

    for i, reg in enumerate(tills):
        run_session(reg, rng.randint(14, 22), short=-2.5 if i == 0 else 0)
        run_session(reg, rng.randint(14, 22), short=1.0 if i == 2 else 0)
    run_session(tills[0], 5, close=False)
    log(f"{totals['sessions']} closed sessions, {totals['orders']} coupons "
        f"({totals['returns']} returns, {totals['cancellations']} cancellations); PR-K1 left open")
    log("Done. Open Pika e shitjes → Arkat in PAKO.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
