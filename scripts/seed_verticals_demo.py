#!/usr/bin/env python3
"""Add test data for POS phases P2–P8 to the demo company, through the API.

Run scripts/seed_demo.py and scripts/seed_pos_demo.py first. Each section is skipped when its
marker already exists, so a run can be repeated; a section that fails is reported and the rest
still run.

  P2 grocery: weighed bananas (PLU), beer with a bottle deposit and age check, promotion,
     coupon code, loyalty program and card, a Grocery till
  P3 café: "Kafe Pako" with kitchen and bar, floor with tables, menu with modifiers, Restaurant till
  P4 services: "Salloni Bukuria" with services, a package, a membership, a resource and appointments
  P5 hotel: "Hotel Pako" with rooms, a booking, a wedding hall and event, a ticketed concert
  P6 distribution: wholesale price list with tiers, credit-limited customers, sales orders (one
     delivered and invoiced), a van, a route
  P7 specialist: pharmacy (medicines, payer, prescription), fuel station (tanks, nozzles, fleet
     card), auto part with references, webshop channel with orders, agency top-up
  P8 verticals: construction site with BoQ and a progress bill, building with units, a reservation
     and a sale contract, a lease with a rent run

    python3 scripts/seed_verticals_demo.py
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

GOODS, SERVICE = 0, 1
RETAIL, GROCERY, CAFE, RESTAURANT, SERVICES, FORECOURT, SELF_CHECKOUT = range(7)
TRAINING = 0
TRANSFER, DELIVERY, SITE_ISSUE = 1, 6, 7


class ApiError(Exception):
    pass


class Ctx:
    token = ""
    c = ""
    acc = {}
    tax = {}
    user_id = ""


X = Ctx()


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


# ---- Helpers ----

def items_by_name():
    return {i["name"]: i for i in items_of(get("/items?pageSize=1000"))}


def item(name, price=None, *, unit="copë", kind=GOODS, vat="S18", tracked=False, barcode=None, **extra):
    existing = items_by_name().get(name)
    if existing:
        return existing
    created = post("/items", {"name": name, "unit": unit, "type": kind, "defaultTaxDefinitionId": X.tax[vat],
                              "defaultRevenueAccountId": X.acc.get("400100"), "defaultUnitPrice": price,
                              "trackInventory": tracked and kind == GOODS, **extra})
    if barcode:
        post(f"/items/{created['id']}/barcodes", {"barcode": barcode})
    return created


def partner(name, *, customer=True, vendor=False, fiscal=None, **extra):
    existing = next((p for p in items_of(get("/partners?pageSize=1000")) if p["name"] == name), None)
    if existing:
        return existing
    return post("/partners", {"name": name, "isCustomer": customer, "isVendor": vendor,
                              "fiscalNumber": fiscal or f"81{abs(hash(name)) % 10_000_000:07d}", **extra})


def buy(vendor_id, lines, warehouse_id=None, ref=None):
    """lines: (item, quantity, gross unit cost, purchase VAT code)"""
    bill = post("/bills", {
        "partnerId": vendor_id, "vendorReference": ref or f"DEMO-{uuid.uuid4().hex[:8].upper()}",
        "issueDate": (TODAY - timedelta(days=10)).isoformat(), "dueDate": (TODAY + timedelta(days=20)).isoformat(),
        "warehouseId": warehouse_id,
        "lines": [{"description": i["name"], "quantity": q, "unitPrice": cost, "taxDefinitionId": X.tax[v],
                   "expenseAccountId": None, "itemId": i["id"]} for i, q, cost, v in lines]})
    post(f"/bills/{bill['id']}/post")
    return bill


def warehouse(code, name, **extra):
    existing = next((w for w in get("/inventory/warehouses") if w["code"] == code), None)
    return existing or post("/inventory/warehouses", {"code": code, "name": name, "address": None, **extra})


def store(code, name, branch, location, warehouse_id, **extra):
    existing = next((s for s in get("/pos/stores") if s["code"] == code), None)
    return existing or post("/pos/stores", {"code": code, "name": name, "address": None, "fiscalBranchNumber": branch,
                                            "location": location, "warehouseId": warehouse_id, **extra})


def register(store_id, code, name, profile, pos_no):
    existing = next((r for r in get("/pos/registers") if r["code"] == code), None)
    return existing or post("/pos/registers", {"storeId": store_id, "code": code, "name": name, "profile": profile,
                                               "fiscalMode": TRAINING, "fiscalPosNumber": pos_no, "cashAccountId": X.acc["100100"]})


def main_warehouse():
    return next(w for w in get("/inventory/warehouses") if w["isDefault"])["id"]


def demo_vendor():
    return partner("Euro Import Sh.p.k.", customer=False, vendor=True, fiscal="810000100")


def local_utc(day, hour, minute=0):
    """A Kosovo wall-clock time as UTC (CET/CEST, good enough for demo data)."""
    offset = 2 if 3 < day.month < 11 else 1
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc) - timedelta(hours=offset)


# ---- Sections ----

def p2_grocery():
    main = main_warehouse()
    pr1 = next(s for s in get("/pos/stores") if s["code"] == "PR1")
    if any(r["code"] == "PR-K4" for r in get("/pos/registers")):
        return "already there"
    bottle = item("Shishe kthyese (depozitë)", 0.10, vat="SEX")
    banana = item("Banane", 1.29, unit="kg", vat="S08", tracked=True, plu="4011", sellByWeight=True)
    beer = item("Birrë Peja 0,5 L", 0.90, tracked=True, minimumAge=18, depositItemId=bottle["id"], barcode="3830001020015")
    milk = item("Qumësht Vita 1 L", 0.95, vat="S08", tracked=True, barcode="3830001020022")
    buy(demo_vendor()["id"], [(banana, 200, 0.70, "B08"), (beer, 480, 0.50, "B18"), (milk, 240, 0.60, "B08")], main)
    flash = items_by_name().get("USB flash SanDisk 64GB")
    post("/pos/programs", {"name": "Javë e teknologjisë −10%", "kind": 0, "reward": 0, "percent": 10,
                           "itemIds": [flash["id"]] if flash else [], "validFrom": TODAY.isoformat(),
                           "validTo": (TODAY + timedelta(days=14)).isoformat()})
    post("/pos/programs", {"name": "Kupon MIRESEVINI −2 €", "kind": 1, "reward": 1, "amount": 2, "code": "MIRESEVINI",
                           "minAmount": 20})
    post("/pos/programs", {"name": "Pikë besnikërie", "kind": 2, "reward": 0, "pointsPerEuro": 1, "pointValue": 0.01})
    customer = partner("Arben Krasniqi", fiscal="1234500001")
    post("/pos/loyalty-cards", {"number": "LOY-0001", "holderName": "Arben Krasniqi", "phone": "+38344123456", "partnerId": customer["id"]})
    register(pr1["id"], "PR-K4", "Prishtina — Arka ushqimore", GROCERY, 4)
    return "bananas (PLU 4011, by weight), beer with bottle deposit 18+, milk; −10% promo, coupon MIRESEVINI, loyalty card LOY-0001; till PR-K4"


def p3_cafe():
    if any(s["code"] == "CF1" for s in get("/pos/stores")):
        return "already there"
    cafe = store("CF1", "Kafe Pako", 3, "Prishtinë", main_warehouse(), receiptFooter="Faleminderit! Ju presim sërish.")
    kitchen = post("/pos/production-centers", {"name": "Kuzhina", "kind": 0, "storeId": cafe["id"]})
    bar = post("/pos/production-centers", {"name": "Banaku", "kind": 1, "storeId": cafe["id"]})
    menu = {}
    for name, price, center in [("Espresso", 1.00, bar), ("Makiato", 1.20, bar), ("Çaj me limon", 1.00, bar),
                                ("Coca-Cola 0,33 L", 1.50, bar), ("Pizza Margherita", 5.50, kitchen),
                                ("Pizza Capricciosa", 6.50, kitchen), ("Burger me patate", 4.50, kitchen),
                                ("Sallatë Cezar", 4.00, kitchen), ("Tiramisu", 2.50, kitchen)]:
        it = item(name, price, kind=SERVICE)
        put(f"/pos/items/{it['id']}/production-center", {"productionCenterId": center["id"]})
        menu[name] = it
    post("/pos/modifier-groups", {"name": "Ekstra për pica", "minSelect": 0, "maxSelect": 3, "itemIds": [menu["Pizza Margherita"]["id"], menu["Pizza Capricciosa"]["id"]],
                                  "modifiers": [{"id": None, "name": "Djathë ekstra", "priceDelta": 0.5},
                                                {"id": None, "name": "Kërpudha", "priceDelta": 0.5},
                                                {"id": None, "name": "Pa qepë", "priceDelta": 0}]})
    post("/pos/modifier-groups", {"name": "Qumështi", "minSelect": 0, "maxSelect": 1, "itemIds": [menu["Makiato"]["id"]],
                                  "modifiers": [{"id": None, "name": "Qumësht bajameje", "priceDelta": 0.3},
                                                {"id": None, "name": "Pa laktozë", "priceDelta": 0.2}]})
    for floor_name, tables in [("Salla", 6), ("Tarraca", 4)]:
        floor = post("/pos/floors", {"storeId": cafe["id"], "name": floor_name})
        for n in range(tables):
            post("/pos/tables", {"floorId": floor["id"], "name": f"{floor_name[0]}{n + 1}", "seats": 4 if n % 3 else 2,
                                 "shape": n % 2, "x": (n % 3) * 3, "y": (n // 3) * 3})
    register(cafe["id"], "CF-K1", "Kafe — Arka", RESTAURANT, 1)
    return "Kafe Pako: kitchen + bar, 2 floors / 10 tables, 9 menu items with modifiers; till CF-K1"


def p4_services():
    if any(r["code"] == "SB-K1" for r in get("/pos/registers")):
        return "already there"
    if any(s["code"] == "SB1" for s in get("/pos/stores")):
        # An earlier run stopped after the bookings: only the till is missing.
        salon = next(s for s in get("/pos/stores") if s["code"] == "SB1")
        register(salon["id"], "SB-K1", "Salloni — Arka", SERVICES, 1)
        return "finished the earlier run: till SB-K1"
    salon = store("SB1", "Salloni Bukuria", 4, "Prishtinë", main_warehouse())
    haircut = item("Prerje flokësh", 8.00, kind=SERVICE, isBookable=True, durationMinutes=30, bufferMinutes=10)
    massage = item("Masazh 60 min", 25.00, kind=SERVICE, isBookable=True, durationMinutes=60, bufferMinutes=15)
    item("Paketë 10 masazhe", 200.00, kind=SERVICE, vat="SEX", packageServiceItemId=massage["id"], packageSessions=10, packageValidDays=180)
    item("Anëtarësim mujor palestër", 30.00, kind=SERVICE, membershipDays=30)
    hours = [{"day": d, "from": "09:00:00", "to": "17:00:00"} for d in range(6)]
    arta = post("/pos/resources", {"storeId": salon["id"], "name": "Arta (frizere)", "kind": 0, "hours": hours,
                                   "serviceItemIds": [haircut["id"]], "userId": X.user_id, "color": "#e11d48"})
    post("/pos/resources", {"storeId": salon["id"], "name": "Kabina e masazhit", "kind": 1, "hours": hours,
                            "serviceItemIds": [massage["id"]], "color": "#0891b2"})
    day = TODAY + timedelta(days=1)
    while day.weekday() == 6:
        day += timedelta(days=1)
    for hour, name in [(10, "Drita Berisha"), (11, "Blerta Hoxha"), (14, "Fitore Gashi")]:
        post("/pos/appointments", {"storeId": salon["id"], "itemId": haircut["id"], "resourceId": arta["id"],
                                   "start": local_utc(day, hour).isoformat(), "customerName": name, "phone": "+38349000000"})
    try:
        post(f"/pos/stores/{salon['id']}/booking-link", {"enabled": True})
    except ApiError:
        pass
    register(salon["id"], "SB-K1", "Salloni — Arka", SERVICES, 1)
    return f"Salloni Bukuria: haircut/massage, package of 10, gym membership, 2 resources, 3 appointments on {day}; till SB-K1"


def p5_hotel():
    if any(s["code"] == "HP1" for s in get("/pos/stores")):
        return "already there"
    tax = item("Taksë turistike (natë)", 1.00, kind=SERVICE, vat="SEX")
    hotel = store("HP1", "Hotel Pako", 5, "Prishtinë", main_warehouse(), touristTaxItemId=tax["id"])
    double = item("Natë — dhomë dyshe", 60.00, kind=SERVICE, vat="S08")
    single = item("Natë — dhomë teke", 45.00, kind=SERVICE, vat="S08")
    for type_name, capacity, rate, numbers in [("Dhomë dyshe", 2, double, ["101", "102", "103", "201", "202"]),
                                               ("Dhomë teke", 1, single, ["104", "105", "203"])]:
        room_type = post("/pos/room-types", {"storeId": hotel["id"], "name": type_name, "capacity": capacity, "rateItemId": rate["id"]})
        for number in numbers:
            post("/pos/rooms", {"roomTypeId": room_type["id"], "number": number, "floor": number[0]})
    types = {t["name"]: t for t in get(f"/pos/room-types?storeId={hotel['id']}")}
    post("/pos/hotel/bookings", {"storeId": hotel["id"], "roomTypeId": types["Dhomë dyshe"]["id"], "arrival": TODAY.isoformat(),
                                 "departure": (TODAY + timedelta(days=3)).isoformat(), "guestName": "Hans Müller", "adults": 2,
                                 "roomId": types["Dhomë dyshe"]["rooms"][0]["id"], "channel": "Booking.com", "email": "hans@example.de"})
    post("/pos/hotel/bookings", {"storeId": hotel["id"], "roomTypeId": types["Dhomë teke"]["id"],
                                 "arrival": (TODAY + timedelta(days=5)).isoformat(), "departure": (TODAY + timedelta(days=7)).isoformat(),
                                 "guestName": "Elira Morina", "adults": 1, "channel": "Telefon"})
    hall = post("/pos/venues", {"storeId": hotel["id"], "name": "Salla e dasmave", "capacity": 300})
    menu = item("Menu dasme (për person)", 25.00, kind=SERVICE)
    post("/pos/events", {"storeId": hotel["id"], "venueId": hall["id"], "date": (TODAY + timedelta(days=30)).isoformat(),
                         "customerName": "Familja Krasniqi", "guestsEstimated": 220, "from": "18:00:00", "to": "23:59:00",
                         "packageItemId": menu["id"], "pricePerGuest": 25, "phone": "+38344555666",
                         "banquetNotes": "Torta nga klienti; 20 menu vegjetariane"})
    ticket = item("Biletë koncerti — standard", 15.00, kind=SERVICE, vat="S08")
    vip = item("Biletë koncerti — VIP", 35.00, kind=SERVICE, vat="S08")
    post("/pos/ticketed-events", {"storeId": hotel["id"], "name": "Koncert Jazz në Hotel Pako",
                                  "startsAt": local_utc(TODAY + timedelta(days=12), 20).isoformat(), "capacity": 150,
                                  "ticketTypes": [{"itemId": ticket["id"], "quota": 120}, {"itemId": vip["id"], "quota": 30}]})
    register(hotel["id"], "HP-K1", "Hotel — Recepsioni/Bar", RESTAURANT, 1)
    return "Hotel Pako: 8 rooms, 2 bookings (one arriving today), wedding hall + event in 30 days, jazz concert with 2 ticket types; till HP-K1"


def p6_distribution():
    if any(r["name"] == "Prishtina — Veri" for r in get("/distribution/routes")):
        return "already there"
    names = items_by_name()
    flash, hdmi, mouse = names["USB flash SanDisk 64GB"], names["Kabllo HDMI 2 m"], names["Maus pa tel Logitech M185"]
    main = main_warehouse()
    buy(demo_vendor()["id"], [(flash, 200, 5.40, "B18"), (hdmi, 200, 3.50, "B18"), (mouse, 60, 9.80, "B18")], main)
    wholesale = next((l for l in get("/price-lists") if l["name"] == "Shumicë"), None)
    resumed = wholesale is not None
    wholesale = wholesale or post("/price-lists", {"name": "Shumicë", "warehouseId": None, "isCustomerList": True})
    change = None if resumed else post("/price-changes", {"priceListId": wholesale["id"], "date": TODAY.isoformat(), "notes": "Çmimet e shumicës", "lines": [
        {"itemId": flash["id"], "newPrice": 8.50}, {"itemId": flash["id"], "newPrice": 7.90, "minQuantity": 50},
        {"itemId": hdmi["id"], "newPrice": 5.60}, {"itemId": hdmi["id"], "newPrice": 4.90, "minQuantity": 100},
        {"itemId": mouse["id"], "newPrice": 15.90}]})
    if change:
        post(f"/price-changes/{change['id']}/post")
    viva = partner("Market Viva Sh.p.k.", fiscal="810200001", creditLimit=5000, paymentTermDays=30,
                   priceListId=wholesale["id"], overdueBlockDays=30)
    if not viva.get("priceListId"):
        put(f"/partners/{viva['id']}", {**{k: viva.get(k) for k in ("name", "taxNumber", "isCustomer", "isVendor", "fiscalNumber",
                                                                    "isVatRegistered", "receivableAccountId", "payableAccountId")},
                                       "paymentTermDays": 30, "creditLimit": 5000, "priceListId": wholesale["id"], "overdueBlockDays": 30})
    eta = partner("ETC Ferizaj", fiscal="810200002", creditLimit=1500, paymentTermDays=15)

    def order(customer, lines, confirm=True):
        prices = {p["itemId"]: p["price"] for p in call("GET", X.c + "/prices/resolve?" + "&".join(
            [f"itemIds={i['id']}" for i, _ in lines] + [f"quantities={q}" for _, q in lines] + [f"partnerId={customer['id']}"]))}
        so = post("/sales-orders", {"partnerId": customer["id"], "date": TODAY.isoformat(), "warehouseId": main,
                                    "deliveryDate": (TODAY + timedelta(days=2)).isoformat(),
                                    "lines": [{"itemId": i["id"], "quantity": q, "unitPrice": prices.get(i["id"], i.get("defaultUnitPrice") or 0),
                                               "taxDefinitionId": X.tax["S18"]} for i, q in lines]})
        post(f"/sales-orders/{so['id']}/quote")
        if confirm:
            post(f"/sales-orders/{so['id']}/confirm", {})
        return so

    earlier = [o for o in items_of(get(f"/sales-orders?partnerId={viva['id']}")) if o["state"] == 2] if resumed else []
    if earlier:
        # An earlier run confirmed the order and drafted its delivery; post that draft.
        delivered = earlier[-1]
        draft_doc = next(d for d in get(f"/sales-orders/{delivered['id']}")["documents"] if d["kind"] == "delivery")
        post(f"/stock-documents/{draft_doc['id']}/post")
    else:
        delivered = order(viva, [(flash, 60), (hdmi, 40)])
        delivery_id = post(f"/sales-orders/{delivered['id']}/delivery")
        post(f"/stock-documents/{delivery_id}/post")
    draft = get(f"/sales-orders/{delivered['id']}/invoice-draft")
    invoice = post("/invoices", {"partnerId": viva["id"], "issueDate": TODAY.isoformat(), "dueDate": (TODAY + timedelta(days=30)).isoformat(),
                                 "warehouseId": main, "lines": [{"description": l["description"], "quantity": l["quantity"], "unitPrice": l["unitPrice"],
                                                                 "taxDefinitionId": l["taxDefinitionId"], "revenueAccountId": None, "discountPercent": l["discountPercent"],
                                                                 "itemId": l["itemId"], "unitName": l["unitName"], "salesOrderLineId": l["salesOrderLineId"],
                                                                 "deliveryLineId": l["deliveryLineId"]} for l in draft["lines"]]})
    post(f"/invoices/{invoice['id']}/post")
    order(viva, [(mouse, 12), (flash, 20)])
    order(eta, [(hdmi, 25)], confirm=False)

    van = warehouse("VAN1", "Furgoni 1 (01-234-KS)", isVan=True, driverUserId=X.user_id)
    transfer = post("/stock-documents", {"type": TRANSFER, "date": TODAY.isoformat(), "warehouseId": main,
                                         "destinationWarehouseId": van["id"], "notes": "Ngarkim i mëngjesit",
                                         "lines": [{"itemId": flash["id"], "quantity": 30}, {"itemId": hdmi["id"], "quantity": 30}]})
    post(f"/stock-documents/{transfer['id']}/post")
    shops = [viva, eta, partner("Kioska Dardania", fiscal="810200003"), partner("Market Ulpiana", fiscal="810200004")]
    post("/distribution/routes", {"name": "Prishtina — Veri", "userId": X.user_id, "warehouseId": van["id"], "days": 127,
                                  "stops": [{"partnerId": s["id"], "notes": None} for s in shops]})
    return "wholesale list with tiers (USB ≥50 at 7.90), Market Viva (credit 5000, 30-day block): order delivered + invoiced, 1 confirmed, 1 quote; VAN1 loaded; route of 4 shops (any day)"


def p7_specialist():
    if any(s["code"] == "BP1" for s in get("/pos/stores")):
        return "already there"
    main = main_warehouse()
    vendor = demo_vendor()
    # Pharmacy
    pharmacy = store("BP1", "Barnatorja Pako", 6, "Prishtinë", main)
    para = item("Paracetamol 500 mg (20 tableta)", 2.50, vat="S08", tracked=True, barcode="05901234123457",
                atcCode="N02BE01", activeIngredient="Paracetamol", maxRetailPrice=3.00)
    panadol = item("Panadol 500 mg (24 tableta)", 3.20, vat="S08", tracked=True, atcCode="N02BE01", activeIngredient="Paracetamol",
                   maxRetailPrice=3.50)
    amox = item("Amoksicilinë 500 mg (16 kapsula)", 6.80, vat="S08", tracked=True, atcCode="J01CA04", activeIngredient="Amoxicillin",
                isPrescriptionOnly=True, maxRetailPrice=7.50)
    tramadol = item("Tramadol 50 mg (20 kapsula)", 4.90, vat="S08", tracked=True, atcCode="N02AX02", activeIngredient="Tramadol",
                    isPrescriptionOnly=True, isControlled=True)
    buy(vendor["id"], [(para, 200, 1.40, "B08"), (panadol, 100, 1.90, "B08"), (amox, 80, 4.10, "B08"), (tramadol, 40, 2.80, "B08")], main)
    fund = partner("Fondi i Sigurimeve Shëndetësore", fiscal="810300001")
    payer = post("/pos/pharmacy/payers", {"name": "FSSH", "partnerId": fund["id"], "coveragePercent": 80})
    post("/pos/pharmacy/prescriptions", {"storeId": pharmacy["id"], "number": "RX-2026-0001", "issuedOn": TODAY.isoformat(),
                                         "validUntil": (TODAY + timedelta(days=30)).isoformat(), "prescriber": "Dr. Valon Gashi",
                                         "prescriberLicence": "MSH-4411", "patientName": "Besa Krasniqi", "patientPersonalNumber": "1234567890",
                                         "payerId": payer["id"], "lines": [{"itemId": amox["id"], "quantity": 2, "dosage": "1×3 për 7 ditë"},
                                                                          {"itemId": tramadol["id"], "quantity": 1, "dosage": "sipas nevojës"}]})
    register(pharmacy["id"], "BP-K1", "Barnatore — Arka", RETAIL, 1)

    # Fuel station
    station_wh = warehouse("PK", "Pika e karburantit — Rezervuarët")
    station = store("PK1", "Pika e karburantit Pako", 7, "Fushë Kosovë", station_wh["id"])
    diesel = item("Naftë D2", 1.45, unit="litër", tracked=True, sellByWeight=True)
    petrol = item("Benzinë 95", 1.55, unit="litër", tracked=True, sellByWeight=True)
    buy(vendor["id"], [(diesel, 12000, 1.05, "B18"), (petrol, 9000, 1.12, "B18")], station_wh["id"])
    t1 = post("/pos/forecourt/tanks", {"storeId": station["id"], "name": "T1 Naftë", "itemId": diesel["id"], "capacity": 20000})
    t2 = post("/pos/forecourt/tanks", {"storeId": station["id"], "name": "T2 Benzinë", "itemId": petrol["id"], "capacity": 15000})
    for pump, number, tank in [(1, 1, t1), (1, 2, t2), (2, 1, t1), (2, 2, t2)]:
        post("/pos/forecourt/nozzles", {"storeId": station["id"], "pump": pump, "number": number, "tankId": tank["id"]})
    post("/pos/forecourt/dips", {"tankId": t1["id"], "volume": 11980, "water": 0})
    post("/pos/forecourt/dips", {"tankId": t2["id"], "volume": 8995, "water": 0})
    transport = partner("Transport Kosova Sh.p.k.", fiscal="810300002")
    post("/pos/forecourt/fleet-cards", {"number": "FC-1001", "partnerId": transport["id"], "vehiclePlate": "01-123-AB",
                                        "driverName": "Driton Hoti", "limitPerFill": 300})
    post("/pos/forecourt/fleet-cards", {"number": "FC-1002", "partnerId": transport["id"], "vehiclePlate": "01-456-CD", "limitPerFill": 250})
    register(station["id"], "PK-K1", "Pika e karburantit — Arka", FORECOURT, 1)

    # Auto part
    filter_ = item("Filtër vaji Bosch P 3243", 9.90, tracked=True, barcode="4047023004335")
    buy(vendor["id"], [(filter_, 30, 5.20, "B18")], main)
    put(f"/parts/{filter_['id']}", {"references": [{"brand": "Bosch", "number": "0 451 103 243"}, {"brand": "VW", "number": "03C 115 561 H"},
                                                   {"brand": "Mann", "number": "W 712/94"}],
                                    "fitments": [{"make": "Volkswagen", "model": "Golf", "yearFrom": 2008, "yearTo": 2013, "engine": "1.4 TSI"},
                                                 {"make": "Škoda", "model": "Octavia", "yearFrom": 2008, "yearTo": 2013, "engine": "1.4 TSI"}]})

    # Online channel with two orders
    pr1 = next(s for s in get("/pos/stores") if s["code"] == "PR1")
    channel = post("/pos/channels", {"storeId": pr1["id"], "name": "Webshop pako.shop", "kind": 0})
    names = items_by_name()
    courier = partner("Postakos Sh.p.k.", fiscal="810300003")
    for ref, fulfilment, payment, customer, lines in [
        ("SHOP-1001", 0, 0, "Dren Berisha", [(names["Kufje Sony WH-CH520"], 1, 54.90)]),
        ("SHOP-1002", 1, 1, "Liridona Shala", [(names["Maus pa tel Logitech M185"], 2, 17.90), (names["Kabllo HDMI 2 m"], 1, 6.50)]),
    ]:
        call("POST", f"/api/public/channel/{channel['token']}/orders", {
            "externalRef": ref, "customerName": customer, "fulfilment": fulfilment, "payment": payment, "phone": "+38344111222",
            "address": "Rr. Remzi Ademaj 5" if fulfilment else None, "city": "Prizren" if fulfilment else None,
            "shippingFee": 2.5 if fulfilment else 0,
            "lines": [{"itemId": i["id"], "quantity": q, "unitPrice": p} for i, q, p in lines]})
    cod = next(o for o in items_of(get("/pos/channel-orders")) if o["externalRef"] == "SHOP-1002")
    post(f"/pos/channel-orders/{cod['id']}/state", {"state": 1})
    post(f"/pos/channel-orders/{cod['id']}/state", {"state": 2, "courierPartnerId": courier["id"], "trackingNumber": "PK-778812"})

    # Agency item
    vala = partner("Vala (Telekomi i Kosovës)", customer=False, vendor=True, fiscal="810300004")
    item("Mbushje Vala 10 €", 10.00, kind=SERVICE, vat="SEX", agencyPartnerId=vala["id"], agencyCommissionPercent=5)
    return ("pharmacy BP1 (4 medicines, FSSH 80%, prescription RX-2026-0001), fuel station PK1 (diesel/petrol, 2 tanks, 4 nozzles, "
            "fleet cards FC-1001/1002), Bosch oil filter with refs, webshop with 2 orders (one COD ready for courier), Vala top-up")


def p8_verticals():
    if any(s["name"].startswith("Shtëpia Gashi") for s in get("/construction/sites")):
        return "already there"
    main = main_warehouse()
    vendor = demo_vendor()
    works = item("Punë ndërtimore (situacion)", None, kind=SERVICE)
    cement = item("Çimento 50 kg", 6.50, unit="thes", tracked=True)
    blocks = item("Bllok betoni 20 cm", 0.95, tracked=True)
    buy(vendor["id"], [(cement, 400, 4.80, "B18"), (blocks, 3000, 0.60, "B18")], main)
    client = partner("Investitori Gashi", fiscal="1234500002")
    site = post("/construction/sites", {
        "name": "Shtëpia Gashi — Fushë Kosovë", "clientPartnerId": client["id"], "contractValue": 85000, "retentionPercent": 5,
        "billingItemId": works["id"], "projectCode": "KANT-001", "address": "Fushë Kosovë", "startDate": (TODAY - timedelta(days=60)).isoformat(),
        "endDate": (TODAY + timedelta(days=180)).isoformat(), "state": 1,
        "costCodes": [{"code": "01", "name": "Themelet", "budget": 15000}, {"code": "02", "name": "Konstruksioni", "budget": 30000},
                      {"code": "03", "name": "Muratura", "budget": 12000}, {"code": "04", "name": "Instalimet", "budget": 10000}],
        "boq": [{"code": "1.1", "description": "Gërmim dheu", "unit": "m³", "quantity": 400, "unitPrice": 8},
                {"code": "1.2", "description": "Betonim themelesh C25/30", "unit": "m³", "quantity": 120, "unitPrice": 95},
                {"code": "2.1", "description": "Betonim pllakash", "unit": "m³", "quantity": 180, "unitPrice": 110},
                {"code": "3.1", "description": "Mure me bllok 20 cm", "unit": "m²", "quantity": 900, "unitPrice": 18},
                {"code": "4.1", "description": "Instalime elektrike", "unit": "paushall", "quantity": 1, "unitPrice": 9200}]})
    codes = {c["code"]: c["id"] for c in site["costCodes"]}
    boq = {b["code"]: b["id"] for b in site["boq"]}
    issue = post("/stock-documents", {"type": SITE_ISSUE, "date": TODAY.isoformat(), "warehouseId": main, "siteId": site["id"],
                                      "lines": [{"itemId": cement["id"], "quantity": 150, "costCodeId": codes["01"]},
                                                {"itemId": blocks["id"], "quantity": 1200, "costCodeId": codes["03"]}]})
    post(f"/stock-documents/{issue['id']}/post")
    sub = partner("Elektro Shpk (nënkontraktor)", customer=False, vendor=True, fiscal="810400001")
    bill = post("/bills", {"partnerId": sub["id"], "vendorReference": "EL-77", "issueDate": TODAY.isoformat(),
                           "dueDate": (TODAY + timedelta(days=30)).isoformat(), "projectId": site["projectId"],
                           "lines": [{"description": "Instalime faza 1", "quantity": 1, "unitPrice": 4720, "taxDefinitionId": X.tax["B18"],
                                      "expenseAccountId": None, "costCodeId": codes["04"]}]})
    post(f"/bills/{bill['id']}/post")
    pb = post(f"/construction/sites/{site['id']}/progress-bills", {"periodTo": TODAY.isoformat(), "lines": [
        {"boqLineId": boq["1.1"], "cumulativeQuantity": 400}, {"boqLineId": boq["1.2"], "cumulativeQuantity": 120},
        {"boqLineId": boq["2.1"], "cumulativeQuantity": 60}]})
    post(f"/construction/progress-bills/{pb['id']}/approve")
    post(f"/construction/progress-bills/{pb['id']}/invoice")

    # Real estate
    sale_item = item("Shitje e njësisë banesore", None, kind=SERVICE)
    building = post("/real-estate/buildings", {"name": "Kulla A — Arbëria", "saleItemId": sale_item["id"], "projectCode": "NDR-A",
                                               "address": "Lagjja Arbëria, Prishtinë"})
    units = {}
    for number, floor, kind, area, price in [("A-101", "1", 0, 62, 74400), ("A-102", "1", 0, 85, 102000), ("A-201", "2", 0, 62, 75600),
                                             ("A-202", "2", 0, 85, 103700), ("A-301", "3", 0, 110, 137500), ("L-01", "0", 1, 70, 140000),
                                             ("P-01", "-1", 3, 14, 9000), ("P-02", "-1", 3, 14, 9000)]:
        units[number] = post("/real-estate/units", {"buildingId": building["id"], "number": number, "floor": floor, "kind": kind,
                                                    "area": area, "listPrice": price})
    buyer = partner("Agron Berisha", fiscal="1234500003")
    other = partner("Vjosa Hasani", fiscal="1234500004")
    landowner = partner("Fisi Kelmendi (pronarët e tokës)", fiscal="1234500005")
    post("/real-estate/reservations", {"unitId": units["A-102"]["id"], "partnerId": other["id"], "date": TODAY.isoformat(),
                                       "expiresOn": (TODAY + timedelta(days=14)).isoformat(), "deposit": 2000})
    contract = post("/real-estate/contracts", {"unitId": units["A-101"]["id"], "buyerPartnerId": buyer["id"], "contractDate": TODAY.isoformat(),
                                               "price": 74400, "downPayment": 14400, "installmentCount": 12})
    post(f"/real-estate/contracts/{contract['id']}/invoice", {"installmentIds": [contract["installments"][0]["id"]]})
    post("/real-estate/contracts", {"unitId": units["A-301"]["id"], "buyerPartnerId": landowner["id"], "contractDate": TODAY.isoformat(),
                                    "price": 137500, "kind": 1, "installments": [{"dueDate": TODAY.isoformat(), "amount": 137500}],
                                    "notes": "Kompensim për parcelën 1234/5"})

    # Rental
    rent_item = item("Qira lokali afarist", None, kind=SERVICE)
    power = item("Energji elektrike (kWh)", 0.12, unit="kWh", kind=SERVICE)
    tenant = partner("Kafeneja Te Kulla Sh.p.k.", fiscal="810400002")
    lease = post("/rentals/leases", {"tenantPartnerId": tenant["id"], "startDate": TODAY.replace(day=1).isoformat(), "rent": 1200,
                                     "rentItemId": rent_item["id"], "unitId": units["L-01"]["id"], "dueDay": 5, "deposit": 2400,
                                     "depositReceivedOn": TODAY.replace(day=1).isoformat(),
                                     "meters": [{"name": "Rryma", "itemId": power["id"], "lastReading": 15230}]})
    post(f"/rentals/leases/{lease['id']}/activate")
    post(f"/rentals/leases/{lease['id']}/meters/{lease['meters'][0]['id']}/reading", {"reading": 16110})
    post("/rentals/leases", {"tenantPartnerId": partner("Studio Dental Smile", fiscal="810400003")["id"],
                             "startDate": (TODAY + timedelta(days=15)).isoformat(), "rent": 650, "rentItemId": rent_item["id"],
                             "property": "Zyrë, Rr. UÇK 40, kati 2", "dueDay": 10, "deposit": 1300})
    post("/rentals/run", {"month": TODAY.replace(day=1).isoformat()})
    return ("site KANT-001 (BoQ 85k, materials issued, subcontractor bill, progress bill 1 invoiced as draft), building NDR-A "
            "(8 units, A-102 reserved, A-101 sold on 12 installments, A-301 compensation), lease on L-01 with meter + this month's rent run")


def main():
    log(f"Seeding P2–P8 demo data against {API}")
    X.token = call("POST", "/api/auth/login", {"email": DEMO_EMAIL, "password": DEMO_PASSWORD})["token"]
    payload = X.token.split(".")[1]
    X.user_id = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]
    company = next((c for c in call("GET", "/api/companies") if c["name"] == COMPANY_NAME), None)
    if company is None:
        sys.exit(f"'{COMPANY_NAME}' not found; run scripts/seed_demo.py and scripts/seed_pos_demo.py first.")
    X.c = f"/api/companies/{company['id']}"
    X.acc = {a["code"]: a["id"] for a in items_of(get("/accounts"))}
    X.tax = {t.get("code"): t["id"] for t in get("/taxes")}
    failed = 0
    for name, section in [("P2 grocery", p2_grocery), ("P3 café", p3_cafe), ("P4 services", p4_services), ("P5 hotel", p5_hotel),
                          ("P6 distribution", p6_distribution), ("P7 specialist", p7_specialist), ("P8 verticals", p8_verticals)]:
        try:
            log(f"ok    {name}: {section()}")
        except Exception as error:  # noqa: BLE001 — report and carry on with the next section
            failed += 1
            log(f"FAIL  {name}: {error}")
            if not isinstance(error, ApiError):
                traceback.print_exc()
    log("Done." if not failed else f"Done with {failed} failed section(s).")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
