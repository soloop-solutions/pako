#!/usr/bin/env python3
"""Point-of-sale end-to-end check against a running API (docs/POS_PLAN.md P1).

A fresh user and company each run, so it is safe to repeat against a dev database. Covers:
  - a store and a training register; one open session per register;
  - the till's bootstrap, catalogue (barcode) and the server quote with change;
  - a split cash + card sale, resent with the same ClientUuid (recorded once);
  - the B2C cash limit; a return priced as sold; a cancellation of a whole coupon;
  - a cash paid-out, the X report, closing with a counted shortage and its reason;
  - the session's journal entry (balanced, VAT and cash over/short) and stock moved by the till.
Standard library only.

    python3 scripts/e2e/pos.py                    # API at http://127.0.0.1:5248
    PAKO_API=http://host:port python3 scripts/e2e/pos.py

Exits non-zero on the first failed check.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
RUN = uuid.uuid4().hex[:8]
PASSWORD = "E2e-Passw0rd!"
CHECKS = 0

# Enums travel as numbers (no string enum converter in Pako.Api).
GOODS = 0
OPENING = 0
RETAIL, TRAINING = 0, 0
SALE, RETURN, CANCEL = 0, 1, 2
PAID, CANCELLED = 0, 1
FISCAL_TRAINING, NOT_SENT = 9, 0
OPEN, POSTED = 0, 2
PAID_OUT = 4
CASH, CARD = 0, 2


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status


def call(method, path, token=None, body=None):
    headers = {"Accept-Language": "en", "Content-Type": "application/json"}
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
    now = datetime.now(timezone.utc).isoformat()
    print(f"PAKO POS e2e against {API} (run {RUN})")

    email = f"pos.{RUN}@e2e.test"
    call("POST", "/api/auth/register", body={"email": email, "password": PASSWORD})
    token = call("POST", "/api/auth/login", body={"email": email, "password": PASSWORD})["token"]
    company = call("POST", "/api/companies", token, {"name": f"E2E POS {RUN}", "enabledProfiles": 1})
    c = f"/api/companies/{company['id']}"
    accounts = call("GET", f"{c}/accounts", token)
    accounts = accounts["items"] if isinstance(accounts, dict) else accounts
    acc = {a["code"]: a["id"] for a in accounts}
    code_of = {a["id"]: a["code"] for a in accounts}
    taxes = {t.get("code"): t["id"] for t in call("GET", f"{c}/taxes", token)}
    s18 = taxes["S18"]

    # ---- Setup: a laptop with a barcode, 10 in stock at 100 ----
    warehouse = call("GET", f"{c}/inventory/warehouses", token)[0]["id"]
    item = call("POST", f"{c}/items", token, {
        "name": "Laptop", "unit": "copë", "type": GOODS, "defaultTaxDefinitionId": s18, "defaultUnitPrice": 236,
        "trackInventory": True,
        # Items carry their revenue, expense and stock accounts (required since main's item rules).
        "defaultRevenueAccountId": acc["400100"], "defaultExpenseAccountId": acc["500100"], "defaultInventoryAccountId": acc["120100"]})
    call("POST", f"{c}/items/{item['id']}/barcodes", token, {"barcode": f"38{RUN}"})
    opening = call("POST", f"{c}/stock-documents", token, {"warehouseId": warehouse, "type": OPENING,
        "date": (today - timedelta(days=1)).isoformat(), "lines": [{"itemId": item["id"], "quantity": 10, "unitCost": 100}]})
    call("POST", f"{c}/stock-documents/{opening['id']}/post", token)

    store = call("POST", f"{c}/pos/stores", token, {"code": "PR1", "name": "Prishtina 1", "address": "Rr. Agim Ramadani",
        "fiscalBranchNumber": 1, "location": "Prishtinë", "warehouseId": warehouse, "receiptFooter": "Faleminderit!"})
    register = call("POST", f"{c}/pos/registers", token, {"storeId": store["id"], "code": "K1", "name": "Arka 1",
        "profile": RETAIL, "fiscalMode": TRAINING, "fiscalPosNumber": 1, "cashAccountId": acc["100100"]})
    r = f"{c}/pos/registers/{register['id']}"
    check(register["openSessionId"] is None, "a new training register has no session")

    boot = call("GET", f"{r}/bootstrap", token)
    tender = {t["kind"]: t["id"] for t in boot["tenders"]}
    check(CASH in tender and CARD in tender, "the till offers cash and the card tender seeded for POS")
    catalog = call("GET", f"{r}/catalog", token)
    laptop = next((i for i in catalog if f"38{RUN}" in i["barcodes"]), None)
    check(laptop is not None and laptop["price"] == 236 and laptop["taxLetter"] == "E",
          "the catalogue finds the laptop by barcode at 236, VAT letter E")

    session = call("POST", f"{r}/sessions", token, {"openingFloat": 150})
    check(session["state"] == OPEN, "a session opens with a float of 150")
    expect_status(400, lambda: call("POST", f"{r}/sessions", token, {"openingFloat": 0}), "a second open session is refused")

    def line(qty, discount=0):
        return {"itemId": item["id"], "description": "Laptop", "quantity": qty, "unitPrice": 236,
                "taxDefinitionId": None, "discountAmount": discount}

    def order(kind, lines, payments, **extra):
        return call("POST", f"{c}/pos/orders", token, {"clientUuid": extra.pop("uuid", str(uuid.uuid4())), "sessionId": session["id"],
            "kind": kind, "orderedAt": now, "lines": lines, "payments": payments, **extra})

    # ---- Quote and sale ----
    quote = call("POST", f"{r}/quote", token, {"lines": [line(2)],
        "payments": [{"paymentMethodId": tender[CASH], "amount": 172, "tendered": 200}, {"paymentMethodId": tender[CARD], "amount": 300}]})
    check(quote["total"] == 472 and quote["totalTax"] == 72 and quote["remaining"] == 0 and quote["change"] == 28,
          "the server quotes 2 laptops at 472 (VAT 72) and 28 change from 200 cash + 300 card")

    sale_uuid = str(uuid.uuid4())
    payments = [{"paymentMethodId": tender[CASH], "amount": 172, "tendered": 200}, {"paymentMethodId": tender[CARD], "amount": 300}]
    sale = order(SALE, [line(2)], payments, uuid=sale_uuid)
    check(sale["total"] == 472 and sale["change"] == 28 and sale["fiscal"]["type"] == FISCAL_TRAINING
          and sale["fiscal"]["atkStatus"] == NOT_SENT and "|" in sale["fiscal"]["qrCode"],
          "the sale records with a training coupon and its QR")
    check(sale["taxes"] == [{"taxLetter": "E", "taxRate": 0.18, "gross": 472, "net": 400, "tax": 72}], "the coupon carries VAT per letter")
    again = order(SALE, [line(2)], payments, uuid=sale_uuid)
    check(again["id"] == sale["id"], "resending the same order (lost answer) returns the first one")
    orders = call("GET", f"{c}/pos/orders?sessionId={session['id']}", token)
    check(orders["total"] == 1, "and records it once")

    expect_status(400, lambda: order(SALE, [line(1)], [{"paymentMethodId": tender[CASH], "amount": 200}]),
                  "payments short of the total are refused")
    expect_status(400, lambda: order(SALE, [line(9)], [{"paymentMethodId": tender[CASH], "amount": 2124}]),
                  "cash above 2,000 from an individual is refused")

    # ---- A second sale with a discount, then its return and a cancellation ----
    discounted = order(SALE, [line(3, 10)], [{"paymentMethodId": tender[CARD], "amount": 698}])
    check(discounted["total"] == 698 and discounted["totalDiscount"] == 10, "3 laptops less 10 discount sell for 698")
    back = call("POST", f"{r}/quote", token, {"originalOrderId": discounted["id"],
        "lines": [{**line(1), "unitPrice": 0, "originalLineId": discounted["lines"][0]["id"]}]})
    check(back["total"] == 232.67, "one of them comes back at 232.67, its share of the discount off")
    ret = order(RETURN, [{**line(1), "originalLineId": discounted["lines"][0]["id"]}],
                [{"paymentMethodId": tender[CARD], "amount": 232.67}], originalOrderId=discounted["id"], reason="Defekt")
    check(ret["fiscal"]["referenceCouponId"] == discounted["fiscal"]["couponId"], "the return coupon refers to the sale's coupon")
    expect_status(400, lambda: order(RETURN, [{**line(3), "originalLineId": discounted["lines"][0]["id"]}],
                                     [{"paymentMethodId": tender[CARD], "amount": 698}], originalOrderId=discounted["id"], reason="x"),
                  "returning more than is left is refused")
    expect_status(400, lambda: order(CANCEL, [], [{"paymentMethodId": tender[CARD], "amount": 698}],
                                     originalOrderId=discounted["id"], reason="x"),
                  "a coupon already partly returned can't be cancelled")

    single = order(SALE, [line(1)], [{"paymentMethodId": tender[CASH], "amount": 236}])
    cancel = order(CANCEL, [], [{"paymentMethodId": tender[CASH], "amount": 236}], originalOrderId=single["id"], reason="Gabim")
    check(cancel["kind"] == CANCEL and cancel["total"] == 236, "a whole coupon is cancelled with no lines sent")
    check(call("GET", f"{c}/pos/orders/{single['id']}", token)["state"] == CANCELLED, "the cancelled sale shows as cancelled")
    on_hand = call("GET", f"{c}/inventory/on-hand?itemIds={item['id']}", token)[0]["quantity"]
    check(on_hand == 10 - 2 - 3 + 1, f"stock follows the till: 10 − 2 − 3 + 1 = {on_hand}")

    # ---- Cash out, X report, close ----
    call("POST", f"{c}/pos/sessions/{session['id']}/cash-movements", token,
         {"kind": PAID_OUT, "amount": 20, "reason": "Pastrim", "counterpartAccountId": acc["660300"]})
    x = call("GET", f"{c}/pos/sessions/{session['id']}/report", token)
    # 150 float + 172 cash + 236 − 236 − 20.
    check(x["cashExpected"] == 302 and x["sales"] == 3 and x["returns"] == 1 and x["cancellations"] == 1,
          "the X report expects 302 in the drawer after 3 sales, 1 return, 1 cancellation")
    tenders = {t["paymentMethodId"]: t["expected"] for t in x["tenders"]}
    check(tenders[tender[CARD]] == 300 + 698 - 232.67, "and 765.33 on the card terminal")

    def counted(cash, reason=None):
        return {"counted": [{"paymentMethodId": tender[CASH], "counted": cash, "differenceReason": reason},
                            {"paymentMethodId": tender[CARD], "counted": tenders[tender[CARD]]}]}

    expect_status(400, lambda: call("POST", f"{c}/pos/sessions/{session['id']}/close", token, counted(301)),
                  "closing 1 short without a reason is refused")
    z = call("POST", f"{c}/pos/sessions/{session['id']}/close", token, counted(301, "Kusur"))
    check(z["state"] == POSTED and z["journalEntryId"], "closing with a reason posts the session")
    cash_row = next(t for t in z["tenders"] if t["paymentMethodId"] == tender[CASH])
    check(cash_row["difference"] == -1, "the Z report shows the drawer 1 short")

    entries = call("GET", f"{c}/journal-entries", token)
    entries = entries["items"] if isinstance(entries, dict) else entries
    entry = next(e for e in entries if e["id"] == z["journalEntryId"])
    debit = round(sum(l["debit"] for l in entry["lines"]), 2)
    credit = round(sum(l["credit"] for l in entry["lines"]), 2)
    check(debit == credit, f"the session entry balances ({debit})")
    net = {}
    for l in entry["lines"]:
        code = code_of[l["accountId"]]
        net[code] = round(net.get(code, 0) + l["debit"] - l["credit"], 2)
    # Revenue: 400 + 591.53 − 197.18 (the return's net); the cancelled coupon nets to nothing.
    check(net.get("400100") == -794.35, f"revenue 794.35 net of the return ({net.get('400100')})")
    check(net.get("100900") == 1, "the shortage goes to cash over/short")
    check(net.get("660300") == 20, "the paid-out is booked to its expense")
    check(net.get("500100") == 400, "cost of goods sold: 4 laptops at 100")

    registers = call("GET", f"{c}/pos/registers", token)
    check(registers[0]["openSessionId"] is None, "the register is free for the next session")
    expect_status(400, lambda: order(SALE, [line(1)], [{"paymentMethodId": tender[CASH], "amount": 236}]),
                  "a closed session takes no new sale")

    print(f"\nAll {CHECKS} checks passed.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
