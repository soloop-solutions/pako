#!/usr/bin/env python3
"""Build the demo data set: one company per business type, with users in every role.

Runs against an EMPTY database through the API (see build_demo_db.sh, which also dumps the result
to backend/seed/). Writes docs/DEMO_ACCOUNTS.md from what the API reports at the end.

    PAKO_API=http://127.0.0.1:5399 python3 scripts/demo/build.py

Every demo login uses the password in pako.PASSWORD.
"""

import os
import subprocess
import sys
import traceback
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from pako import (API, CARD, CASH, CLIENT_ADMIN, CLIENT_VIEWER, FIRM_ACCOUNTANT, FORECOURT, GIFT, GOODS, GROCERY, ON_ACCOUNT, PASSWORD,  # noqa: E402
                  RESTAURANT, RETAIL, SELF_CHECKOUT, SERVICE, SERVICES, TODAY, TRANSFER, ApiError, Company, Till, User, call, items_of,
                  local_utc, log, months_back, rng)

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLATFORM_ADMIN = ("test@test.com", "Test123!")

# Business types (BusinessType enum).
GENERAL, MARKET, RESTAURANT_T, HOTEL, SERVICES_T, PHARMACY, FUEL, WHOLESALE, CONSTRUCTION, REAL_ESTATE, AUTO_PARTS = range(11)
TYPE_NAMES = ["General", "Market", "Restaurant", "Hotel", "Services", "Pharmacy", "FuelStation", "Wholesale", "Construction",
              "RealEstate", "AutoParts"]

# Role levels: 0 none, 1 read, 2 write, 3 approve.
R, W, A = 1, 2, 3

RUN = {"users": [], "companies": [], "failed": []}


def remember_user(email, company, access, note=""):
    RUN["users"].append({"email": email, "company": company, "access": access, "note": note})


# ---- Shared setup ----

def create_company(owner, name, business_type, *, firm=None, firm_admin=None, profile=None):
    existing = next((c for c in owner.companies() if c["name"] == name), None)
    if existing:
        return Company(owner, existing), False
    if firm is not None:
        created = call("POST", "/api/companies", firm_admin.token, {"name": name, "firmId": firm, "enabledProfiles": 17, "businessType": business_type})
        Company(firm_admin, created).add_member(owner.email, CLIENT_ADMIN)
    else:
        created = call("POST", "/api/companies", owner.token, {"name": name, "enabledProfiles": 17, "businessType": business_type})
    co = Company(owner, created)
    if profile:
        call("PUT", f"/api/companies/{co.id}/profile", owner.token, profile)
    remember_user(owner.email, name, "Administrator (owner)", "Full access, manages users and settings")
    return co, True


def bank_account(co, bank, iban):
    if not call("GET", f"{co.c}/bank-accounts", co.user.token):
        co.post("/bank-accounts", {"bankName": bank, "accountHolder": co.name, "iban": iban, "isDefault": True})


def opening_capital(co, amount):
    capital = next(a["id"] for a in items_of(co.get("/accounts")) if a["code"].startswith("30") and "capital" in a["name"].lower())
    bank = co.acc.get("101003") or next(v for k, v in co.acc.items() if k.startswith("101"))
    start = months_back(3)[0]
    co.journal_entry(start, "Kapitali fillestar", [
        {"accountId": bank, "partnerId": None, "debit": amount, "credit": 0, "description": "Kapitali fillestar"},
        {"accountId": capital, "partnerId": None, "debit": 0, "credit": amount, "description": "Kapitali fillestar"}])


def staff(co, people):
    """people: (first, last, title, department, salary, email or None, role name or 'admin'/'viewer' or None)."""
    depts = {}
    for first, last, title, dept, salary, email, role in people:
        if dept not in depts:
            depts[dept] = co.department(dept[:6].upper().replace(" ", ""), dept)
        employee = co.employee(first, last, title, depts[dept], salary, months_back(6)[0])
        if not email:
            continue
        name = f"{first} {last}"
        if role == "admin":
            co.invite(email, name, administrator=True, employee_id=employee["id"])
            remember_user(email, co.name, "Administrator", title)
        elif role == "viewer":
            User(email)
            co.add_member(email, CLIENT_VIEWER)
            remember_user(email, co.name, "Read-only member (viewer)", title)
        else:
            found = co.roles().get(role)
            co.invite(email, name, role_id=found["id"] if found else None, employee_id=employee["id"])
            remember_user(email, co.name, f"Staff — role “{found['name'] if found else 'Employee'}”", title)


def roles(co, custom):
    co.roles()  # creates the built-in roles on first use
    for name, levels, description in custom:
        co.role(name, levels, description)


def accounting_months(co, customers, vendor_costs, sales_lines, months=3, warehouse_id=None):
    """A few months of B2B invoices (most paid) and running costs."""
    vendors = {name: co.partner(name, customer=False, vendor=True)["id"] for name, *_ in vendor_costs}
    for m in months_back(months):
        for name, description, amount, account in vendor_costs:
            co.expense(vendors[name], description, amount * rng.uniform(0.9, 1.1), account, m.replace(day=min(5 + len(name) % 10, 28)))
        for customer in customers:
            lines = sales_lines(m)
            if lines:
                co.invoice(customer["id"], lines, m.replace(day=rng.randint(6, 26)), pay_after=rng.choice([12, 20, 35, 70]), warehouse_id=warehouse_id)


def payroll(co, months=2):
    for m in months_back(months):
        try:
            co.payroll(m)
        except ApiError as e:
            log(f"    payroll {m:%m/%Y} skipped: {str(e)[:120]}")


def till_day(co, code, sales, close=True):
    """One till session with sales; closed (and posted) unless asked to stay open."""
    till = Till(co, code)
    for lines, kind, extra in sales:
        till.sell(lines(till) if callable(lines) else lines, kind=kind, **extra)
    if close:
        till.close()
    return till


# ---- Companies ----

def general_showcase():
    """'Pako Demo Sh.p.k.': every module and pack, ~22 months of history (the existing seed scripts)."""
    env = dict(os.environ, PAKO_API=API)
    for script in ["seed_demo.py", "seed_pos_demo.py", "seed_verticals_demo.py", "seed_activity_demo.py"]:
        result = subprocess.run([sys.executable, os.path.join(REPO, "scripts", script)], env=env, capture_output=True, text=True)
        log("    " + "\n    ".join((result.stdout or "").strip().splitlines()[-3:]))
        if result.returncode not in (0, 1):
            raise ApiError(f"{script} exited {result.returncode}: {result.stderr[-400:]}")
    remember_user("demo.admin@pako.test", "Pako Demo Sh.p.k.", "Administrator (owner)", "Showcase company with every module and pack")


