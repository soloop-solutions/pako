#!/usr/bin/env python3
"""Stock & inventory end-to-end check against a running API (docs/INVENTORY_PLAN.md).

Drives phase 1 through real HTTP with a fresh user and company each run, so it is safe to repeat
against a dev database. Covers:
  - the main warehouse appearing on first look;
  - opening stock;
  - a sale refused for lack of stock, then a sale with its cost of goods sold;
  - averaging on a purchase;
  - a transfer to a second warehouse;
  - a count with its printable PDF sheet, and write-offs (ATK notice, input VAT reversed, attachment);
  - a write-down to net realisable value; the year-end count check;
  - the tracking lock; the low-stock list with the usual supplier;
  - selling below zero under "warn";
  - the stock-to-ledger tie-out and the margin report;
  - a price list with a posted price change; a purchase order billed in part, then received on a
    receipt (GRNI).
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
OPENING, TRANSFER, COUNT, WRITE_OFF, WRITE_DOWN = 0, 1, 2, 3, 4
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


def raw(method, path, token, data=None, content_type=None):
    """A request whose body or response isn't JSON (multipart upload, PDF download)."""
    headers = {"Authorization": f"Bearer {token}", "Accept-Language": "en"}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, f"{method} {path}: " + error.read().decode(errors="replace")) from None


