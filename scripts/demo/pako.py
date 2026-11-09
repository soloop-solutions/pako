"""Small client for building demo data through the PAKO API (standard library only).

Used by scripts/demo/build.py. Every call goes through the real endpoints, so the ledger, stock,
reports and dashboards agree with what the screens show.
"""

import json
import os
import random
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
PASSWORD = os.environ.get("PAKO_DEMO_PASSWORD", "Demo-Passw0rd!")
TODAY = date.today()
rng = random.Random(2611)

GOODS, SERVICE = 0, 1
SALE = 0
CASH, BANK, CARD, VOUCHER, GIFT, ON_ACCOUNT = 0, 1, 2, 3, 4, 5
TRAINING = 0
RETAIL, GROCERY, CAFE, RESTAURANT, SERVICES, FORECOURT, SELF_CHECKOUT = range(7)
OPENING, TRANSFER = 0, 1
CLIENT_ADMIN, CLIENT_VIEWER, CLIENT_STAFF = 2, 3, 4
FIRM_ADMIN, FIRM_ACCOUNTANT = 0, 1


class ApiError(Exception):
    pass


def log(message):
    print(message, flush=True)


_credentials = {}
_renewed = {}


def call(method, path, token=None, body=None, headers=None):
    original = token
    token = _renewed.get(token, token)
    try:
        return _send(method, path, token, body, headers)
    except ApiError as error:
        if token is None or token not in _credentials or " HTTP 401" not in str(error):
            raise
        email, password = _credentials[token]
        fresh = _send("POST", "/api/auth/login", body={"email": email, "password": password})["token"]
        _credentials[fresh] = (email, password)
        _renewed[original] = fresh
        return _send(method, path, fresh, body, headers)