def market(_firm=None):
    owner = User("market.owner@pako.test")
    co, new = create_company(owner, "Supermarket Dardania Sh.p.k.", MARKET, profile={
        "tradingName": "Supermarket Dardania", "fiscalNumber": "811500101", "businessNumber": "810500101", "municipality": "Prishtinë",
        "streetAddress": "Rr. Bill Clinton 22", "phone": "+383 38 600 101", "email": "info@dardania.test", "businessActivity": "4711 — Shitje me pakicë në dyqane"})
    if not new:
        return "already there"
    bank_account(co, "ProCredit Bank", "XK051111000000010101")
    roles(co, [("Menaxher dyqani", {"sales": W, "partners": W, "items": W, "inventory": A, "pos": A, "reports": R, "purchases": W},
                "Manages the shop: prices, stock, the tills' refunds and closings.")])
    staff(co, [
        ("Valon", "Berisha", "Menaxher dyqani", "Shitja", 900, "market.manager@pako.test", "Menaxher dyqani"),
        ("Drita", "Morina", "Arkëtare", "Shitja", 520, "market.cashier@pako.test", "cashier"),
        ("Blerim", "Gashi", "Arkëtar", "Shitja", 520, None, None),
        ("Arta", "Kelmendi", "Kontabiliste", "Administrata", 800, "market.accountant@pako.test", "accountant"),
        ("Fatmir", "Hoxha", "Magazinier", "Magazina", 560, "market.stock@pako.test", "purchasing"),
        ("Liridona", "Krasniqi", "Punonjëse", "Shitja", 500, "market.employee@pako.test", "employee"),
    ])
    User("market.viewer@pako.test"); co.add_member("market.viewer@pako.test", CLIENT_VIEWER)
    remember_user("market.viewer@pako.test", co.name, "Read-only member (viewer)", "Owner's partner: sees everything, changes nothing")
    opening_capital(co, 30000)
    vendor = co.partner("Viva Fresh Distribution", customer=False, vendor=True)
    bottle = co.item("Shishe kthyese (depozitë)", 0.10, vat="SEX", tracked=False)
    goods = [
        ("Bukë e bardhë 500 g", 0.50, "copë", "S08", None, {}), ("Qumësht Vita 1 L", 0.95, "copë", "S08", "3830001020022", {}),
        ("Kos Vita 500 g", 0.85, "copë", "S08", "3830001020039", {"trackLots": True}),
        ("Banane", 1.29, "kg", "S08", None, {"plu": "4011", "sellByWeight": True}),
        ("Mollë Golden", 0.99, "kg", "S08", None, {"plu": "4021", "sellByWeight": True}),
        ("Birrë Peja 0,5 L", 0.90, "copë", "S18", "3830001020015", {"minimumAge": 18, "depositItemId": bottle["id"]}),
        ("Ujë Rugova 1,5 L", 0.45, "copë", "S18", "3830001020046", {}), ("Vaj luledielli 1 L", 2.20, "copë", "S08", "3830001020053", {}),
        ("Vezë (10 copë)", 1.80, "pako", "S08", "3830001020060", {}), ("Kafe Doncafe 200 g", 3.40, "copë", "S18", "3830001020077", {}),
        ("Detergjent Ariel 2 kg", 8.90, "copë", "S18", "8001090000016", {}), ("Cigare Marlboro", 3.50, "pako", "S18", "4011000000010", {"minimumAge": 18}),
    ]
    items = {n: co.item(n, p, unit=u, vat=v, barcode=b, **x) for n, p, u, v, b, x in goods}
    main = co.main_warehouse()
    co.buy(vendor["id"], [(items[n], q, round(items[n]["defaultUnitPrice"] * 0.62, 2), "B08" if v == "S08" else "B18")
                          for (n, _, _, v, _, x), q in zip(goods, [300, 400, 200, 250, 200, 480, 600, 150, 200, 80, 40, 120]) if not x.get("trackLots")],
           main)
    co.bill(vendor["id"], [{"description": "Kos", "quantity": 150, "unitPrice": 0.48, "taxDefinitionId": co.tax["B08"], "expenseAccountId": None,
                            "itemId": items["Kos Vita 500 g"]["id"], "lotNumber": f"K{TODAY:%m%d}", "expiryDate": (TODAY + timedelta(days=14)).isoformat()}],
            warehouse_id=main)
    store = co.store("DR1", "Supermarket Dardania — Qendra", 1, "Prishtinë", main, address="Rr. Bill Clinton 22",
                     receiptFooter="Faleminderit! Kthimet brenda 7 ditëve me kupon.")
    co.register(store["id"], "DR-K1", "Arka 1", GROCERY, 1)
    co.register(store["id"], "DR-K2", "Arka 2", GROCERY, 2)
    co.register(store["id"], "DR-SC", "Arkë vetëshërbyese", SELF_CHECKOUT, 3)
    co.payment_method(GIFT, "Kartë dhuratë", "240300")
    co.post("/pos/programs", {"name": "Fundjavë −10% në fruta", "kind": 0, "reward": 0, "percent": 10, "days": 96,
                              "itemIds": [items["Banane"]["id"], items["Mollë Golden"]["id"]]})
    co.post("/pos/programs", {"name": "Pikë besnikërie Dardania", "kind": 2, "reward": 0, "pointsPerEuro": 1, "pointValue": 0.01})
    customer = co.partner("Blerta Hasani", fiscal="1234560001")
    co.post("/pos/loyalty-cards", {"number": "DRD-0001", "holderName": "Blerta Hasani", "phone": "+38344111000", "partnerId": customer["id"]})

    def basket(t):
        return [t.line("Bukë e bardhë 500 g", rng.randint(1, 3)), t.line("Qumësht Vita 1 L", rng.randint(1, 2)),
                t.line("Banane", round(rng.uniform(0.6, 2.2), 3)), t.line("Ujë Rugova 1,5 L", rng.randint(2, 6))]
    till_day(co, "DR-K1", [(basket, CASH, {}) for _ in range(12)] + [(basket, CARD, {"loyaltyCardNumber": "DRD-0001"}) for _ in range(4)]
             + [(lambda t: [t.line("Birrë Peja 0,5 L", 6, ageVerified=True), t.line("Shishe kthyese (depozitë)", 6)], CASH, {})])
    till_day(co, "DR-K2", [(basket, CARD, {}) for _ in range(5)], close=False)
    payroll(co)
    accounting_months(co, [co.partner("Hotel Prishtina Plaza (furnizim)", fiscal="811600201")],
                      [("Qiraja Sh.p.k.", "Qiraja e dyqanit", 2200, "610100"), ("KEDS Energji", "Energjia elektrike", 650, "610200"),
                       ("IPKO Telecom", "Internet", 45, "660500")],
                      lambda m: [co.sell_line(items["Ujë Rugova 1,5 L"], 120), co.sell_line(items["Kafe Doncafe 200 g"], 20)])
    return "groceries with PLUs, deposits and lots; 2 tills + self-checkout; promotion and loyalty; a closed and an open session"


