#!/usr/bin/env python3
"""Stock & inventory end-to-end check against a running API (docs/INVENTORY_PLAN.md).

Drives phase 1 through real HTTP with a fresh user and company each run, so it is safe to repeat
against a dev database. Covers:
  - the main warehouse appearing on first look;
  - opening stock;
  - a sale refused for lack of stock, then a sale with its cost of goods sold;
  - averaging on a purchase;
  - a transfer to a second warehouse;
  - a count, and write-offs (ATK notice, VAT repayment);
  - the tracking lock;
  - selling below zero under "warn";
  - the stock-to-ledger tie-out and the margin report.
Standard library only.

    python3 scripts/e2e/stock.py                    # API at http://127.0.0.1:5248
    PAKO_API=http://host:port python3 scripts/e2e/stock.py

Exits non-zero on the first failed check.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
RUN = uuid.uuid4().hex[:8]
PASSWORD = "E2e-Passw0rd!"
CHECKS = 0

# Enums travel as numbers (no string enum converter in Pako.Api).
GOODS = 0
OPENING, TRANSFER, COUNT, WRITE_OFF = 0, 1, 2, 3
POSTED = 1
DAMAGED, THEFT = 1, 2
BLOCK, WARN = 0, 1


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
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, f"{method} {path}: " + error.read().decode(errors="replace")) from None


def check(condition, message):
    global CHECKS
    if not condition:
        print(f"FAIL  {message}")
        sys.exit(1)
    CHECKS += 1
    print(f"ok    {message}")


def expect_status(status, fn, message):
    try:
        fn()
    except ApiError as error:
        check(error.status == status, f"{message} (got {error.status})")
        return
    check(False, f"{message} (call succeeded)")


def main():
    today = date.today()
    d0, d1, d2, d3 = (today - timedelta(days=n) for n in (20, 15, 10, 5))
    print(f"PAKO stock e2e against {API} (run {RUN})")

    email = f"stock.{RUN}@e2e.test"
    call("POST", "/api/auth/register", body={"email": email, "password": PASSWORD})
    token = call("POST", "/api/auth/login", body={"email": email, "password": PASSWORD})["token"]
    company = call("POST", "/api/companies", token, {"name": f"E2E Stock {RUN}", "enabledProfiles": 1})
    c = f"/api/companies/{company['id']}"
    accounts = call("GET", f"{c}/accounts", token)
    accounts = accounts["items"] if isinstance(accounts, dict) else accounts
    acc = {a["code"]: a["id"] for a in accounts}
    taxes = {t.get("code"): t["id"] for t in call("GET", f"{c}/taxes", token)}
    s18, b18 = taxes["S18"], taxes["B18"]

    # ---- Setup ----
    warehouses = call("GET", f"{c}/inventory/warehouses", token)
    check(len(warehouses) == 1 and warehouses[0]["code"] == "MAIN" and warehouses[0]["isDefault"],
          "the main warehouse exists from the first look, as the default")
    main_wh = warehouses[0]["id"]
    category = call("POST", f"{c}/inventory/categories", token, {
        "name": "Laptops", "inventoryAccountId": None, "cogsAccountId": None, "revenueAccountId": acc["400100"], "expenseAccountId": None})
    item = call("POST", f"{c}/items", token, {
        "name": "Laptop", "unit": "copë", "type": GOODS, "defaultTaxDefinitionId": s18, "defaultUnitPrice": 236,
        "categoryId": category["id"], "trackInventory": True, "minimumStock": 5})
    check(item["trackInventory"] and item["categoryId"] == category["id"], "a goods item tracks stock in its category")
    customer = call("POST", f"{c}/partners", token, {"name": "Customer", "isCustomer": True, "isVendor": False,
                                                       "fiscalNumber": "811111111", "paymentTermDays": 30})["id"]
    vendor = call("POST", f"{c}/partners", token, {"name": "Vendor", "isCustomer": False, "isVendor": True,
                                                     "fiscalNumber": "811111112", "paymentTermDays": 30})["id"]

    def document(body, post=True):
        doc = call("POST", f"{c}/stock-documents", token, {"warehouseId": main_wh, **body})
        return call("POST", f"{c}/stock-documents/{doc['id']}/post", token) if post else doc

    def invoice(on, qty, gross=236):
        inv = call("POST", f"{c}/invoices", token, {
            "partnerId": customer, "issueDate": on.isoformat(), "dueDate": on.isoformat(),
            "lines": [{"description": "Laptop", "quantity": qty, "unitPrice": gross, "taxDefinitionId": s18,
                       "revenueAccountId": None, "itemId": item["id"]}]})
        return call("POST", f"{c}/invoices/{inv['id']}/post", token) or inv

    def valuation():
        return call("GET", f"{c}/inventory/valuation?asOf={today.isoformat()}", token)

    # ---- Opening stock: 10 at 100 ----
    opening = document({"type": OPENING, "date": d0.isoformat(),
                        "lines": [{"itemId": item["id"], "quantity": 10, "unitCost": 100}]})
    check(opening["state"] == POSTED and opening["number"].startswith("HAP-") and opening["totalValue"] == 1000,
          "opening stock posts as HAP- for 1,000")
    v = valuation()
    check(v["stockValue"] == 1000 and v["difference"] == 0, "valuation 1,000 ties to the ledger")

    # ---- Sales ----
    expect_status(400, lambda: invoice(d1, 12), "selling 12 of 10 is refused under 'block'")
    invoice(d1, 4)
    on_hand = call("GET", f"{c}/inventory/on-hand?itemIds={item['id']}", token)
    check(on_hand[0]["quantity"] == 6, "selling 4 leaves 6 on hand")
    v = valuation()
    check(v["stockValue"] == 600 and v["difference"] == 0, "the sale moved 400 to cost of goods sold")

    # ---- Purchase: 10 at 130 net -> average (600 + 1300) / 16 ----
    bill = call("POST", f"{c}/bills", token, {
        "partnerId": vendor, "vendorReference": f"V-{RUN}", "issueDate": d2.isoformat(), "dueDate": d2.isoformat(),
        "lines": [{"description": "Laptop", "quantity": 10, "unitPrice": 153.4, "taxDefinitionId": b18,
                   "expenseAccountId": None, "itemId": item["id"]}]})
    call("POST", f"{c}/bills/{bill['id']}/post", token)
    level = call("GET", f"{c}/inventory/stock", token)["items"][0]
    check(level["quantity"] == 16 and abs(level["averageCost"] - 118.75) < 1e-6 and level["value"] == 1900,
          "a purchase of 10 at 130 averages the cost to 118.75")

    # ---- Transfer 5 to a second warehouse ----
    shop = call("POST", f"{c}/inventory/warehouses", token, {"code": "SHOP", "name": "Shop", "address": None})["id"]
    transfer = document({"type": TRANSFER, "date": d2.isoformat(), "destinationWarehouseId": shop,
                         "lines": [{"itemId": item["id"], "quantity": 5}]})
    check(transfer["number"].startswith("TRF-") and transfer["journalEntryId"] is None, "a transfer posts with no journal entry")
    level = call("GET", f"{c}/inventory/stock?warehouseId={shop}", token)["items"][0]
    check(level["quantity"] == 5, "the shop holds 5")

    # ---- Count: 11 in the book, 10 counted ----
    sheet = call("GET", f"{c}/stock-documents/count-sheet?warehouseId={main_wh}&date={d3.isoformat()}", token)
    check(sheet[0]["bookQuantity"] == 11, "the count sheet shows 11 in the main warehouse")
    count = document({"type": COUNT, "date": d3.isoformat(), "lines": [{"itemId": item["id"], "quantity": 10}]})
    check(count["number"].startswith("INVR-") and count["lines"][0]["difference"] == -1, "the count posts a shortage of 1")

    # ---- Write-offs ----
    expect_status(400, lambda: document({"type": WRITE_OFF, "date": d3.isoformat(), "reason": DAMAGED,
                                         "lines": [{"itemId": item["id"], "quantity": 1}]}),
                  "destroying damaged goods without the ATK notice is refused")
    expect_status(400, lambda: document({"type": WRITE_OFF, "date": d3.isoformat(), "reason": DAMAGED,
                                         "atkNoticeDate": (d3 - timedelta(days=5)).isoformat(),
                                         "lines": [{"itemId": item["id"], "quantity": 1}]}),
                  "an ATK notice only 5 days before is refused")
    theft = document({"type": WRITE_OFF, "date": d3.isoformat(), "warehouseId": shop, "reason": THEFT,
                      "lines": [{"itemId": item["id"], "quantity": 1}]})
    check(theft["number"].startswith("NJP-") and theft["vatRepaymentDue"], "a theft write-off flags the input VAT to repay")

    # ---- Locks ----
    expect_status(400, lambda: call("PUT", f"{c}/items/{item['id']}", token, {
        "name": "Laptop", "unit": "copë", "type": GOODS, "trackInventory": False}),
        "tracking can't be switched off once stock has moved")
    check(call("GET", f"{c}/inventory/settings", token)["costMethodLocked"], "the cost method is locked once stock has moved")

    # ---- Selling below zero under "warn" ----
    call("PUT", f"{c}/inventory/settings", token, {"negativeStock": WARN, "defaultWarehouseId": main_wh})
    invoice(today, 12)
    on_hand = call("GET", f"{c}/inventory/on-hand?itemIds={item['id']}&warehouseId={main_wh}", token)
    check(on_hand[0]["quantity"] == -2, "under 'warn' a sale of 12 of 10 leaves -2")
    low = call("GET", f"{c}/inventory/stock?belowMinimum=true", token)["items"]
    check(len(low) == 1, "the item shows on the low-stock report")

    # ---- Reports ----
    v = valuation()
    check(v["difference"] == 0, f"stock {v['stockValue']} still ties to the ledger")
    margin = call("GET", f"{c}/inventory/margin?from={d0.isoformat()}&to={today.isoformat()}&groupBy=item", token)
    check(margin["netSales"] == 3200 and margin["rows"][0]["quantity"] == 16, "margin covers 16 sold for 3,200 net")
    card = call("GET", f"{c}/inventory/items/{item['id']}/card?from={d0.isoformat()}&to={today.isoformat()}", token)
    check(card["closingQuantity"] == 2 and len(card["rows"]) >= 7, "the item card lists every move, closing at 2")

    print(f"\nAll {CHECKS} checks passed.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