def _send(method, path, token=None, body=None, headers=None):
    request_headers = {"Accept-Language": "en", "Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = response.read()
            if not payload:
                return None
            try:
                return json.loads(payload)
            except ValueError:
                return payload.decode()
    except urllib.error.HTTPError as error:
        raise ApiError(f"{method} {path}: HTTP {error.code} {error.read().decode(errors='replace')[:500]}") from None


def items_of(result):
    return result["items"] if isinstance(result, dict) and "items" in result else result


class User:
    """A signed-in account."""

    def __init__(self, email, password=PASSWORD, register=True):
        self.email = email
        self.password = password
        try:
            self.token = call("POST", "/api/auth/login", body={"email": email, "password": password})["token"]
        except ApiError:
            if not register:
                raise
            call("POST", "/api/auth/register", body={"email": email, "password": password})
            self.token = call("POST", "/api/auth/login", body={"email": email, "password": password})["token"]

        _credentials[self.token] = (email, password)

    def companies(self):
        return call("GET", "/api/companies", self.token)


class Company:
    """A company, worked on as one of its users."""

    def __init__(self, user, company):
        self.user = user
        self.id = company["id"]
        self.name = company["name"]
        self.c = f"/api/companies/{self.id}"
        self._acc = None
        self._tax = None

    # ---- HTTP ----
    def get(self, path):
        return call("GET", self.c + path, self.user.token)

    def post(self, path, body=None, headers=None):
        return call("POST", self.c + path, self.user.token, body if body is not None else {}, headers)

    def put(self, path, body):
        return call("PUT", self.c + path, self.user.token, body)

    @property
    def acc(self):
        if self._acc is None:
            self._acc = {a["code"]: a["id"] for a in items_of(self.get("/accounts"))}
        return self._acc

    @property
    def tax(self):
        if self._tax is None:
            self._tax = {t.get("code"): t["id"] for t in self.get("/taxes")}
        return self._tax

    # ---- Reference data ----
    def items(self):
        return {i["name"]: i for i in items_of(self.get("/items?pageSize=1000"))}

    def item(self, name, price=None, *, unit="copë", kind=GOODS, vat="S18", tracked=None, barcode=None, **extra):
        existing = self.items().get(name)
        if existing:
            return existing
        tracked = kind == GOODS if tracked is None else tracked
        created = self.post("/items", {
            "name": name, "unit": unit, "type": kind, "defaultTaxDefinitionId": self.tax[vat],
            "defaultRevenueAccountId": self.acc["400100"], "defaultExpenseAccountId": self.acc["500100"],
            "defaultInventoryAccountId": self.acc["120100"], "defaultUnitPrice": price,
            "trackInventory": tracked and kind == GOODS, **extra})
        if barcode:
            self.post(f"/items/{created['id']}/barcodes", {"barcode": barcode})
        return created

    def partners(self):
        return {p["name"]: p for p in items_of(self.get("/partners?pageSize=1000"))}

    def partner(self, name, *, customer=True, vendor=False, fiscal=None, **extra):
        existing = self.partners().get(name)
        if existing:
            return existing
        return self.post("/partners", {"name": name, "isCustomer": customer, "isVendor": vendor,
                                       "fiscalNumber": fiscal or f"81{rng.randint(1000000, 9999999)}", "paymentTermDays": 30, **extra})

    def main_warehouse(self):
        warehouses = self.get("/inventory/warehouses")
        return next(w for w in warehouses if w["isDefault"])["id"]

    def warehouse(self, code, name, **extra):
        existing = next((w for w in self.get("/inventory/warehouses") if w["code"] == code), None)
        return existing or self.post("/inventory/warehouses", {"code": code, "name": name, "address": None, **extra})

    # ---- Documents ----
    def bill(self, vendor_id, lines, on=None, warehouse_id=None, pay=True, **extra):
        # Before the months of invoices (accounting_months goes back three months).
        on = on or (TODAY.replace(day=1) - timedelta(days=95)).replace(day=1)
        created = self.post("/bills", {"partnerId": vendor_id, "vendorReference": f"F-{uuid.uuid4().hex[:6].upper()}",
                                       "issueDate": on.isoformat(), "dueDate": (on + timedelta(days=30)).isoformat(),
                                       "warehouseId": warehouse_id, "lines": lines, **extra})
        posted = self.post(f"/bills/{created['id']}/post")
        if pay:
            self.pay("bills", created["id"], self.total_of(posted), on + timedelta(days=rng.randint(3, 15)))
        return posted

    def buy(self, vendor_id, goods, warehouse_id=None, on=None, pay=True):
        """goods: (item, quantity, gross unit cost[, purchase VAT code]) — brings stock in on a bill."""
        lines = [{"description": i["name"], "quantity": q, "unitPrice": cost, "taxDefinitionId": self.tax[g[0] if g else "B18"],
                  "expenseAccountId": None, "itemId": i["id"]} for i, q, cost, *g in goods]
        return self.bill(vendor_id, lines, on, warehouse_id, pay)

    def expense(self, vendor_id, description, amount, account_code, on, pay=True):
        return self.bill(vendor_id, [{"description": description, "quantity": 1, "unitPrice": round(amount, 2),
                                      "taxDefinitionId": self.tax["B18"], "expenseAccountId": self.acc[account_code]}], on, pay=pay)

    def invoice(self, customer_id, lines, on, pay_after=None, warehouse_id=None, **extra):
        created = self.post("/invoices", {"partnerId": customer_id, "issueDate": on.isoformat(), "dueDate": (on + timedelta(days=30)).isoformat(),
                                          "warehouseId": warehouse_id, "lines": lines, **extra})
        posted = self.post(f"/invoices/{created['id']}/post")
        if pay_after is not None and on + timedelta(days=pay_after) <= TODAY:
            self.pay("invoices", created["id"], self.total_of(posted), on + timedelta(days=pay_after))
        return posted

    def sell_line(self, item, quantity, price=None):
        return {"description": item["name"], "quantity": quantity, "unitPrice": price if price is not None else item["defaultUnitPrice"],
                "taxDefinitionId": item.get("defaultTaxDefinitionId"), "revenueAccountId": None, "itemId": item["id"]}

    @staticmethod
    def total_of(document):
        """A VAT-inclusive document's total, from its lines."""
        return round(sum(round(l["quantity"] * l["unitPrice"] * (1 - (l.get("discountPercent") or 0) / 100), 2) for l in document["lines"]), 2)

    def pay(self, kind, doc_id, amount, on):
        if on > TODAY or amount <= 0:
            return
        bank = self.acc.get("101003") or next(v for k, v in self.acc.items() if k.startswith("101"))
        self.post(f"/{kind}/{doc_id}/record-payment", {"amount": round(amount, 2), "cashOrBankAccountId": bank, "date": on.isoformat()})

    def journal_entry(self, on, reference, lines):
        general = next(j for j in self.get("/journals") if j["code"] == "GEN")["id"]
        token = call("POST", "/api/auth/action-tokens", self.user.token,
                     {"password": self.user.password, "action": "create-journal-entry", "companyId": self.id})["token"]
        entry = self.post("/journal-entries", {"journalId": general, "date": on.isoformat(), "reference": reference, "remarks": reference,
                                               "lines": lines}, headers={"X-Action-Token": token})
        return self.post(f"/journal-entries/{entry['id']}/post")

    # ---- People ----
    def roles(self):
        return {r.get("builtInKey") or r["name"]: r for r in self.get("/admin/roles")}

    def role(self, name, levels, description=None, partner_scope=0):
        existing = {r["name"]: r for r in self.get("/admin/roles")}.get(name)
        if existing:
            return existing
        full = {k: 0 for k in ("sales", "purchases", "partners", "accounting", "reports", "hr", "items", "payroll", "settings", "users",
                               "inventory", "pos")}
        full.update(levels)
        return self.post("/admin/roles", {"name": name, "description": description, "levels": full, "partnerScope": partner_scope})

    def invite(self, email, name, *, role_id=None, administrator=False, employee_id=None):
        """Invites a member and accepts the invitation as them (password: the demo password)."""
        users = {u["email"]: u for u in self.get("/admin/users")}
        if email in users:
            return users[email]
        created = self.post("/admin/invitations", {"email": email, "fullName": name, "administrator": administrator, "roleId": role_id,
                                                   "employeeId": employee_id})
        token = urllib.parse.parse_qs(urllib.parse.urlparse(created["inviteUrl"]).query)["token"][0]
        call("POST", "/api/auth/invitations/accept", body={"token": token, "fullName": name, "password": PASSWORD})
        return created["user"]

    def add_member(self, email, role):
        call("POST", f"{self.c}/members", self.user.token, {"email": email, "role": role})

    def department(self, code, name):
        existing = {d["code"]: d for d in self.get("/departments")}.get(code)
        if existing:
            return existing["id"]
        none = {k: 0 for k in ("sales", "purchases", "partners", "accounting", "reports", "hr")}
        return self.post("/departments", {"code": code, "name": name, "parentId": None, "managerEmployeeId": None, "costCenterId": None,
                                          "permissions": none, "partnerScope": 0, "isActive": True})["id"]

    def employee(self, first, last, title, department_id, salary, hired, email=None, personal=None):
        existing = next((e for e in items_of(self.get("/employees?pageSize=500")) if e["firstName"] == first and e["lastName"] == last), None)
        if existing:
            return existing
        return self.post("/employees", {
            "firstName": first, "lastName": last, "personalNumber": personal or f"1{rng.randint(100000000, 999999999)}",
            "email": email or f"{first.lower()}.{last.lower()}@demo.pako.test".replace("ë", "e").replace("ç", "c"),
            "hireDate": hired.isoformat(), "jobTitle": title, "departmentId": department_id, "monthlyGrossSalary": salary,
            "isPrimaryEmployer": True, "pensionExempt": False, "isActive": True})

    def payroll(self, month_start):
        end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        run = self.post("/payroll-runs", {"periodStart": month_start.isoformat(), "periodEnd": end.isoformat()})
        self.post(f"/payroll-runs/{run['id']}/approve")
        self.post(f"/payroll-runs/{run['id']}/post")
        bank = self.acc.get("101003") or next(v for k, v in self.acc.items() if k.startswith("101"))
        self.post(f"/payroll-runs/{run['id']}/pay", {"paidOn": (end + timedelta(days=5)).isoformat(), "cashOrBankAccountId": bank})

    # ---- POS ----
    def store(self, code, name, branch, location, warehouse_id, **extra):
        existing = next((s for s in self.get("/pos/stores") if s["code"] == code), None)
        return existing or self.post("/pos/stores", {"code": code, "name": name, "address": extra.pop("address", None), "fiscalBranchNumber": branch,
                                                     "location": location, "warehouseId": warehouse_id, **extra})

    def register(self, store_id, code, name, profile, pos_no):
        existing = next((r for r in self.get("/pos/registers") if r["code"] == code), None)
        return existing or self.post("/pos/registers", {"storeId": store_id, "code": code, "name": name, "profile": profile,
                                                        "fiscalMode": TRAINING, "fiscalPosNumber": pos_no, "cashAccountId": self.acc["100100"]})

    def payment_method(self, kind, name, account_code):
        existing = next((m for m in self.get("/payment-methods") if m["kind"] == kind), None)
        return existing or self.post("/payment-methods", {"name": name, "kind": kind, "ledgerAccountId": self.acc[account_code]})


class Till:
    """A register's open session (opened if needed), selling through quote + order."""

    def __init__(self, company, code, opening_float=100):
        self.co = company
        reg = next(r for r in company.get("/pos/registers") if r["code"] == code)
        self.r = f"/pos/registers/{reg['id']}"
        boot = company.get(f"{self.r}/bootstrap")
        self.session = boot["session"] or company.post(f"{self.r}/sessions", {"openingFloat": opening_float})
        self.tender = {}
        for t in boot["tenders"]:
            self.tender.setdefault(t["kind"], t["id"])
        self.store_id = reg["storeId"]
        self.catalog = {i["name"]: i for i in company.get(f"{self.r}/catalog")}

    def line(self, name, quantity=1, **extra):
        it = self.catalog[name]
        return {"itemId": it["id"], "description": it["name"], "quantity": quantity, "unitPrice": it["price"] or 0,
                "taxDefinitionId": it["taxDefinitionId"], **extra}

    def quote(self, lines, **extra):
        return self.co.post(f"{self.r}/quote", {"lines": lines, **extra})

    def sell(self, lines, payments=None, kind=CASH, **extra):
        quote_keys = ("couponCodes", "loyaltyCardNumber", "tabId", "prescriptionId", "fleetCardNumber", "channelOrderId")
        total = self.quote(lines, **{k: v for k, v in extra.items() if k in quote_keys})["total"]
        if payments is None:
            payments = [{"paymentMethodId": self.tender[kind], "amount": total}] if total else []
        return self.co.post("/pos/orders", {"clientUuid": str(uuid.uuid4()), "sessionId": self.session["id"], "kind": SALE,
                                            "orderedAt": datetime.now(timezone.utc).isoformat(), "lines": lines, "payments": payments, **extra})

    def close(self):
        report = self.co.get(f"/pos/sessions/{self.session['id']}/report")
        counted = [{"paymentMethodId": t["paymentMethodId"], "counted": t["expected"]} for t in report["tenders"]]
        return self.co.post(f"/pos/sessions/{self.session['id']}/close", {"counted": counted})


def local_utc(day, hour, minute=0):
    """A Kosovo wall-clock time as UTC (CET/CEST)."""
    offset = 2 if 3 < day.month < 11 else 1
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc) - timedelta(hours=offset)


def months_back(n):
    """The first days of the last n complete months, oldest first."""
    first = TODAY.replace(day=1)
    out = []
    for _ in range(n):
        first = (first - timedelta(days=1)).replace(day=1)
        out.append(first)
    return list(reversed(out))