def restaurant():
    owner = User("restaurant.owner@pako.test")
    co, new = create_company(owner, "Restorant Te Ura Sh.p.k.", RESTAURANT_T, profile={
        "tradingName": "Restorant Te Ura", "fiscalNumber": "811500202", "municipality": "Prizren", "streetAddress": "Rr. Shadërvani 3",
        "phone": "+383 29 600 202", "businessActivity": "5610 — Restorante"})
    if not new:
        return "already there"
    bank_account(co, "Raiffeisen Bank Kosovo", "XK051501000000020202")
    roles(co, [("Kamarier", {"pos": W, "items": R}, "Takes orders on tables and takes payment; voids need a manager."),
               ("Shef salle", {"pos": A, "items": W, "inventory": W, "reports": R, "sales": W},
                "Runs the floor: voids, discounts, closing the tills, the menu.")])
    staff(co, [
        ("Agim", "Shala", "Shef salle", "Salla", 850, "restaurant.manager@pako.test", "Shef salle"),
        ("Leutrim", "Bytyqi", "Kamarier", "Salla", 480, "restaurant.waiter@pako.test", "Kamarier"),
        ("Edona", "Rexhepi", "Kamariere", "Salla", 480, "restaurant.waiter2@pako.test", "Kamarier"),
        ("Burim", "Zeka", "Kuzhinier", "Kuzhina", 700, None, None),
        ("Vjosa", "Thaçi", "Kontabiliste", "Administrata", 750, "restaurant.accountant@pako.test", "accountant"),
    ])
    opening_capital(co, 20000)
    main = co.main_warehouse()
    store = co.store("TU1", "Te Ura", 1, "Prizren", main, receiptFooter="Faleminderit! Ju presim sërish.")
    kitchen = co.post("/pos/production-centers", {"name": "Kuzhina", "kind": 0, "storeId": store["id"]})
    bar = co.post("/pos/production-centers", {"name": "Bari", "kind": 1, "storeId": store["id"]})
    grill = co.post("/pos/production-centers", {"name": "Skara", "kind": 2, "storeId": store["id"]})
    menu = {}
    for name, price, center in [("Espresso", 1.00, bar), ("Makiato", 1.20, bar), ("Çaj", 1.00, bar), ("Coca-Cola 0,33 L", 1.50, bar),
                                ("Birrë Peja 0,33 L", 1.80, bar), ("Verë e kuqe Stone Castle (gotë)", 3.00, bar),
                                ("Qebapa (10 copë)", 4.50, grill), ("Pleskavicë", 4.00, grill), ("Bërxolla qengji", 9.50, grill),
                                ("Pizza Margherita", 5.50, kitchen), ("Flija me kos", 4.00, kitchen), ("Sallatë shope", 2.50, kitchen),
                                ("Supë e ditës", 2.00, kitchen), ("Trileçe", 2.50, kitchen), ("Baklava", 2.00, kitchen)]:
        it = co.item(name, price, kind=SERVICE, vat="S18", **({"minimumAge": 18} if "Birrë" in name or "Verë" in name else {}))
        co.put(f"/pos/items/{it['id']}/production-center", {"productionCenterId": center["id"]})
        menu[name] = it
    co.post("/pos/modifier-groups", {"name": "Ekstra", "minSelect": 0, "maxSelect": 3,
                                     "itemIds": [menu["Pizza Margherita"]["id"], menu["Qebapa (10 copë)"]["id"]],
                                     "modifiers": [{"id": None, "name": "Djathë ekstra", "priceDelta": 0.5}, {"id": None, "name": "Ajvar", "priceDelta": 0.3},
                                                   {"id": None, "name": "Pa qepë", "priceDelta": 0}]})
    co.post("/pos/modifier-groups", {"name": "Pjekja", "minSelect": 1, "maxSelect": 1, "itemIds": [menu["Bërxolla qengji"]["id"]],
                                     "modifiers": [{"id": None, "name": "Mesatare", "priceDelta": 0}, {"id": None, "name": "E pjekur mirë", "priceDelta": 0}]})
    tables = []
    for floor_name, count in [("Salla", 8), ("Tarraca", 6)]:
        floor = co.post("/pos/floors", {"storeId": store["id"], "name": floor_name})
        for n in range(count):
            tables.append(co.post("/pos/tables", {"floorId": floor["id"], "name": f"{floor_name[0]}{n + 1}", "seats": 4 if n % 3 else 2,
                                                  "shape": n % 2, "x": (n % 4) * 3, "y": (n // 4) * 3}))
    co.register(store["id"], "TU-K1", "Arka e sallës", RESTAURANT, 1)
    co.register(store["id"], "TU-BAR", "Arka e barit", RESTAURANT, 2)
    venue = co.post("/pos/venues", {"storeId": store["id"], "name": "Salla e ahengjeve", "capacity": 120})
    package = co.item("Menu aheng (për person)", 18.00, kind=SERVICE)
    co.post("/pos/events", {"storeId": store["id"], "venueId": venue["id"], "date": (TODAY + timedelta(days=21)).isoformat(),
                            "customerName": "Familja Bytyqi — synet", "guestsEstimated": 90, "from": "13:00:00", "to": "18:00:00",
                            "packageItemId": package["id"], "pricePerGuest": 18})
    till = Till(co, "TU-K1")
    orders = [[("Qebapa (10 copë)", 2), ("Sallatë shope", 1), ("Coca-Cola 0,33 L", 2)], [("Pizza Margherita", 1), ("Birrë Peja 0,33 L", 2)],
              [("Bërxolla qengji", 2), ("Verë e kuqe Stone Castle (gotë)", 2), ("Trileçe", 2)], [("Makiato", 3), ("Baklava", 1)],
              [("Flija me kos", 2), ("Supë e ditës", 2), ("Çaj", 2)]]
    pjekja = next(g for g in co.get("/pos/modifier-groups") if g["name"] == "Pjekja")["modifiers"][0]["id"]
    for i, lines in enumerate(orders):
        tab = co.post("/pos/tabs", {"storeId": store["id"], "tableId": tables[i]["id"], "kind": 0, "covers": 2 + i % 3})
        tab = co.post(f"/pos/tabs/{tab['id']}/lines", {"lines": [
            {"itemId": menu[n]["id"], "quantity": q, "course": 1, "ageVerified": True,
             "modifierIds": [pjekja] if n == "Bërxolla qengji" else []} for n, q in lines]})
        tab = co.post(f"/pos/tabs/{tab['id']}/send")
        if i < 3:
            pay = [{"itemId": l["itemId"], "description": l["description"], "quantity": l["remaining"], "unitPrice": l["unitPrice"],
                    "taxDefinitionId": None, "tabLineId": l["id"]} for l in tab["lines"] if l["remaining"] > 0 and l.get("parentLineId") is None]
            till.sell(pay, kind=[CASH, CARD][i % 2], tabId=tab["id"])
    payroll(co)
    accounting_months(co, [], [("Qiraja Sh.p.k.", "Qiraja e lokalit", 1500, "610100"), ("KEDS Energji", "Energjia", 480, "610200")],
                      lambda m: [])
    return "menu of 15 with kitchen/bar/grill tickets, 14 tables, 3 paid tables and 2 open, a party booked in the hall"


def hotel():
    owner = User("hotel.owner@pako.test")
    co, new = create_company(owner, "Hotel Prishtina Plaza Sh.p.k.", HOTEL, profile={
        "tradingName": "Hotel Prishtina Plaza", "fiscalNumber": "811500303", "municipality": "Prishtinë", "streetAddress": "Rr. Nënë Tereza 10",
        "phone": "+383 38 600 303", "businessActivity": "5510 — Hotele"})
    if not new:
        return "already there"
    bank_account(co, "NLB Banka", "XK051701000000030303")
    roles(co, [("Recepsionist", {"pos": W, "sales": W, "partners": W, "items": R}, "Bookings, check-in/out, guest bills."),
               ("Menaxher hoteli", {"pos": A, "sales": A, "partners": W, "items": W, "inventory": W, "reports": R},
                "Rates, rooms, refunds, events and closing the tills.")])
    staff(co, [
        ("Shpresa", "Ahmeti", "Menaxhere hoteli", "Recepsioni", 1100, "hotel.manager@pako.test", "Menaxher hoteli"),
        ("Arben", "Llapashtica", "Recepsionist", "Recepsioni", 600, "hotel.reception@pako.test", "Recepsionist"),
        ("Mimoza", "Halili", "Pastruese", "Housekeeping", 450, None, None),
        ("Gentian", "Ismajli", "Kontabilist", "Administrata", 850, "hotel.accountant@pako.test", "accountant"),
        ("Rina", "Sopi", "Zyrtare HR", "Administrata", 750, "hotel.hr@pako.test", "hr"),
    ])
    opening_capital(co, 80000)
    main = co.main_warehouse()
    tax = co.item("Taksë turistike (natë)", 1.00, kind=SERVICE, vat="SEX")
    store = co.store("PP1", "Prishtina Plaza", 1, "Prishtinë", main, touristTaxItemId=tax["id"])
    rates = {"Dhomë standard dyshe": (co.item("Natë — standard dyshe", 75.0, kind=SERVICE, vat="S08"), 2, ["101", "102", "103", "104", "201", "202", "203"]),
             "Dhomë teke": (co.item("Natë — teke", 55.0, kind=SERVICE, vat="S08"), 1, ["105", "106", "204"]),
             "Suitë": (co.item("Natë — suitë", 140.0, kind=SERVICE, vat="S08"), 3, ["301", "302"])}
    for type_name, (rate, capacity, numbers) in rates.items():
        room_type = co.post("/pos/room-types", {"storeId": store["id"], "name": type_name, "capacity": capacity, "rateItemId": rate["id"]})
        for number in numbers:
            co.post("/pos/rooms", {"roomTypeId": room_type["id"], "number": number, "floor": number[0]})
    types = {t["name"]: t for t in co.get(f"/pos/room-types?storeId={store['id']}")}
    guests = [("Hans Müller", "DE", 0, 3, "Dhomë standard dyshe", "Booking.com"), ("Sara Rossi", "IT", 0, 2, "Dhomë teke", "Expedia"),
              ("Ilir Krasniqi", "XK", 2, 5, "Suitë", "Telefon"), ("John Smith", "US", 6, 9, "Dhomë standard dyshe", "Website"),
              ("Elira Berisha", "AL", 10, 12, "Dhomë teke", "Booking.com")]
    for i, (name, nationality, start, end, type_name, channel) in enumerate(guests):
        booking = co.post("/pos/hotel/bookings", {"storeId": store["id"], "roomTypeId": types[type_name]["id"], "arrival": (TODAY + timedelta(days=start)).isoformat(),
                                                  "departure": (TODAY + timedelta(days=end)).isoformat(), "guestName": name, "adults": min(1 + (i % 2), types[type_name]["capacity"]),
                                                  "roomId": types[type_name]["rooms"][i % len(types[type_name]["rooms"])]["id"], "channel": channel})
        if start == 0:
            co.put(f"/pos/hotel/bookings/{booking['id']}/guests", {"guests": [
                {"id": "00000000-0000-0000-0000-000000000000", "fullName": name, "nationality": nationality, "documentType": "Pasaportë",
                 "documentNumber": f"P{rng.randint(1000000, 9999999)}", "birthDate": "1980-05-10", "isPrimary": True}]})
            co.post(f"/pos/hotel/bookings/{booking['id']}/check-in")
            co.post(f"/pos/hotel/bookings/{booking['id']}/post-nights")
    for name, price in [("Mëngjes", 8.0), ("Kafe", 1.5), ("Darkë menu", 15.0), ("Minibar — ujë", 1.5)]:
        co.item(name, price, kind=SERVICE)
    co.register(store["id"], "PP-REC", "Recepsioni", RESTAURANT, 1)
    hall = co.post("/pos/venues", {"storeId": store["id"], "name": "Salla Plaza (konferenca)", "capacity": 200})
    co.post("/pos/events", {"storeId": store["id"], "venueId": hall["id"], "date": (TODAY + timedelta(days=14)).isoformat(),
                            "customerName": "Konferenca e Bankave 2026", "guestsEstimated": 150, "from": "09:00:00", "to": "17:00:00",
                            "pricePerGuest": 22})
    ticket = co.item("Biletë — Mbrëmje jazz", 15.00, kind=SERVICE, vat="S08")
    co.post("/pos/ticketed-events", {"storeId": store["id"], "name": "Mbrëmje jazz në Plaza", "startsAt": local_utc(TODAY + timedelta(days=9), 20).isoformat(),
                                     "capacity": 120, "ticketTypes": [{"itemId": ticket["id"], "quota": 120}]})
    till = Till(co, "PP-REC")
    till.sell([till.line("Biletë — Mbrëmje jazz", 4)], kind=CARD)
    till.sell([till.line("Kafe", 2), till.line("Mëngjes", 2)], kind=CASH)
    payroll(co)
    accounting_months(co, [co.partner("Banka Ekonomike (konferenca)", fiscal="811600302")],
                      [("KEDS Energji", "Energjia", 1800, "610200"), ("Pastrimi Sh.p.k.", "Pastrim dhe lavanderi", 900, "610200")],
                      lambda m: [{"description": "Akomodim i stafit — paketë mujore", "quantity": 1, "unitPrice": 1450, "taxDefinitionId": co.tax["S08"],
                                  "revenueAccountId": None}])
    return "12 rooms in 3 types, 5 bookings (2 checked in today), conference booked, jazz night with tickets"


def services():
    owner = User("salon.owner@pako.test")
    co, new = create_company(owner, "Salloni Bukuria Sh.p.k.", SERVICES_T, profile={
        "tradingName": "Salloni Bukuria", "fiscalNumber": "811500404", "municipality": "Pejë", "streetAddress": "Rr. Mbretëresha Teutë 7",
        "phone": "+383 39 600 404", "businessActivity": "9602 — Parukeri dhe trajtime bukurie"})
    if not new:
        return "already there"
    bank_account(co, "TEB Banka", "XK052001000000040404")
    roles(co, [("Recepsioniste salloni", {"pos": W, "partners": W, "items": R}, "Books appointments and takes payment.")])
    staff(co, [
        ("Teuta", "Mustafa", "Stiliste", "Salloni", 650, "salon.stylist@pako.test", "Recepsioniste salloni"),
        ("Dafina", "Rugova", "Recepsioniste", "Salloni", 480, "salon.reception@pako.test", "Recepsioniste salloni"),
        ("Kaltrina", "Hyseni", "Masazhiste", "Salloni", 600, None, None),
        ("Besnik", "Avdiu", "Kontabilist", "Administrata", 700, "salon.accountant@pako.test", "accountant"),
    ])
    opening_capital(co, 8000)
    main = co.main_warehouse()
    store = co.store("SB1", "Salloni Bukuria", 1, "Pejë", main)
    services_ = {name: co.item(name, price, kind=SERVICE, isBookable=True, durationMinutes=duration, bufferMinutes=10)
                 for name, price, duration in [("Prerje flokësh femra", 12.0, 45), ("Prerje flokësh meshkuj", 6.0, 30), ("Ngjyrosje flokësh", 35.0, 90),
                                               ("Manikyr", 10.0, 45), ("Masazh relaksues 60 min", 25.0, 60)]}
    co.item("Paketë 10 masazhe", 210.0, kind=SERVICE, vat="SEX", packageServiceItemId=services_["Masazh relaksues 60 min"]["id"],
            packageSessions=10, packageValidDays=180)
    co.item("Anëtarësim mujor fitness", 25.0, kind=SERVICE, membershipDays=30)
    vendor = co.partner("Kozmetika Pro Sh.p.k.", customer=False, vendor=True)
    shampoo = co.item("Shampo L'Oréal 500 ml", 9.90, barcode="3600523000011")
    co.buy(vendor["id"], [(shampoo, 40, 5.20)], main)
    hours = [{"day": d, "from": "09:00:00", "to": "19:00:00"} for d in range(6)]
    users = {u["email"]: u for u in co.get("/admin/users")}
    teuta = co.post("/pos/resources", {"storeId": store["id"], "name": "Teuta", "kind": 0, "hours": hours, "color": "#db2777",
                                       "serviceItemIds": [services_[n]["id"] for n in ("Prerje flokësh femra", "Prerje flokësh meshkuj", "Ngjyrosje flokësh")],
                                       "userId": users.get("salon.stylist@pako.test", {}).get("userId")})
    co.post("/pos/resources", {"storeId": store["id"], "name": "Kabina e manikyrit", "kind": 1, "hours": hours, "color": "#0891b2",
                               "serviceItemIds": [services_["Manikyr"]["id"]]})
    co.post("/pos/resources", {"storeId": store["id"], "name": "Kabina e masazhit", "kind": 1, "hours": hours, "color": "#16a34a",
                               "serviceItemIds": [services_["Masazh relaksues 60 min"]["id"]]})
    day = TODAY + timedelta(days=1)
    while day.weekday() == 6:
        day += timedelta(days=1)
    for hour, name, service in [(9, "Arbëresha Kastrati", "Prerje flokësh femra"), (10, "Blerina Dema", "Ngjyrosje flokësh"),
                                (13, "Faton Ramadani", "Prerje flokësh meshkuj"), (15, "Hana Mehmeti", "Prerje flokësh femra")]:
        co.post("/pos/appointments", {"storeId": store["id"], "itemId": services_[service]["id"], "resourceId": teuta["id"],
                                      "start": local_utc(day, hour).isoformat(), "customerName": name, "phone": "+38349000111"})
    co.post(f"/pos/stores/{store['id']}/booking-link", {"enabled": True})
    co.register(store["id"], "SB-K1", "Arka e sallonit", SERVICES, 1)
    repair = co.item("Riparim — tharëse flokësh", 15.0, kind=SERVICE)
    co.post("/pos/repairs", {"storeId": store["id"], "customerName": "Mirlinda Gjoka", "device": "Tharëse Philips", "problem": "Nuk ndizet",
                             "lines": [{"itemId": repair["id"], "quantity": 1}]})
    till = Till(co, "SB-K1")
    till.sell([till.line("Prerje flokësh meshkuj")], kind=CASH)
    till.sell([till.line("Manikyr"), till.line("Shampo L'Oréal 500 ml")], kind=CARD)
    till.sell([till.line("Anëtarësim mujor fitness")], kind=CASH)
    payroll(co)
    accounting_months(co, [], [("Qiraja Sh.p.k.", "Qiraja e sallonit", 700, "610100"), ("KEDS Energji", "Energjia", 160, "610200")], lambda m: [])
    return "5 bookable services, 3 resources, 4 appointments tomorrow, package and membership, a repair, online booking link"


def pharmacy():
    owner = User("pharmacy.owner@pako.test")
    co, new = create_company(owner, "Barnatorja Shëndeti Sh.p.k.", PHARMACY, profile={
        "tradingName": "Barnatorja Shëndeti", "fiscalNumber": "811500505", "municipality": "Gjakovë", "streetAddress": "Rr. Nëna Tereze 21",
        "phone": "+383 390 600 505", "businessActivity": "4773 — Shitje me pakicë e barnave"})
    if not new:
        return "already there"
    bank_account(co, "ProCredit Bank", "XK051111000000050505")
    roles(co, [("Farmacist", {"pos": A, "items": W, "inventory": W, "partners": W, "reports": R},
                "Dispenses prescriptions, keeps the controlled register, refunds.")])
    staff(co, [
        ("Dr. Merita", "Kastrati", "Farmaciste përgjegjëse", "Barnatorja", 1200, "pharmacy.pharmacist@pako.test", "Farmacist"),
        ("Albina", "Zogaj", "Asistente farmacie", "Barnatorja", 550, "pharmacy.cashier@pako.test", "cashier"),
        ("Ardian", "Gjinovci", "Kontabilist", "Administrata", 750, "pharmacy.accountant@pako.test", "accountant"),
    ])
    opening_capital(co, 25000)
    main = co.main_warehouse()
    vendor = co.partner("Medica Distribution Sh.p.k.", customer=False, vendor=True)
    meds = [("Paracetamol 500 mg (20 tableta)", 2.50, "N02BE01", "Paracetamol", False, False, 3.00, "05901234123457"),
            ("Panadol 500 mg (24 tableta)", 3.20, "N02BE01", "Paracetamol", False, False, 3.50, "05000000000017"),
            ("Ibuprofen 400 mg (20 tableta)", 2.90, "M01AE01", "Ibuprofen", False, False, 3.40, "05000000000024"),
            ("Amoksicilinë 500 mg (16 kapsula)", 6.80, "J01CA04", "Amoxicillin", True, False, 7.50, "05000000000031"),
            ("Azitromicinë 500 mg (3 tableta)", 7.90, "J01FA10", "Azithromycin", True, False, 8.50, "05000000000048"),
            ("Tramadol 50 mg (20 kapsula)", 4.90, "N02AX02", "Tramadol", True, True, None, "05000000000055"),
            ("Diazepam 5 mg (30 tableta)", 3.80, "N05BA01", "Diazepam", True, True, None, "05000000000062"),
            ("Vitaminë C 1000 mg (20 tableta)", 5.50, "A11GA01", "Ascorbic acid", False, False, None, "05000000000079")]
    items = {}
    for name, price, atc, ingredient, rx, controlled, cap, gtin in meds:
        items[name] = co.item(name, price, vat="S08", barcode=gtin, atcCode=atc, activeIngredient=ingredient, isPrescriptionOnly=rx,
                              isControlled=controlled, **({"maxRetailPrice": cap} if cap else {}))
    co.buy(vendor["id"], [(items[n], 60 if not c else 20, round(p * 0.6, 2), "B08") for n, p, _, _, _, c, _, _ in meds], main)
    fund = co.partner("Fondi i Sigurimeve Shëndetësore", fiscal="811600501")
    payer = co.post("/pos/pharmacy/payers", {"name": "FSSH", "partnerId": fund["id"], "coveragePercent": 80})
    insurer = co.partner("Sigal Uniqa (sigurim shëndetësor)", fiscal="811600502")
    co.post("/pos/pharmacy/payers", {"name": "Sigal Uniqa", "partnerId": insurer["id"], "coveragePercent": 50})
    store = co.store("BS1", "Barnatorja Shëndeti", 1, "Gjakovë", main)
    co.register(store["id"], "BS-K1", "Arka e barnatores", RETAIL, 1)
    co.payment_method(ON_ACCOUNT, "Në llogari", "111100")
    for number, patient, lines in [("RX-2026-1001", "Besa Krasniqi", [("Amoksicilinë 500 mg (16 kapsula)", 2), ("Ibuprofen 400 mg (20 tableta)", 1)]),
                                   ("RX-2026-1002", "Gëzim Lika", [("Tramadol 50 mg (20 kapsula)", 1)]),
                                   ("RX-2026-1003", "Vlora Pula", [("Azitromicinë 500 mg (3 tableta)", 1)])]:
        co.post("/pos/pharmacy/prescriptions", {"storeId": store["id"], "number": number, "issuedOn": TODAY.isoformat(),
                                                "validUntil": (TODAY + timedelta(days=30)).isoformat(), "prescriber": "Dr. Valon Gashi",
                                                "prescriberLicence": "MSH-4411", "patientName": patient, "payerId": payer["id"],
                                                "lines": [{"itemId": items[n]["id"], "quantity": q, "dosage": "sipas udhëzimit"} for n, q in lines]})
    till = Till(co, "BS-K1")
    rx = next(p for p in items_of(co.get("/pos/pharmacy/prescriptions")) if p["number"] == "RX-2026-1001")
    lines = [till.line(next(n for n in till.catalog if n.startswith(l["itemName"][:12])), l["remaining"], prescriptionLineId=l["id"]) for l in rx["lines"]]
    quote = till.quote(lines, prescriptionId=rx["id"])
    share = (quote.get("tenderPartners") or [None])[0]
    on_account = next(m["id"] for m in co.get("/payment-methods") if m["kind"] == ON_ACCOUNT)
    payments = [{"paymentMethodId": on_account, "amount": share["max"], "partnerId": share["partnerId"]}] if share else []
    rest = round(quote["total"] - (share["max"] if share else 0), 2)
    if rest > 0:
        payments.append({"paymentMethodId": till.tender[CASH], "amount": rest})
    till.sell(lines, payments, prescriptionId=rx["id"])
    for _ in range(6):
        till.sell([till.line(rng.choice(["Paracetamol 500 mg (20 tableta)", "Vitaminë C 1000 mg (20 tableta)", "Ibuprofen 400 mg (20 tableta)"]),
                             rng.randint(1, 2))], kind=rng.choice([CASH, CARD]))
    payroll(co)
    accounting_months(co, [], [("Qiraja Sh.p.k.", "Qiraja e barnatores", 900, "610100")], lambda m: [])
    return "8 medicines (4 prescription-only, 2 controlled, price caps), FSSH 80% and an insurer, 3 prescriptions (one dispensed)"


def fuel_station():
    owner = User("fuel.owner@pako.test")
    co, new = create_company(owner, "Pika Karburanti Rugova Sh.p.k.", FUEL, profile={
        "tradingName": "Rugova Petrol", "fiscalNumber": "811500606", "municipality": "Fushë Kosovë", "streetAddress": "Magjistralja Prishtinë–Pejë km 8",
        "phone": "+383 38 600 606", "businessActivity": "4730 — Shitje me pakicë e karburanteve"})
    if not new:
        return "already there"
    bank_account(co, "BKT", "XK052101000000060606")
    roles(co, [("Pompist", {"pos": W, "items": R}, "Serves at the pumps and the shop till.")])
    staff(co, [
        ("Naim", "Kelmendi", "Menaxher stacioni", "Stacioni", 900, "fuel.manager@pako.test", "accountant"),
        ("Florian", "Hasani", "Pompist", "Stacioni", 500, "fuel.attendant@pako.test", "Pompist"),
        ("Kujtim", "Rexha", "Pompist", "Stacioni", 500, None, None),
    ])
    opening_capital(co, 60000)
    tanks_wh = co.warehouse("RZ", "Rezervuarët")
    vendor = co.partner("Kosova Petrol Import", customer=False, vendor=True)
    diesel = co.item("Naftë D2", 1.45, unit="litër", sellByWeight=True)
    petrol = co.item("Benzinë 95", 1.55, unit="litër", sellByWeight=True)
    lpg = co.item("Gaz LPG", 0.75, unit="litër", sellByWeight=True)
    co.buy(vendor["id"], [(diesel, 15000, 1.05), (petrol, 10000, 1.12), (lpg, 5000, 0.48)], tanks_wh["id"])
    shop = {n: co.item(n, p, barcode=b) for n, p, b in [("Ujë 0,5 L", 0.50, "3830001021001"), ("Kafe në gotë", 1.00, None),
                                                        ("Vaj motori Castrol 5W-30 1 L", 11.90, "4008177000018"), ("Lëng xhamash 5 L", 4.50, "3830001021025")]}
    co.buy(vendor["id"], [(shop["Ujë 0,5 L"], 200, 0.25), (shop["Vaj motori Castrol 5W-30 1 L"], 30, 7.0), (shop["Lëng xhamash 5 L"], 40, 2.6)],
           tanks_wh["id"])
    store = co.store("RG1", "Rugova Petrol", 1, "Fushë Kosovë", tanks_wh["id"])
    tanks = {n: co.post("/pos/forecourt/tanks", {"storeId": store["id"], "name": n, "itemId": i["id"], "capacity": c})
             for n, i, c in [("T1 Naftë", diesel, 30000), ("T2 Benzinë", petrol, 20000), ("T3 LPG", lpg, 10000)]}
    nozzles = {}
    for pump in (1, 2, 3):
        for number, tank in ((1, "T1 Naftë"), (2, "T2 Benzinë")):
            nozzles[(pump, number)] = co.post("/pos/forecourt/nozzles", {"storeId": store["id"], "pump": pump, "number": number, "tankId": tanks[tank]["id"]})
    nozzles[(4, 1)] = co.post("/pos/forecourt/nozzles", {"storeId": store["id"], "pump": 4, "number": 1, "tankId": tanks["T3 LPG"]["id"]})
    transport = co.partner("Trans Kosova Sh.p.k.", fiscal="811600601")
    bus = co.partner("Autobusi Prishtina Sh.p.k.", fiscal="811600602")
    for number, partner, plate, limit in [("FC-2001", transport, "01-111-AA", 300), ("FC-2002", transport, "01-222-BB", 300),
                                          ("FC-3001", bus, "01-333-CC", 500)]:
        co.post("/pos/forecourt/fleet-cards", {"number": number, "partnerId": partner["id"], "vehiclePlate": plate, "limitPerFill": limit})
    co.register(store["id"], "RG-K1", "Arka e stacionit", FORECOURT, 1)
    co.payment_method(ON_ACCOUNT, "Në llogari", "111100")
    till = Till(co, "RG-K1")
    pumped = {k: 0.0 for k in nozzles}
    for (pump, number), name, litres, kind in [((1, 1), "Naftë D2", 45.2, CASH), ((1, 2), "Benzinë 95", 32.0, CARD), ((2, 1), "Naftë D2", 60.0, CASH),
                                               ((3, 2), "Benzinë 95", 25.5, CASH), ((4, 1), "Gaz LPG", 40.0, CASH), ((2, 1), "Naftë D2", 38.7, CARD)]:
        till.sell([till.line(name, litres, nozzleId=nozzles[(pump, number)]["id"])], kind=kind)
        pumped[(pump, number)] += litres
    line = [till.line("Naftë D2", 150, nozzleId=nozzles[(3, 1)]["id"])]
    quote = till.quote(line, fleetCardNumber="FC-3001")
    on_account = next(m["id"] for m in co.get("/payment-methods") if m["kind"] == ON_ACCOUNT)
    till.sell(line, [{"paymentMethodId": on_account, "amount": quote["total"], "partnerId": quote["tenderPartners"][0]["partnerId"], "reference": "01-333-CC"}],
              fleetCardNumber="FC-3001")
    pumped[(3, 1)] += 150
    till.sell([till.line("Kafe në gotë", 2), till.line("Ujë 0,5 L", 2)], kind=CASH)
    co.post("/pos/forecourt/readings", {"storeId": store["id"], "date": TODAY.isoformat(), "sessionId": till.session["id"], "readings": [
        {"nozzleId": n["id"], "opening": 250000.0 + k[0] * 1000 + k[1], "closing": round(250000.0 + k[0] * 1000 + k[1] + pumped[k] + (0.4 if k == (1, 1) else 0), 3)}
        for k, n in nozzles.items()]})
    for name, volume in [("T1 Naftë", 14700), ("T2 Benzinë", 9940), ("T3 LPG", 4955)]:
        co.post("/pos/forecourt/dips", {"tankId": tanks[name]["id"], "volume": volume, "water": 0})
    accounting_months(co, [transport], [("KEDS Energji", "Energjia", 520, "610200")],
                      lambda m: [co.sell_line(diesel, 900, 1.40)], warehouse_id=tanks_wh["id"])
    return "diesel/petrol/LPG in 3 tanks, 4 pumps / 7 nozzles, 3 fleet cards, today's fills with meter readings and dips"


def wholesale():
    owner = User("wholesale.owner@pako.test")
    co, new = create_company(owner, "Distributori Kosova Sh.p.k.", WHOLESALE, profile={
        "tradingName": "DK Distribution", "fiscalNumber": "811500707", "municipality": "Ferizaj", "streetAddress": "Zona Industriale p.n.",
        "phone": "+383 290 600 707", "businessActivity": "4639 — Tregti me shumicë e ushqimeve"})
    if not new:
        return "already there"
    bank_account(co, "Raiffeisen Bank Kosovo", "XK051501000000070707")
    roles(co, [("Agjent shitjesh", {"sales": W, "partners": R, "items": R, "inventory": R, "pos": W}, "Takes orders on the route and collects cash.", ),
               ("Magazinier", {"inventory": A, "items": W, "purchases": W, "partners": R}, "Receives, delivers and loads the vans.")])
    staff(co, [
        ("Ilir", "Bajrami", "Agjent shitjesh", "Shitja", 650, "wholesale.salesrep@pako.test", "Agjent shitjesh"),
        ("Endrit", "Musliu", "Agjent shitjesh", "Shitja", 650, "wholesale.salesrep2@pako.test", "Agjent shitjesh"),
        ("Shkëlzen", "Osmani", "Magazinier", "Magazina", 600, "wholesale.warehouse@pako.test", "Magazinier"),
        ("Adelina", "Shabani", "Kontabiliste", "Administrata", 900, "wholesale.accountant@pako.test", "accountant"),
        ("Dardan", "Haliti", "Shofer", "Logjistika", 550, None, None),
    ])
    opening_capital(co, 120000)
    main = co.main_warehouse()
    vendor = co.partner("Podravka d.d.", customer=False, vendor=True)
    catalog = [("Vegeta 500 g", 3.20), ("Kafe Barcaffe 500 g", 6.90), ("Sheqer 1 kg", 0.95), ("Miell T-500 25 kg", 14.50), ("Vaj ulliri 1 L", 7.20),
               ("Pasta Barilla 500 g", 1.10), ("Lëng Bravo 1 L", 1.20), ("Çokollatë Milka 100 g", 1.40)]
    items = {n: co.item(n, p, unit="copë") for n, p in catalog}
    co.buy(vendor["id"], [(items[n], 2500, round(p * 0.7, 2)) for n, p in catalog], main)
    wholesale_list = co.post("/price-lists", {"name": "Shumicë A", "warehouseId": None, "isCustomerList": True})
    change = co.post("/price-changes", {"priceListId": wholesale_list["id"], "date": TODAY.isoformat(), "lines":
                                        [{"itemId": items[n]["id"], "newPrice": round(p * 0.88, 2)} for n, p in catalog]
                                        + [{"itemId": items[n]["id"], "newPrice": round(p * 0.82, 2), "minQuantity": 100} for n, p in catalog[:4]]})
    co.post(f"/price-changes/{change['id']}/post")
    shops = []
    for i, (name, limit) in enumerate([("Market Viva Ferizaj", 6000), ("Kioska Dardania", 1500), ("Market Ulpiana", 4000), ("ETC Ferizaj", 10000),
                                       ("Market Albi", 3000), ("Kioska Shkolla", 800)]):
        shops.append(co.partner(name, fiscal=f"8117{i:05d}", creditLimit=limit, overdueBlockDays=45,
                                priceListId=wholesale_list["id"] if i % 2 == 0 else None))
    users = {u["email"]: u for u in co.get("/admin/users")}
    rep = users["wholesale.salesrep@pako.test"]["userId"]
    van1 = co.post("/vehicles", {"plate": "03-123-KS", "type": 1, "driverUserId": rep, "createStockWarehouse": True})
    co.post("/vehicles", {"plate": "03-456-KS", "type": 1, "driverUserId": users["wholesale.salesrep2@pako.test"]["userId"], "createStockWarehouse": True})
    van = {"id": van1["stockWarehouseId"]}
    transfer = co.post("/stock-documents", {"type": TRANSFER, "date": TODAY.isoformat(), "warehouseId": main, "destinationWarehouseId": van["id"],
                                            "notes": "Ngarkimi i mëngjesit", "lines": [{"itemId": items[n]["id"], "quantity": 40} for n, _ in catalog[:6]]})
    co.post("/distribution/routes", {"name": "Ferizaj — Qendra", "userId": rep, "warehouseId": van["id"], "days": 127,
                                     "stops": [{"partnerId": s["id"], "notes": None} for s in shops[:4]]})
    co.post("/distribution/routes", {"name": "Ferizaj — Fshatrat", "userId": users["wholesale.salesrep2@pako.test"]["userId"], "days": 0b0010101,
                                     "stops": [{"partnerId": s["id"], "notes": None} for s in shops[3:]]})
    for shop in shops[:3]:
        lines = [(items[n], rng.choice([24, 48, 120])) for n, _ in rng.sample(catalog, 3)]
        prices = {p["itemId"]: p["price"] for p in call("GET", co.c + "/prices/resolve?" + "&".join(
            [f"itemIds={i['id']}" for i, _ in lines] + [f"quantities={q}" for _, q in lines] + [f"partnerId={shop['id']}"]), co.user.token)}
        so = co.post("/sales-orders", {"partnerId": shop["id"], "date": TODAY.isoformat(), "warehouseId": main, "deliveryDate": (TODAY + timedelta(days=1)).isoformat(),
                                       "lines": [{"itemId": i["id"], "quantity": q, "unitPrice": prices[i["id"]], "taxDefinitionId": co.tax["S18"]} for i, q in lines]})
        co.post(f"/sales-orders/{so['id']}/quote")
        co.post(f"/sales-orders/{so['id']}/confirm", {})
        if shop is shops[0]:
            delivery = co.post(f"/sales-orders/{so['id']}/delivery")
            co.post(f"/stock-documents/{delivery}/post")
            draft = co.get(f"/sales-orders/{so['id']}/invoice-draft")
            invoice = co.post("/invoices", {"partnerId": shop["id"], "issueDate": TODAY.isoformat(), "dueDate": (TODAY + timedelta(days=30)).isoformat(),
                                            "warehouseId": main, "lines": [{**{k: l[k] for k in ("description", "quantity", "unitPrice", "taxDefinitionId",
                                                                                                 "discountPercent", "itemId", "unitName", "salesOrderLineId", "deliveryLineId")},
                                                                            "revenueAccountId": None} for l in draft["lines"]]})
            co.post(f"/invoices/{invoice['id']}/post")
    payroll(co)
    accounting_months(co, shops[3:5], [("Qiraja Sh.p.k.", "Qiraja e magazinës", 2500, "610100"), ("Petrol Lux", "Karburant për furgonët", 900, "640100")],
                      lambda m: [co.sell_line(items["Sheqer 1 kg"], 150, 0.85), co.sell_line(items["Pasta Barilla 500 g"], 100, 0.98)], months=3)
    return "wholesale list with volume tiers, 6 shops with credit limits, 3 orders (one delivered and invoiced), 2 vans and 2 routes"


def construction(firm, firm_admin):
    owner = User("construction.owner@pako.test")
    co, new = create_company(owner, "Ndërtimi Ilir Sh.p.k.", CONSTRUCTION, firm=firm, firm_admin=firm_admin, profile={
        "tradingName": "Ndërtimi Ilir", "fiscalNumber": "811500808", "municipality": "Mitrovicë", "streetAddress": "Rr. Mbretëresha Teutë 40",
        "phone": "+383 28 600 808", "businessActivity": "4120 — Ndërtimi i ndërtesave"})
    if not new:
        return "already there"
    bank_account(co, "NLB Banka", "XK051701000000080808")
    roles(co, [("Menaxher kantieri", {"sales": W, "purchases": W, "inventory": W, "items": R, "partners": R, "reports": R},
                "Runs the sites: materials, subcontractors' bills, progress bills.")])
    staff(co, [
        ("Ilir", "Rama", "Menaxher kantieri", "Kantieri", 1300, "construction.sitemanager@pako.test", "Menaxher kantieri"),
        ("Bekim", "Lushi", "Inxhinier", "Kantieri", 1100, None, None),
        ("Adem", "Jashari", "Punëtor", "Kantieri", 600, None, None),
        ("Fitore", "Bunjaku", "Zyrtare pagash", "Administrata", 800, "construction.payroll@pako.test", "payroll"),
    ])
    opening_capital(co, 150000)
    main = co.main_warehouse()
    vendor = co.partner("Beton Kosova Sh.p.k.", customer=False, vendor=True)
    works = co.item("Punë ndërtimore (situacion)", None, kind=SERVICE)
    cement = co.item("Çimento 50 kg", 6.50, unit="thes")
    rebar = co.item("Hekur armature Ø12", 0.95, unit="kg")
    blocks = co.item("Bllok betoni 20 cm", 0.95)
    co.buy(vendor["id"], [(cement, 800, 4.80), (rebar, 12000, 0.72), (blocks, 6000, 0.60)], main)
    sites = []
    for name, code, client, value in [("Shkolla fillore Mitrovicë", "K-2026-01", "Komuna e Mitrovicës", 420000),
                                      ("Banesa kolektive Lagjja e Re", "K-2026-02", "Investitori Rexhepi", 1200000)]:
        customer = co.partner(client, fiscal=f"8118{len(sites):05d}")
        site = co.post("/construction/sites", {
            "name": name, "clientPartnerId": customer["id"], "contractValue": value, "retentionPercent": 5, "billingItemId": works["id"],
            "projectCode": code, "address": "Mitrovicë", "startDate": (TODAY - timedelta(days=90)).isoformat(), "state": 1,
            "costCodes": [{"code": "01", "name": "Themelet", "budget": value * 0.15}, {"code": "02", "name": "Konstruksioni", "budget": value * 0.35},
                          {"code": "03", "name": "Muratura", "budget": value * 0.12}, {"code": "04", "name": "Instalimet", "budget": value * 0.12}],
            "boq": [{"code": "1.1", "description": "Gërmim dheu", "unit": "m³", "quantity": round(value / 200), "unitPrice": 8},
                    {"code": "1.2", "description": "Betonim themelesh C25/30", "unit": "m³", "quantity": round(value / 2000), "unitPrice": 95},
                    {"code": "2.1", "description": "Betonim pllakash dhe shtyllash", "unit": "m³", "quantity": round(value / 1000), "unitPrice": 110},
                    {"code": "3.1", "description": "Mure me bllok 20 cm", "unit": "m²", "quantity": round(value / 150), "unitPrice": 18},
                    {"code": "4.1", "description": "Instalime elektrike dhe hidraulike", "unit": "paushall", "quantity": 1, "unitPrice": round(value * 0.11)}]})
        sites.append(site)
        codes = {c["code"]: c["id"] for c in site["costCodes"]}
        issue = co.post("/stock-documents", {"type": 7, "date": TODAY.isoformat(), "warehouseId": main, "siteId": site["id"],
                                             "lines": [{"itemId": cement["id"], "quantity": 200, "costCodeId": codes["01"]},
                                                       {"itemId": rebar["id"], "quantity": 4000, "costCodeId": codes["02"]}]})
        co.post(f"/stock-documents/{issue['id']}/post")
        sub = co.partner("Elektro Instal Sh.p.k.", customer=False, vendor=True)
        co.bill(sub["id"], [{"description": "Instalime faza 1", "quantity": 1, "unitPrice": round(value * 0.03, 2), "taxDefinitionId": co.tax["B18"],
                             "expenseAccountId": None, "costCodeId": codes["04"]}], on=TODAY - timedelta(days=10), projectId=site["projectId"])
        boq = {b["code"]: b for b in site["boq"]}
        bill = co.post(f"/construction/sites/{site['id']}/progress-bills", {"periodTo": TODAY.isoformat(), "lines": [
            {"boqLineId": boq["1.1"]["id"], "cumulativeQuantity": boq["1.1"]["quantity"]},
            {"boqLineId": boq["1.2"]["id"], "cumulativeQuantity": boq["1.2"]["quantity"]},
            {"boqLineId": boq["2.1"]["id"], "cumulativeQuantity": round(boq["2.1"]["quantity"] * 0.3)}]})
        co.post(f"/construction/progress-bills/{bill['id']}/approve")
        invoice = co.post(f"/construction/progress-bills/{bill['id']}/invoice")
        co.post(f"/invoices/{invoice}/post")
    payroll(co)
    accounting_months(co, [], [("Petrol Lux", "Karburant për makineritë", 1800, "640100"), ("Qiraja Sh.p.k.", "Qiraja e zyrës", 600, "610100")],
                      lambda m: [])
    return "2 sites with budgets and BoQs, materials issued, subcontractor bills on cost codes, progress bill 1 invoiced and posted"


def real_estate(firm, firm_admin):
    owner = User("realestate.owner@pako.test")
    co, new = create_company(owner, "Arbëria Residence Sh.p.k.", REAL_ESTATE, firm=firm, firm_admin=firm_admin, profile={
        "tradingName": "Arbëria Residence", "fiscalNumber": "811500909", "municipality": "Prishtinë", "streetAddress": "Lagjja Arbëria, Rr. Ahmet Krasniqi 5",
        "phone": "+383 38 600 909", "businessActivity": "4110 — Zhvillim i projekteve të ndërtimit"})
    if not new:
        return "already there"
    bank_account(co, "TEB Banka", "XK052001000000090909")
    roles(co, [
        ("Agjent shitjesh pronash", {"sales": W, "partners": W, "items": R, "reports": R}, "Reservations and sale contracts; no posting."),
        ("Administrator pronash", {"sales": A, "partners": W, "items": R, "reports": R}, "Leases and the monthly rent run; posts the rent invoices."),
    ])
    staff(co, [
        ("Rudina", "Hoti", "Agjente shitjesh", "Shitja", 800, "realestate.agent@pako.test", "Agjent shitjesh pronash"),
        ("Lulzim", "Kurti", "Administrator pronash", "Qiratë", 750, "realestate.rentals@pako.test", "Administrator pronash"),
        ("Majlinda", "Gecaj", "Kontabiliste", "Administrata", 900, None, None),
    ])
    opening_capital(co, 200000)
    sale = co.item("Shitje e njësisë banesore", None, kind=SERVICE)
    rent = co.item("Qira lokali afarist", None, kind=SERVICE)
    power = co.item("Energji elektrike (kWh)", 0.12, unit="kWh", kind=SERVICE)
    building = co.post("/real-estate/buildings", {"name": "Kulla A", "saleItemId": sale["id"], "projectCode": "ARB-A", "address": "Lagjja Arbëria"})
    building_b = co.post("/real-estate/buildings", {"name": "Kulla B", "saleItemId": sale["id"], "projectCode": "ARB-B", "address": "Lagjja Arbëria"})
    units = {}
    for b, prefix in ((building, "A"), (building_b, "B")):
        for floor in range(1, 5):
            for n, area in ((1, 62), (2, 85), (3, 110)):
                number = f"{prefix}-{floor}0{n}"
                units[number] = co.post("/real-estate/units", {"buildingId": b["id"], "number": number, "floor": str(floor), "kind": 0, "area": area,
                                                               "listPrice": round(area * (1150 + floor * 25))})
        for n in (1, 2):
            units[f"{prefix}-L0{n}"] = co.post("/real-estate/units", {"buildingId": b["id"], "number": f"{prefix}-L0{n}", "floor": "0", "kind": 1,
                                                                      "area": 70, "listPrice": 150000})
        for n in range(1, 5):
            units[f"{prefix}-P0{n}"] = co.post("/real-estate/units", {"buildingId": b["id"], "number": f"{prefix}-P0{n}", "floor": "-1", "kind": 3,
                                                                      "area": 14, "listPrice": 9000})
    buyers = [co.partner(n, fiscal=f"12345{i:05d}") for i, n in enumerate(["Agron Berisha", "Vjosa Hasani", "Kushtrim Sadiku", "Teuta Leka", "Fisi Kelmendi (pronarët e tokës)"])]
    co.post("/real-estate/reservations", {"unitId": units["A-202"]["id"], "partnerId": buyers[1]["id"], "date": TODAY.isoformat(),
                                          "expiresOn": (TODAY + timedelta(days=14)).isoformat(), "deposit": 2000})
    co.post("/real-estate/reservations", {"unitId": units["B-301"]["id"], "partnerId": buyers[3]["id"], "date": TODAY.isoformat(),
                                          "expiresOn": (TODAY + timedelta(days=10)).isoformat(), "deposit": 3000})
    for number, buyer, down, count in [("A-101", buyers[0], 15000, 12), ("A-303", buyers[2], 40000, 24), ("B-102", buyers[3], 20000, 0)]:
        price = units[number]["listPrice"]
        contract = co.post("/real-estate/contracts", {"unitId": units[number]["id"], "buyerPartnerId": buyer["id"], "contractDate": (TODAY - timedelta(days=40)).isoformat(),
                                                      "price": price, "downPayment": down if count else price, "installmentCount": count,
                                                      "firstInstallment": (TODAY - timedelta(days=10)).isoformat()})
        invoice = co.post(f"/real-estate/contracts/{contract['id']}/invoice", {"installmentIds": [i["id"] for i in contract["installments"][:2]]})
        co.post(f"/invoices/{invoice}/post")
    co.post("/real-estate/contracts", {"unitId": units["A-403"]["id"], "buyerPartnerId": buyers[4]["id"], "contractDate": TODAY.isoformat(),
                                       "price": units["A-403"]["listPrice"], "kind": 1,
                                       "installments": [{"dueDate": TODAY.isoformat(), "amount": units["A-403"]["listPrice"]}], "notes": "Kompensim për parcelën"})
    for unit, tenant, rent_amount in [("A-L01", "Kafeneja Te Kulla", 1200), ("A-L02", "Farmacia Arbëria", 1400), ("B-L01", "Studio Dental Smile", 1100)]:
        partner = co.partner(tenant, fiscal=f"8119{rng.randint(10000, 99999)}")
        lease = co.post("/rentals/leases", {"tenantPartnerId": partner["id"], "startDate": months_back(2)[0].isoformat(), "rent": rent_amount,
                                            "rentItemId": rent["id"], "unitId": units[unit]["id"], "dueDay": 5, "deposit": rent_amount * 2,
                                            "depositReceivedOn": months_back(2)[0].isoformat(),
                                            "meters": [{"name": "Rryma", "itemId": power["id"], "lastReading": rng.randint(10000, 20000)}]})
        co.post(f"/rentals/leases/{lease['id']}/activate")
    for month in months_back(2) + [TODAY.replace(day=1)]:
        result = co.post("/rentals/run", {"month": month.isoformat()})
        for invoice_id in result["invoiceIds"]:
            posted = co.post(f"/invoices/{invoice_id}/post")
            if month != TODAY.replace(day=1):
                co.pay("invoices", invoice_id, co.total_of(posted), month + timedelta(days=6))
    accounting_months(co, [], [("Qiraja Sh.p.k.", "Qiraja e zyrës së shitjeve", 500, "610100")], lambda m: [])
    return "2 buildings / 36 units, 2 reservations, 3 sales on installments + a compensation, 3 shops let with rent runs"


def auto_parts():
    owner = User("autoparts.owner@pako.test")
    co, new = create_company(owner, "Auto Pjesë Ferizaj Sh.p.k.", AUTO_PARTS, profile={
        "tradingName": "Auto Pjesë Ferizaj", "fiscalNumber": "811501010", "municipality": "Ferizaj", "streetAddress": "Rr. Dëshmorët e Kombit 88",
        "phone": "+383 290 601 010", "businessActivity": "4532 — Shitje me pakicë e pjesëve të automjeteve"})
    if not new:
        return "already there"
    bank_account(co, "ProCredit Bank", "XK051111000000101010")
    staff(co, [
        ("Visar", "Thaqi", "Shitës", "Shitja", 600, "autoparts.seller@pako.test", "sales"),
        ("Granit", "Musa", "Arkëtar", "Shitja", 500, "autoparts.cashier@pako.test", "cashier"),
        ("Arlinda", "Pacolli", "Kontabiliste", "Administrata", 800, "autoparts.accountant@pako.test", "reports"),
    ])
    opening_capital(co, 40000)
    main = co.main_warehouse()
    vendor = co.partner("Bosch Automotive Distributor", customer=False, vendor=True)
    parts = [("Filtër vaji Bosch P 3243", 9.90, "4047023004335", [("Bosch", "0 451 103 243"), ("VW", "03C 115 561 H"), ("Mann", "W 712/94")],
              [("Volkswagen", "Golf", 2008, 2013, "1.4 TSI"), ("Škoda", "Octavia", 2008, 2013, "1.4 TSI")]),
             ("Disqe frenash Brembo 288 mm", 54.00, "8020584054417", [("Brembo", "09.A428.11"), ("VW", "1K0 615 301 AA")],
              [("Volkswagen", "Golf", 2004, 2012, None), ("Audi", "A3", 2004, 2012, None)]),
             ("Kandela NGK BKR6E", 4.50, "0087295111111", [("NGK", "BKR6E"), ("Opel", "1214034")], [("Opel", "Astra", 1998, 2010, "1.6")]),
             ("Fshirëse xhami Bosch 600 mm", 12.90, "3165143000012", [("Bosch", "3 397 008 534")], [("BMW", "Seria 3", 2005, 2012, None)]),
             ("Bateri Varta 74 Ah", 95.00, "4016987000019", [("Varta", "574 012 068")], [("Mercedes-Benz", "C-Class", 2007, 2014, None)])]
    items = {}
    for name, price, barcode, refs, fits in parts:
        items[name] = co.item(name, price, barcode=barcode)
        co.put(f"/parts/{items[name]['id']}", {"references": [{"brand": b, "number": n} for b, n in refs],
                                               "fitments": [{"make": m, "model": mo, "yearFrom": f, "yearTo": t, "engine": e} for m, mo, f, t, e in fits]})
    co.buy(vendor["id"], [(items[n], 40 if p < 50 else 25, round(p * 0.6, 2)) for n, p, *_ in parts], main)
    store = co.store("AP1", "Auto Pjesë Ferizaj", 1, "Ferizaj", main)
    co.register(store["id"], "AP-K1", "Arka", RETAIL, 1)
    channel = co.post("/pos/channels", {"storeId": store["id"], "name": "autopjese-ferizaj.shop", "kind": 0})
    call("POST", f"/api/public/channel/{channel['token']}/orders", body={
        "externalRef": "AP-WEB-1001", "customerName": "Gent Hoxha", "fulfilment": 0, "payment": 2, "phone": "+38344777111",
        "lines": [{"itemId": items["Kandela NGK BKR6E"]["id"], "quantity": 4, "unitPrice": 4.50}]})
    till = Till(co, "AP-K1")
    till.sell([till.line("Filtër vaji Bosch P 3243"), till.line("Kandela NGK BKR6E", 4)], kind=CASH)
    till.sell([till.line("Bateri Varta 74 Ah")], kind=CARD)
    accounting_months(co, [co.partner("Auto Servis Lika", fiscal="811601001")], [("Qiraja Sh.p.k.", "Qiraja e dyqanit", 800, "610100")],
                      lambda m: [co.sell_line(items["Disqe frenash Brembo 288 mm"], 4, 48.0)])
    return "5 parts with OEM cross-references and fitments, a webshop order for pickup, counter sales"


def accounting_firm():
    """An accounting office that keeps the books of two client companies."""
    admin = User("firm.admin@pako.test")
    firms = call("GET", "/api/firms", admin.token)
    firm = next((f for f in firms if f["name"] == "Kontabiliteti Pro Sh.p.k."), None) or call("POST", "/api/firms", admin.token, {"name": "Kontabiliteti Pro Sh.p.k."})
    User("firm.accountant@pako.test")
    members = call("GET", f"/api/firms/{firm['id']}/members", admin.token)
    if not any(m["email"] == "firm.accountant@pako.test" for m in members):
        call("POST", f"/api/firms/{firm['id']}/members", admin.token, {"email": "firm.accountant@pako.test", "role": FIRM_ACCOUNTANT})
    remember_user("firm.admin@pako.test", "Kontabiliteti Pro Sh.p.k. (firm) → its client companies", "Firm administrator",
                  "Creates client companies; full access to every client")
    remember_user("firm.accountant@pako.test", "Kontabiliteti Pro Sh.p.k. (firm) → its client companies", "Firm accountant",
                  "Full bookkeeping access to every client; can't manage users")
    return firm["id"], admin


def investor():
    """One person with read-only access to three companies (tests the company switcher)."""
    User("investor@pako.test")
    for owner_email, name in [("restaurant.owner@pako.test", "Restorant Te Ura Sh.p.k."), ("hotel.owner@pako.test", "Hotel Prishtina Plaza Sh.p.k."),
                              ("market.owner@pako.test", "Supermarket Dardania Sh.p.k.")]:
        owner = User(owner_email)
        co = next(c for c in owner.companies() if c["name"] == name)
        try:
            Company(owner, co).add_member("investor@pako.test", CLIENT_VIEWER)
        except ApiError:
            pass
        remember_user("investor@pako.test", name, "Read-only member (viewer)", "Investor in three companies")


# ---- Accounts guide ----

LEVEL = {0: "—", 1: "View", 2: "Edit", 3: "Approve"}
AREAS = ["sales", "purchases", "partners", "items", "accounting", "reports", "hr", "payroll", "inventory", "pos", "settings", "users"]


def write_guide():
    admin_token = call("POST", "/api/auth/login", body={"email": PLATFORM_ADMIN[0], "password": PLATFORM_ADMIN[1]})["token"]
    companies = items_of(call("GET", "/api/platform/companies?pageSize=200", admin_token))
    lines = ["# PAKO demo accounts", "",
             f"Generated by `scripts/demo/build.py` on {TODAY.isoformat()} — the data in `backend/seed/pako_demo.sql.gz`.",
             f"**Every demo login uses the password `{PASSWORD}`** except the platform administrator.", "",
             "Open the web app at http://127.0.0.1:5180 (or the port your Vite runs on) and sign in with any address below.", "",
             "## Platform administrator", "", "| Email | Password | Can do |", "| --- | --- | --- |",
             f"| `{PLATFORM_ADMIN[0]}` | `{PLATFORM_ADMIN[1]}` | `/platform`: every company and user, modules and packs, account requests, audit log |", "",
             "## Companies and business types", "",
             "| Company | Business type | Packs switched on | Modules | Owner |", "| --- | --- | --- | --- | --- |"]
    owners = {u["company"]: u["email"] for u in RUN["users"] if u["access"].startswith("Administrator (owner)")}
    for c in sorted(companies, key=lambda c: (c.get("businessType", 0), c["name"])):
        if c["name"] not in owners:
            continue
        lines.append(f"| {c['name']} | {TYPE_NAMES[c.get('businessType', 0)]} | {', '.join(c.get('features') or []) or '—'} | "
                     f"{', '.join(c['modules'])} | `{owners[c['name']]}` |")
    lines += ["", "Each type switches on only its packs: a Market company sees no hotel, pharmacy or construction pages, and those APIs answer 403. "
              "The platform administrator can switch packs on or off per company (Platform → Companies), and a company administrator can change the "
              "business type in Settings (the packs follow the type).", "",
              "## Users", "", "| Email | Company | Access | Who they are |", "| --- | --- | --- | --- |"]
    for u in sorted(RUN["users"], key=lambda u: (u["company"], u["email"])):
        lines.append(f"| `{u['email']}` | {u['company']} | {u['access']} | {u['note']} |")
    lines += ["", "## Roles and permissions", "",
              "Levels: **View** (read), **Edit** (create and change drafts), **Approve** (also post, approve, pay, cancel, refund, close a till). "
              "Administrators and firm members have full access; read-only members (viewers) see everything and change nothing.", ""]
    seen = set()
    for c in sorted(companies, key=lambda c: c["name"]):
        owner = owners.get(c["name"])
        if not owner:
            continue
        token = call("POST", "/api/auth/login", body={"email": owner, "password": PASSWORD if owner != "demo.admin@pako.test" else "Demo-Passw0rd!"})["token"]
        roles = call("GET", f"/api/companies/{c['id']}/admin/roles", token)
        custom = [r for r in roles if not r.get("builtInKey")]
        if not seen:
            lines += ["### Built-in roles (every company)", "", "| Role | " + " | ".join(a.capitalize() for a in AREAS) + " |",
                      "| --- |" + " --- |" * len(AREAS)]
            for r in [r for r in roles if r.get("builtInKey")]:
                lines.append(f"| {r['name']} | " + " | ".join(LEVEL[r['levels'].get(a, 0)] for a in AREAS) + " |")
            lines.append("")
            seen.add("built-in")
        if custom:
            lines += [f"### {c['name']} — its own roles", "", "| Role | Description | " + " | ".join(a.capitalize() for a in AREAS) + " |",
                      "| --- | --- |" + " --- |" * len(AREAS)]
            for r in custom:
                lines.append(f"| {r['name']} | {r.get('description') or ''} | " + " | ".join(LEVEL[r['levels'].get(a, 0)] for a in AREAS) + " |")
            lines.append("")
    lines += ["## What to test with whom", "",
              "- **Business types / packs**: sign in as each owner and compare the sidebar (e.g. `hotel.owner` has Hotel and Events, `market.owner` has none).",
              "- **Role limits**: `market.cashier` can sell at the till but not refund, close a session or open accounting; `market.manager` can; "
              "`market.viewer` sees everything read-only; `market.employee` sees only My HR.",
              "- **Partner scope and firms**: `firm.accountant` sees both firm clients (Ndërtimi Ilir, Arbëria Residence) from one login.",
              "- **Several companies**: `investor@pako.test` switches between three companies, read-only in each.",
              "- **Self-service**: staff linked to an employee (most staff here) have My HR (payslips, leave, expenses).", ""]
    if RUN["failed"]:
        lines += ["## Sections that failed while building", ""] + [f"- {f}" for f in RUN["failed"]] + [""]
    path = os.path.join(REPO, "docs", "DEMO_ACCOUNTS.md")
    open(path, "w", encoding="utf-8").write("\n".join(lines))
    log(f"Wrote {path}")


def main():
    log(f"Building demo data against {API}")
    firm, firm_admin = accounting_firm()
    steps = [("Pako Demo Sh.p.k. (General)", general_showcase), ("Market", lambda: market(firm)), ("Restaurant", restaurant), ("Hotel", hotel),
             ("Services", services), ("Pharmacy", pharmacy), ("Fuel station", fuel_station), ("Wholesale", wholesale),
             ("Construction", lambda: construction(firm, firm_admin)), ("Real estate", lambda: real_estate(firm, firm_admin)), ("Auto parts", auto_parts),
             ("Investor", investor)]
    only = set(sys.argv[1:])
    for name, step in steps:
        if only and name not in only:
            continue
        try:
            log(f"ok    {name}: {step()}")
        except Exception as error:  # noqa: BLE001 — report and carry on
            RUN["failed"].append(f"{name}: {str(error)[:300]}")
            log(f"FAIL  {name}: {error}")
            if not isinstance(error, ApiError):
                traceback.print_exc()
    write_guide()
    log("Done." if not RUN["failed"] else f"Done with {len(RUN['failed'])} failed step(s).")


if __name__ == "__main__":
    main()