def upload(path, token, fields, filename, content, content_type):
    boundary = uuid.uuid4().hex
    parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in fields.items()]
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"File\"; filename=\"{filename}\"\r\n"
                 f"Content-Type: {content_type}\r\n\r\n".encode() + content + b"\r\n")
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    return raw("POST", path, token, body, f"multipart/form-data; boundary={boundary}")


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
    status, pdf = raw("GET", f"{c}/stock-documents/count-sheet/pdf?warehouseId={main_wh}&date={d3.isoformat()}&blind=true", token)
    check(status == 200 and pdf[:4] == b"%PDF", "the blind count sheet prints as a PDF")
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
    status, _ = upload(f"{c}/attachments", token, {"OwnerType": "StockDocument", "OwnerId": theft["id"]},
                       "police-report.pdf", b"%PDF-1.4 report", "application/pdf")
    files = call("GET", f"{c}/attachments?ownerType=5&ownerId={theft['id']}", token)
    check(status == 201 and [f["fileName"] for f in files] == ["police-report.pdf"], "the police report is attached to the write-off")
    # 1 laptop at 118.75 average: 18% of it is the input VAT given back.
    check(theft["vatRepaid"] == 21.38, f"the theft reversed 21.38 of input VAT (got {theft['vatRepaid']})")

    # ---- Write-down to net realisable value (IAS 2) ----
    write_down = document({"type": WRITE_DOWN, "date": d3.isoformat(), "lines": [{"itemId": item["id"], "quantity": 0, "unitCost": 100}]})
    line = write_down["lines"][0]
    check(write_down["number"].startswith("ZHV-") and line["allowanceAfter"] == 18.75 * line["bookQuantity"],
          "a write-down to 100 a unit sets the allowance to 18.75 per unit in stock")
    v = valuation()
    check(v["writeDownAllowance"] == write_down["totalValue"] and v["netValue"] == v["stockValue"] - v["writeDownAllowance"],
          "the valuation shows the allowance and the net stock value")

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
    check(len(low) == 1 and low[0]["usualSupplierName"] == "Vendor" and low[0]["shortBy"] == 3,
          "the low-stock report names the usual supplier and the shortfall")

    # ---- Reports ----
    v = valuation()
    check(v["difference"] == 0, f"stock {v['stockValue']} still ties to the ledger")
    margin = call("GET", f"{c}/inventory/margin?from={d0.isoformat()}&to={today.isoformat()}&groupBy=item", token)
    check(margin["netSales"] == 3200 and margin["rows"][0]["quantity"] == 16, "margin covers 16 sold for 3,200 net")
    card = call("GET", f"{c}/inventory/items/{item['id']}/card?from={d0.isoformat()}&to={today.isoformat()}", token)
    check(card["closingQuantity"] == 2 and len(card["rows"]) >= 7, "the item card lists every move, closing at 2")

    # ---- Price lists and a price change (Nivelim) ----
    retail = call("POST", f"{c}/price-lists", token, {"name": "Retail", "warehouseId": None})
    change = call("POST", f"{c}/price-changes", token, {"priceListId": retail["id"], "date": d0.isoformat(),
                                                         "lines": [{"itemId": item["id"], "newPrice": 250}]})
    change = call("POST", f"{c}/price-changes/{change['id']}/post", token)
    check(change["number"].startswith("NIV-") and change["lines"][0]["oldPrice"] == 236,
          "a price change replaces the item's 236 with 250 and keeps the old price on record")
    resolved = call("GET", f"{c}/prices/resolve?itemIds={item['id']}&date={today.isoformat()}", token)
    check(resolved[0]["price"] == 250 and resolved[0]["source"] == "company", "invoices now start from the price list")

    # ---- Purchase order → bill ----
    order = call("POST", f"{c}/purchase-orders", token, {"partnerId": vendor, "date": d3.isoformat(), "expectedDate": None,
                                                           "lines": [{"itemId": item["id"], "description": "Laptop", "quantity": 5,
                                                                      "unitPrice": 153.4, "taxDefinitionId": b18}]})
    order = call("POST", f"{c}/purchase-orders/{order['id']}/confirm", token)
    check(order["number"].startswith("PO-") and order["state"] == 1, "a purchase order is confirmed and numbered")
    bill = call("POST", f"{c}/bills", token, {
        "partnerId": vendor, "vendorReference": f"PO-B-{RUN}", "issueDate": today.isoformat(), "dueDate": today.isoformat(),
        "lines": [{"description": "Laptop", "quantity": 3, "unitPrice": 153.4, "taxDefinitionId": b18, "expenseAccountId": None,
                   "itemId": item["id"], "purchaseOrderLineId": order["lines"][0]["id"]}]})
    call("POST", f"{c}/bills/{bill['id']}/post", token)
    order = call("GET", f"{c}/purchase-orders/{order['id']}", token)
    check(order["progress"] == "partly" and order["lines"][0]["billed"] == 3 and order["lines"][0]["remaining"] == 2,
          "billing 3 of 5 leaves the order partly billed with 2 to come")

    # ---- Receipt before the bill (GRNI) ----
    receipt_id = call("POST", f"{c}/purchase-orders/{order['id']}/receipt", token)
    receipt = call("POST", f"{c}/stock-documents/{receipt_id}/post", token)
    check(receipt["number"].startswith("FP-") and receipt["lines"][0]["quantity"] == 2,
          "the receipt takes only the 2 laptops the bill didn't already bring in")
    grni = call("GET", f"{c}/inventory/grni?asOf={today.isoformat()}", token)
    check(grni["difference"] == 0 and grni["openValue"] > 0, "open receipts tie to the 120800 balance")
    v = valuation()
    check(v["difference"] == 0, "stock still ties to the ledger after the receipt")

    # ---- Lots and expiry ----
    milk = call("POST", f"{c}/items", token, {"name": "Milk", "unit": "l", "type": GOODS, "defaultTaxDefinitionId": s18,
                                               "defaultUnitPrice": 1.2, "trackInventory": True, "trackLots": True})
    for lot, expiry, qty in (("M-2", (today + timedelta(days=60)).isoformat(), 10), ("M-1", (today + timedelta(days=5)).isoformat(), 10)):
        b = call("POST", f"{c}/bills", token, {
            "partnerId": vendor, "vendorReference": f"MILK-{lot}-{RUN}", "issueDate": today.isoformat(), "dueDate": today.isoformat(),
            "lines": [{"description": "Milk", "quantity": qty, "unitPrice": 0.59, "taxDefinitionId": b18, "expenseAccountId": None,
                       "itemId": milk["id"], "lotNumber": lot, "expiryDate": expiry}]})
        call("POST", f"{c}/bills/{b['id']}/post", token)
    inv = call("POST", f"{c}/invoices", token, {"partnerId": customer, "issueDate": today.isoformat(), "dueDate": today.isoformat(),
                                                 "lines": [{"description": "Milk", "quantity": 12, "unitPrice": 1.2, "taxDefinitionId": s18,
                                                            "revenueAccountId": None, "itemId": milk["id"]}]})
    call("POST", f"{c}/invoices/{inv['id']}/post", token)
    lots = {l["lotNumber"]: l["quantity"] for l in call("GET", f"{c}/inventory/lots?itemId={milk['id']}", token)}
    check(lots == {"M-2": 8}, f"selling 12 empties the lot expiring first and takes 2 from the next (got {lots})")
    soon = call("GET", f"{c}/inventory/lots?expiringBefore={(today + timedelta(days=30)).isoformat()}", token)
    check(all(l["itemId"] != milk["id"] for l in soon), "nothing of the milk left expires within 30 days")

    year_end = call("GET", f"{c}/inventory/year-end-check?year={today.year}", token)
    check(year_end["tracksStock"] and year_end["warehousesWithoutCount"] == ["Shop"],
          "year end names the warehouse that was never counted")

    print(f"\nAll {CHECKS} checks passed.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
