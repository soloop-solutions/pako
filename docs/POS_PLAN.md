# PAKO Point of Sale — analysis and master plan

Status: **analysis and master plan, 2026-10-31. Nothing in this document is built yet.**
Decisions are proposed in §10 and need sign-off; open legal points are listed in §16.

Sources: four research passes on 31 Oct 2026 —
(1) Kosovo law, read from primary texts (Law 08/L-257 on Tax Procedure, AI MF 01/2026, VAT
Law 05/L-037, Consumer Protection Law 06/L-034) and ATK's official fiscalization samples on GitHub;
(2) a feature and data-model study of Odoo POS 17–19, Square, Lightspeed R/X/K, Toast, Shopify POS,
Loyverse, Clover, Zoho POS and the Balkan certified fiscal software;
(3) requirements per business type;
(4) a map of what PAKO already has. Each claim carries a confidence mark where it matters:
**[LAW]** read in the legal text, **[ATK]** ATK's own technical samples or portal, **[MARKET]**
vendor documentation or reviews, **[VERIFY]** thin or conflicting source — confirm before relying
on it.

---

## Contents

1. Summary
2. The legal frame: fiscalization in Kosovo after AI 01/2026
3. Other law a POS must obey (VAT, cash limit, consumer protection, data, metrology)
4. The market: competitors and the certified-SEF field
5. What good POS products do — feature study
6. Requirements by business type
7. What PAKO already has
8. The shared core every business needs
9. Vertical packs and business-type presets
10. Decisions
11. Architecture
12. Data model
13. Accounting and stock
14. Fiscal flows in detail
15. Phases and build order
16. Open questions to verify before building
17. Risks
18. Commercial notes

---

## 1. Summary

- **A POS in Kosovo is a fiscal device.** Since AI MF 01/2026, every supply to a final consumer —
  regardless of payment method, size of business or VAT registration — needs a fiscal coupon
  [LAW AI Art. 5, 31]. A coupon is valid only if it comes from a certified fiscal device (PEF/SF)
  or **certified Electronic Fiscal Software (SEF)** listed in ATK's public register [LAW Art. 35].
  PAKO cannot ship a POS that "just prints receipts".
- **The route is SEF, and PAKO should certify itself.** SEF is pure software on a PC, tablet or
  phone [LAW Art. 32(4)]: each coupon is signed (ECDSA P-256 over a Protobuf payload), carries a QR
  code and a unique number (NUIKF), and is sent to ATK in real time, with an offline queue and a 48-hour
  catch-up rule [ATK GitHub; LAW Art. 32(3), 44]. One certificate per point of sale; the private key
  never leaves the machine [LAW Art. 34]. 31 products were certified by 31 Oct 2026 — including
  FINABIT, KUBIT and ProData, PAKO's direct competitors [ATK register]. Without its own certification
  PAKO cannot compete with them on the till.
- **PAKO's advantage is the books.** Every competitor except Odoo and Zoho posts to accounting
  through brittle sync or not at all; QuickBooks closed its desktop POS in 2023 rather than keep
  up. PAKO already has the ledger, VAT books, stock with average cost, lots, units, price lists,
  purchasing and payroll. A POS that closes the day straight into the ledger, the VAT return and
  stock — for every business type — is the product.
- **One POS, many shapes.** Square (2025) and Odoo converged on one catalogue, one order model and
  one fiscal layer, with a **profile per register** that turns on what a business type needs
  (tables and kitchen for a restaurant, scales and promotions for a market, appointments for a
  salon). PAKO should do the same rather than build separate products. §9 lists 27 vertical packs
  and 10 presets.
- **Build order:** fiscal + offline + accounting core first (nothing ships without compliant
  coupons), then the retail/grocery pack, then hospitality, then services, then the rest.
  Construction, real estate and property rental are **ERP modules that use the POS rarely**; they
  are planned here because the brief asked for them, but they are separate projects (§15 P8).

---

## 2. The legal frame: fiscalization in Kosovo after AI 01/2026

### 2.1 Instruments

| Instrument | Status |
|---|---|
| **Law No. 08/L-257 on Tax Procedure Administration** (GZK 12 Jan 2024): Art. 6 (records, coupons, cash limits, retention), Art. 7 (fiscal device operators), Art. 101 and 106 (fines, closures) | In force [LAW] |
| **AI (MF) No. 01/2026** on Electronic Fiscal Devices (PEF), Fiscal Systems (SF) and Electronic Fiscal Software (SEF); legal basis Law 08/L-257 Art. 7(5), 121; in force on GZK publication (reported 14 May 2026) | In force [LAW; date VERIFY] |
| AI MF 02/2018 on fiscal devices | Repealed by AI 01/2026 Art. 51 [LAW] |
| AI (MFPT) 01/2025 | Annulled by the Supreme Court (P.A.Nr. 09/2025, July 2025) — the first attempt at this reform [LAW] |
| ATK technical documents: "Kërkesat specifike teknike dhe funksionale për PEF/SF/SEF" (01.06.2026), certification conditions, unit/category code list (notice 29.09.2026) | In force by Director-General decision; **image-only PDFs, not yet read** [VERIFY] |
| ATK fiscalization samples `github.com/fiskalizimi/pos-golang`, `pos-csharp` (linked from the SEF portal) | Official integration reference [ATK] |
| B2B e-invoicing mandate | **None** in Kosovo for 2026. "SEF" in Kosovo means fiscal *software* for receipts, not e-invoicing [VERIFY] |

### 2.2 Who must issue fiscal coupons

- Everyone supplying goods or services to the **final consumer**, whatever the payment method
  (cash, card, transfer) [LAW AI Art. 5(1)]; free or complimentary supplies too [Art. 5(2)].
- A business buying for its own use counts as a final consumer [Art. 4(1.7)].
- Supplies to businesses use a **tax invoice** instead [Art. 5(3)]; B2B-only sellers are exempt
  from SEF [Art. 31(5)]; mixed sellers fiscalize every consumer transaction [Art. 31(6)].
- **No turnover threshold**: businesses under the €30,000 VAT threshold are covered [LAW, by absence].
- Exempt from PEF: utilities, telecoms, banks, metered billing, some cultural institutions
  [Art. 8(2)]; the Minister may exempt more [Art. 5(4), 8(5), 31(7)].

### 2.3 What SEF must do (AI Chapter IV)

| Requirement | Article |
|---|---|
| Sign every coupon electronically; identify with a digital certificate; HTTPS to ATK; generate and send the coupon with a QR code; print in ATK's format; support upgrades; ATK message format; official languages | 32(2) |
| Keep issuing when ATK is unreachable, store securely, **send automatically** on reconnection | 32(3) |
| Runs on PC, laptop, tablet or smartphone | 32(4) |
| **One digital certificate per SEF installation at each point of sale**; private key generated by the taxpayer and kept securely; registration data: NUI/fiscal number, unit (branch) number, POS number, software code, and the **Fiscalization Number** from ATK's EDI ("Kërkesë për Fiskalizim", live since 9 Jul 2026) | 34 |
| Developer and maintainer certified by an ATK Commission (decision within 15 working days); software may be sold/installed **only after certification**; the SEF code and developer NUI are embedded and sent with every fiscalization; taxpayer and developer **jointly responsible** | 35 |
| Certificate revocable for serious problems or breaches; appeal to ATK complaints commission | 36 |
| Testing against ATK's test environment and methodology | 31(2–3) |
| Vending machines: real-time fiscalization, QR sticker, 48 h catch-up after outages; fuel, car-wash and EV-charging machines must print | 38 |
| Paper coupon by default; **electronic delivery** allowed for app/online sales and for non-cash payments **with the buyer's consent** | 39(1–2) |
| **QR code on every coupon, even when it could not be fiscalized** (offline) | 39(3–4) |
| NUIKF (unique coupon number) generated by the software in ATK's format | 39(5) |
| Public notice of the duty to issue and take the coupon at each payment point | 40 |
| Buyer keeps the coupon until 30 m from the premises | 41 |
| Citizen verification by QR or NUIKF in ATK's app/web; complaints via "Denonco" | 42 |
| Corrective coupons follow the same rules and **reference the original**; a correction not registered within 48 h is a problem case | 42(7–8), 43 |
| Data protection applies to fiscalization | 48 |
| Fines of Law 08/L-257 apply accordingly | 49 |

### 2.4 The protocol (from ATK's official samples)

- Two payloads, both Protobuf:
  - **CitizenCoupon** (goes into the QR): BusinessId, PosId, BranchId, CouponId, Type, Time, Total,
    TaxGroups, TotalTax, TotalNoTax.
  - **PosCoupon** (full detail): adds Location, OperatorId, ApplicationId, ReferenceNo,
    VerificationNo (≤ 16 chars), Items (name, unit, qty, price, total, tax letter, type), Payments.
  - The two must agree, or ATK marks the coupon **FAILED VERIFICATION**.
- Encoding and signing: Protobuf → Base64 → SHA-256 → **ECDSA P-256**. QR content:
  `base64(citizenCoupon)|base64(signature)`.
- Endpoints: production `https://fiskalizimi.atk-ks.org`, test `fiskalizimi-test.atk-ks.org`.
  Certificate onboarding: `/ca/verify/{nui}` then a CSR to `/ca/signcsr` with C=RKS, O=BusinessId,
  OU=PosId, L=BranchId. Coupons: `/citizen/coupon` and `/pos/coupon`.
- **Coupon types: SALE = 1, CANCEL = 2, RETURN = 3.** CANCEL and RETURN require ReferenceNo (the
  original CouponId) or they are rejected.
- **Tax letters: A = exempt, C = 0 %, D = 8 %, E = 18 %** (B unused) [ATK; AI Art. 29(1.2)].
- Payment types: Cash, Card, Voucher, Cheque, Crypto, Other.
- Amounts: item prices in units of €0.0001, totals in cents. **CouponId is unique across the
  whole business, all branches.**

### 2.5 Mandatory coupon content (AI Art. 7(2), "at least")

NUI / fiscal number · VAT number (if registered) · name · address · **operator (cashier) name and
ID** · per item: quantity, unit price, name, line value, **VAT letter** · item discount/surcharge
with a minus sign · subtotal and subtotal discount/surcharge · total · **amount per payment method**
(cash, credit card, debit card, bank, voucher, cheque, SMS…) · tax per rate · total without tax ·
date, hour, minute · device/SEF ID · **daily coupon number** · **QR code** · **NUIKF** · "RKS" logo ·
**coupon type** (regular, cancellation, return…) · free text. Missing NUI/fiscal number on coupons
is fined €150–2,000 by turnover band [LAW 08/L-257 Art. 101(2)]. The coupon is issued **at
payment**, at an advance payment, or at supply when payment is deferred [AI Art. 6].

### 2.6 Corrections, reports, offline, retention

- **Before printing**, items can be removed from the coupon. **After printing**, only a return or
  cancellation coupon referencing the original [AI Art. 11(8), 43]. No deletion — "zappers" and
  suppression are criminal [LAW 08/L-257 Art. 106(3)].
- **X/Z reports** are statutory for PEF (X = statistics, Z = daily fiscal close, transmitted)
  [AI Art. 27–28]. For SEF the AI does not require a Z report, because every coupon is reported
  in real time; whether the ATK technical spec requires one is **[VERIFY]**. Every certified SEF
  ships daily X/Z-style reports anyway [MARKET], and PAKO will too.
- **Internet outage** [AI Art. 44]: offline coupons carry the full content and QR; all must reach
  ATK **within 48 h** of the outage start (then they count as correctly fiscalized); if
  impossible, notify ATK with evidence and keep issuing; anything still unsent by the **10th of
  the following month** is submitted then.
- **Total device failure** [Art. 45]: issue coupons from a pre-numbered, ATK-fiscalized paper
  block (original + copy); restore or replace the device within **48 h**; enter every block coupon
  into SEF **within 5 days**.
- **Retention**: records 6 years after the tax period; **electronic services 10 years**
  [LAW 08/L-257 Art. 6(3)]. Year-end stock count available by 10 January [Art. 6(5)].
- **Enforcement** for not issuing coupons: banded fines; 3 penalties in a year close the point of
  sale for 7 days, 4 for 15 days [Art. 101(6–7)].

### 2.7 Transition

- Existing PEF/SF (hardware) users keep using it until a **Minister of Finance decision** moves
  them to SEF [AI Art. 50(1)]; none published by 31 Oct 2026 [VERIFY].
- Obliged taxpayers with **no** PEF on the entry-into-force date must install SEF **within 60
  days**, using ATK-fiscalized coupon books until then [Art. 50(2)].
- Hardware route rules still matter for customers who stay on it: where POS software drives a
  fiscal printer, installer, user and software vendor give ATK **written confirmation of
  compliance** [Art. 14]; devices older than 5 years and unsupported may not be used [17(4)];
  inspection every 24 months [24(10)].

---

## 3. Other law a POS must obey

### 3.1 VAT [LAW 05/L-037]

- Rates: **18 %** standard; **8 %** for non-bottled water, electricity, heating, waste collection,
  grains and grain products (flour, pasta, **bread**), cooking oil, **dairy**, salt, **eggs**,
  textbooks and books, **IT equipment**, **medicines and medical devices**, aids for the disabled,
  children's car seats [Art. 26(2)]. Live animals may also be 8 % after amendments [VERIFY];
  "fruit and vegetables at 8 %" is **not** in the statute [VERIFY, probably wrong].
- **Restaurants and food service: 18 %** (the temporary 8 % ended 1 Jan 2022) [MARKET].
- **Bakery ambiguity**: bread is 8 %; pastries, burek and cakes are unclear [VERIFY with ATK].
- Residential housing and land: exempt; commercial lease: taxable [MARKET].
- Registration mandatory above **€30,000** turnover [Art. 6]; non-VAT sellers still issue coupons,
  probably with letter A [VERIFY].
- **Simplified invoice** required for supplies **≥ €500** or when a non-taxable business buyer asks
  [Art. 49(1)]; full B2B invoice content [Art. 45], issued by the 15th of the following month
  [Art. 44(4)].
- PAKO's VAT codes already cover S18/S08/S00/SEX/SEXP etc.; the POS maps them to letters
  A/C/D/E. **Note:** `TaxDefinition.Rate` is a fraction (0.18) while the legacy fiscal bridge
  expects whole percentages — the mapping must be explicit, not a pass-through.

### 3.2 Cash limits

- **B2C: transactions over €2,000** with an individual must go through a bank or electronic
  payment; splitting to get around it is prohibited (Law 08/L-257 Art. 6(11), Minister decision
  19/2026, effective **1 Jun 2026**) [LAW].
- **B2B: €300** per the law text on ATK's portal, with a €100 rule for part-cash/part-offset
  (Art. 6(9–10)); news of 9 Oct 2026 speaks of a cut from €500 to €300 [VERIFY which applies].
- Fines by turnover band (Art. 101(9)). The POS must count the **whole deal**, including layaways,
  installments, deposits and split tenders.

### 3.3 Consumer protection [LAW 06/L-034]

- Price **and unit price** (per kg / l / m / m² / m³) on every product, **VAT-inclusive**; the price
  paid must equal the price shown [Art. 26]. Unpackaged goods weighed in front of the customer:
  unit price only [26(3), (10)]. Services: visible price list [27]; kiosks: price list [28].
- Promotions: "Action"/"Discount" labels, **old price next to new**, provable percentages, no
  discounting expired goods, seasonal sales ≤ 3 per year, ≤ 60 days [Art. 32–36] — the POS must keep
  price history.
- Exact change including small coins [Art. 56] — **no cash rounding**.
- A clear invoice or fiscal coupon for every sale [Art. 57].
- **No general right of return** for in-store purchases; 14-day withdrawal applies only to distance
  and off-premises contracts [Art. 42–49]; defective goods: 2-year liability, notify within 2 months,
  presumption within 6 months [Art. 78–81]. Returns policy is the shop's choice; the POS supports
  it but does not impose it.
- Age restriction for alcohol and tobacco (under-18), ID can be demanded [Art. 15; fine
  €1,000–10,000].
- No card surcharge above the actual cost of the payment method [Art. 52].

### 3.4 Data protection [LAW 06/L-082, GDPR-based]

Separate, demonstrable consent for loyalty and marketing; objection honoured within 8 days; breach
notification to AIP within 72 h; retention only as long as necessary; EU/EEA/UK adequate for
hosting; fines €20,000–40,000 or up to 2 % of turnover [VERIFY article numbers].

### 3.5 Metrology, excise, sector rules

- Scales used for trade are legally controlled instruments: initial and periodic verification by
  the Kosovo Metrology Agency (Law 06/L-037 on metrology; NAWI Regulation 04/2018) [MARKET].
- Barcodes: Kosovo is GS1 member with prefix **381** (since 2023); in-store prefixes **20–29**
  (weight/price-embedded) are defined locally and differ by scale and chain → configurable parser.
- Excise (alcohol, tobacco, fuel) is paid at import/production; the POS charges VAT on the
  excise-inclusive price and needs age flags and margin reporting.
- Pharmacies: 8 % medicines; official maximum prices since 1 Feb 2025 → price caps.
- Fuel: dispensers are controlled instruments; special fiscal systems for dispensers
  [AI Art. 9(1.2.2.1)]; self-service pumps print coupons [Art. 38(8)].
- Deposit-return system (PET, cans, glass) legislated with a 5–10 cent deposit from 1 Jan 2025
  [VERIFY actual roll-out] — deposits are outside VAT turnover.
- Pristina accommodation tax €1 per person per night (2026 draft) [VERIFY].
- Construction: domestic reverse charge possible (VAT Art. 52(1.4)), mostly B2B invoices.

---

## 4. The market

### 4.1 Certified SEF register (ATK, 31 Oct 2026) — 31 products

ProData Finance+ (01.07) · KUBIT (07.07) · KontX · easyPos Desktop · BarTree · EXPERT (ALBTRIX) ·
Kendrix POS · Kuleta Terminal · DataView/Pos · **FINABIT** (15.09) · Rikont FiscalListener ·
LRPos · Zen365 POS · Expert Pro · T3Next POS · easyPos Mobile · SEF Connect · AZKONT ·
Proxnova POS · SEF InfoKON · BarX · Probooks · FiskPro · Kuleta SEF · Bills Cloud/Hibrid · Taxon ·
PROGRAMERI POS · ShariX SEF+ · NovaSEF · POSTOM · BeProg Sef. Plus an Odoo 19 Kosovo
fiscalization app (€4,860, not in the register).

**Reading of the field.** Most are Windows desktop, a few cloud or mobile. Several are accounting
packages (FINABIT, ProData, KUBIT, Probooks, AZKONT) — PAKO's competitors. Bridge products (SEF
Connect, Rikont FiscalListener) let other ERPs push sales into a certified SEF. Typical features:
touch/barcode sales, Albanian/Serbian/English, OFFLINE-marked coupons with auto-send, returns
linked to the original, cashier and payment reports with VAT per rate, Excel export, 58/80 mm
printing. **Price anchor: NovaSEF €19 per register per month, €6 per extra register, €40 setup,
or €180 a year.**

### 4.2 International reference products (detail in §5)

Odoo POS (closest architecture: ERP-embedded, session-based posting), Square (one app with modes
per vertical), Lightspeed (separate retail and restaurant platforms — a cautionary tale), Toast
(restaurant depth), Shopify POS (omnichannel), Loyverse (free, small cafés), Clover (hardware
plans), Zoho POS (an accounting vendor's native POS — PAKO's nearest analogue), **QuickBooks POS
(discontinued 2023)**. Regional: easyPos.al (Albania), Serbian ESIR/PFR fiscal model, North
Macedonian hardware model.

### 4.3 Where PAKO can win

1. **Native accounting** — the day closes into the ledger, VAT books and stock with no sync.
2. **Cloud + resilient offline** where most local SEFs are Windows desktop.
3. **Every business type on one platform**, with presets — local competitors are mostly retail or
   hospitality only.
4. **Accountant-firm distribution** — PAKO's firm/multi-company model means accountants can roll the
   POS out to all their clients and see the result in the books the same day.
5. Transparent per-register pricing in the local range.

---

## 5. What good POS products do — feature study

### 5.1 Patterns worth copying

| From | Pattern | Use in PAKO |
|---|---|---|
| Odoo | `pos.config` (register) → `pos.session` (opening control → opened → closing control → closed) → `pos.order` / lines / `pos.payment` per tender; **one aggregated journal entry per session** (sales by account and tax, receivables per payment method, closing difference), invoiced orders get their own entry; stock in real time or at session close | Register / Session / Order / Payment model; session posting (§13) |
| Odoo | One **loyalty program** model — rules (triggers) + rewards (product, discount) — covering coupons, promotions, buy-X-get-Y, loyalty cards, gift cards, eWallet, next-order coupons | Single Programs engine (§12.6) |
| Odoo 19 | **Presets** — dine-in / takeaway / delivery each set price list, tax position, printing | Order presets |
| Odoo | Preparation display with stages, timers, customer "ready" screen | KDS (P4) |
| Toast | Modifier groups with min/max and required/optional; **pre-modifiers** (no / extra / on side); routing to prep stations with a **routing preview** before going live | Modifiers, routing, preview |
| Lightspeed | Cash movement types: **float / to bank / petty cash in-out**; expected amount computed **per tender**; closure pushed to accounting | Cash movements; per-tender closing |
| Square | **Offline card payments** with a merchant-set cap and an upload deadline | Offline limits per tender |
| Square 2025 | One app, one catalogue, **modes** per vertical (quick service, full service, bar, retail, appointments, services) | Register profiles (§9) |
| Shopify | POS roles (named permission sets) and **inline manager approval** per action; location-wide view of register sessions; returns and exchanges at any location | Permissions; supervisor screen |
| Loyverse | Free KDS and customer display apps; **predefined tickets** as a light alternative to a floor plan | Light café profile |
| easyPos.al | Waiter handover of tables; summary invoice across orders; exports in local accountants' formats | Hospitality; B2B summary invoice |
| Serbia ESIR | Fiscal document = **type** (Normal, Advance, Copy, Proforma, **Training**) × **transaction** (Sale, Refund); refunds reference the original | Fiscal document model incl. training mode |

### 5.2 Table-stakes features (every serious POS has these)

Session/shift with opening float; cash in/out with reasons; blind count per tender with variance;
statutory X/Z; fast sales screen (favourites, categories, search, barcode-first, keypad, park and
recall, line notes, keyboard-only operation); multiple barcodes, PLU, weight/price-embedded EAN-13,
connected scales; variants; modifiers; price lists and permission-capped discounts; split tender,
change, gift card/voucher, on-account; returns linked to the original with reason and restock
choice; quick customer lookup and VAT number for B2B; stock relief with negative-stock policy and
recipes; automatic accounting with card clearing and cash over/short; offline with visible queue;
PIN/badge login, roles, manager override and audit log; ESC/POS printers 58/80 mm, drawer, HID
scanner, scale, customer display, kitchen printers; multi-store central catalogue and pricing;
sales/tax/margin reports.

### 5.3 What users complain about (and PAKO's answer)

| Complaint | Who | PAKO answer |
|---|---|---|
| Fund holds, processor lock-in, long contracts, fee rises | Square, Toast, Clover, Lightspeed | Processor-agnostic: Kosovo merchants use bank terminals (ProCredit, TEB, Raiffeisen, NLB…) and SoftPOS (RaiPOS); the card terminal is a tender with optional integration |
| Hardware that runs only the vendor's software | Toast, Clover | Generic ESC/POS, HID scanners, common scales |
| Slow load with big catalogues; offline/sync corruption after session close | Odoo | Delta sync to IndexedDB, idempotent order ids, late offline orders accepted into a closed session as an adjustment |
| Rigid session close; unexplained "difference" entries | Odoo | Variance per tender with reason, approver and a named over/short account |
| Basic features behind paid add-ons | Loyverse, Square, Lightspeed | Core features in the base price |
| No variable-weight barcodes | Square | Configurable barcode rules |
| Accounting via sync apps | everyone but Odoo/Zoho | Native posting |
| Many tiny Windows-only local vendors; PEF→SEF churn | Kosovo | Cloud + offline client; PAKO carries certification and re-certification |

---

## 6. Requirements by business type

Each type lists workflows, must-haves, data, hardware, accounting effects and KPIs. "Pack"
names refer to §9.

### 6.1 Markets, supermarkets, mini-markets, butchers, kiosks — *Grocery pack*

- **Workflows.** Scan-first checkout (qty multiply, PLU, open price); mixed tenders; suspend and
  recall; price check. **Weighed goods**: counter scales print EAN-13 labels with prefix 2x (item +
  price or weight + check digit); scanner-scales give live kg for loose produce. **Promotions**:
  multi-buy, mixed-match, bundles, Nth free, spend thresholds, time windows (happy hour, weekend),
  member prices, coupons, stacking rules. **Loyalty** by card or phone. **Shelf labels** reprinted
  from a "changed since" queue with unit price. Multiple tills, shifts, cash-in/out (supplier
  paid-outs are common in mini-markets), safe drops, cashier handover on one till. **Bottle
  deposits** as linked lines, outside VAT. **Expiry**: lots at receipt, near-expiry markdowns,
  write-offs with reasons. Back office: receiving against orders, price changes with margin control,
  counts with a handheld, min/max replenishment.
- **Must-have.** Fiscal coupons and corrections; multiple barcodes; 2x rules; scales; PLU;
  promotions engine; shifts and Z; returns against the original; **age prompt**; deposits; labels;
  counts; offline.
- **Hardware.** 2D scanner (handheld or bioptic), scanner-scale (RS-232/USB), label-printing scales
  (CAS, DIGI, Bizerba, Mettler) with PLU download, receipt printer, drawer, customer display, card
  terminal, label printer, handheld.
- **Accounting.** Revenue by VAT rate, tender clearing, over/short per session; COGS at average
  cost; deposits as liability; promotions as reduced revenue; loyalty points as deferred revenue;
  shrink expense (input VAT on theft — already built in stock P1).
- **KPIs.** Sales by hour/day/category/cashier; basket size; margin by category; promotion uplift;
  shrink and waste %; stock days; out-of-stocks; over/short per cashier; voids, no-sales, refunds;
  loyalty penetration.

### 6.2 Restaurants, cafés, bars, fast food, pizzerias — *Hospitality pack*

- **Workflows.** Floors and tables with live status (free, ordered, bill printed, reserved),
  transfer, merge, covers. **Waiters** with PIN or card; handheld ordering; the Kosovo café habit of
  the **waiter's cash bag** settled at shift end. **Routing**: each item has a production centre
  (kitchen, grill, pizza, bar, dessert) → printer or KDS; changes print as STORNO tickets.
  **Modifiers** (required/optional, min/max, price and recipe deltas, pre-modifiers), combos with
  choice slots, half-and-half pizza, sizes. **Courses** (fire now, hold, fire on demand). **Bills**:
  split by seat/item/equal/amount, merge, partial payment, **pre-bill (non-fiscal)** then the fiscal
  coupon at payment. **Tips** separate from revenue, pooling. **Recipes/BOM** consume ingredients
  with yield and waste, nested recipes, modifier deltas; theoretical vs actual usage. Takeaway and
  delivery order types, caller ID, driver settlement, aggregators (Wolt, local apps — verify).
  QR menu and self-order; kiosks for fast food. Bar stock by location with daily spirits counts in
  measures.
- **Must-have.** Floor plan; waiter permissions; routing to printers; modifiers and combos;
  split/merge/transfer; fiscal at payment; void reasons with manager approval; recipes; happy-hour
  prices; waiter settlement; takeaway/delivery; **offline including kitchen printing over LAN**.
- **Hardware.** LAN ESC/POS printers per production centre; KDS screens; Android handhelds (ideally
  with printer or SoftPOS); card terminal; pagers.
- **Accounting.** Revenue by food/beverage (all 18 %); COGS from recipes; staff meals and comps as
  expense; tips as liability; waiter shortages as employee receivables (payroll link); usage variance.
- **KPIs.** Sales per cover and table turn; average check; food and beverage cost %; theoretical vs
  actual; voids and comps per waiter; ticket times per station; menu engineering; peak heatmap;
  delivery vs dine-in.

### 6.3 Bakeries and food producers — *Bakery/Production pack*

Production planning from orders; recipes (Normative items already exist in PAKO); made-to-order
cakes with deposits; wholesale route deliveries to shops (§6.10); returns of unsold bread;
end-of-day leftovers and discounts; 8 %/18 % ambiguity for pastries [VERIFY].

### 6.4 Hotels, guest houses — *Hotel pack*

Rooms, types and rate plans; reservation calendar; OTA bookings via a channel manager; guest
register with ID data (police reporting of foreign guests); housekeeping status; **folio** with
**charge-to-room from every outlet** (check that the guest is checked in) and split folios
(company pays room, guest pays extras); city ledger for companies and agencies; deposits;
accommodation tax per municipality (not VAT). **Fiscalization once** — at the outlet or at
check-out — decided with ATK [VERIFY]. KPIs: occupancy, ADR, RevPAR, revenue per outlet, folio aging.

### 6.5 Wedding halls and event venues — *Events/Venue pack*

A large Kosovo segment with summer and diaspora peaks: hall calendar per date, packages priced per
guest, deposits and installments (cash limit applies), final headcount, beverage billing per
bottle opened, banquet event orders to the kitchen; ticketing with QR scanning for events; deferred
ticket revenue.

### 6.6 Retail: fashion, shoes, electronics, furniture, books, cosmetics

- **Fashion pack**: style × size × colour matrix, each combination its own SKU and barcode, stock
  rolled up to the style, matrix receiving and counting, seasons, markdowns.
- **Serialized/Warranty pack** (electronics, phones, appliances): serial/IMEI at receipt and sale,
  warranty per serial, RMA to supplier, extended warranty, **installments** through bank partners
  (RaiPOS) or store credit.
- **Deposits & Orders pack** (furniture, kitchens): sell from display or catalogue → special order →
  delivery and installation schedule, deposits (cash limit!), partial deliveries.
- Books: ISBN, 8 % VAT, consignment from publishers, school-list sales. Cosmetics: lots and expiry,
  testers as internal use.
- Common: returns to original tender or store credit, receiptless returns with approval, exchange
  as one transaction, restock or damage disposition; **layaway**; **gift cards and store credit** as
  liabilities; customer orders reserving stock from another store.
- KPIs: sell-through by style/size, size curve, stock aging, return rate by reason, UPT, ATV,
  GMROI, markdown %.

### 6.7 Multi-store chains and franchises — *Multi-store pack*

Central catalogue; **price hierarchy** global → region → store with permission-gated overrides and
scheduled pushes; central promotions with store scope; inter-store transfer request → dispatch →
receipt with in-transit stock; central replenishment; consolidated and comparative reporting;
**role × store permissions**; store-level cash management; each store its own fiscal unit
(branch number). Franchisees are separate legal entities (separate PAKO companies) — HQ sells to
them by invoice and bills royalties from a sales feed. KPIs: like-for-like, sales per m² and per
employee, store ranking, transfer lead time, shrink per store.

### 6.8 Pharmacies, fuel stations, car parts and workshops

- **Pharmacy pack**: lots/expiry with FEFO (built in stock P8), prescriptions (prescriber,
  patient, Rx number), **controlled-drug register** (immutable), blister splits, generics by ATC /
  active ingredient, third-party payer, recalls by batch, **official maximum prices**, GS1 DataMatrix
  (GTIN, lot, expiry, serial), mixed 8 %/18 %.
- **Forecourt pack**: forecourt controller (DOMS PSS 5000 / IFSF over TCP) or manual totaliser mode;
  pump states (authorise, prepay/postpay); nozzle → grade → price; price pushes; tank gauges and
  wet-stock reconciliation; meter readings per shift; **fleet cards** with limits, plate and driver
  on monthly invoices; litres to 3 decimals; special fiscal systems for dispensers.
- **Auto Parts pack**: OEM numbers, cross-references, vehicle fitment (TecDoc), core deposits.
- **Workshop/Repair pack**: job card (vehicle plate/VIN/km or device/serial) → diagnosis → estimate →
  approval → parts issued → labour by mechanic → invoice; status messages; service history.

### 6.9 Services — *Appointments, Membership, Professional Time packs*

- Salons, barbers, clinics, spas: calendar per staff and chair/room, online booking, reminders
  (SMS/Viber/WhatsApp), deposits and no-show fees, walk-in queue, service + retail in one checkout,
  packages (10 sessions) and memberships, **staff commissions** → PAKO payroll (commissions already
  exist in HR/payroll). Clinics: patient file, treatment plans with phased payments, medical VAT
  exemption [VERIFY].
- Repair shops: intake with photos and accessories left, status workflow, parts and labour.
- Gyms: memberships, freezing, recurring billing (standing orders/bank references are more
  realistic than card-on-file in Kosovo), access control, classes.
- Education: enrolments, fee schedules with installments, sibling discounts, arrears.
- Professional services: time per client/matter, rates per person, retainers, WIP billing — mostly
  invoices, not coupons.
- Accounting: packages, memberships and retainers as deferred revenue; deposits as liabilities;
  commissions as payroll expense.

### 6.10 Wholesale and van sales — *B2B Wholesale and Van Sales packs*

Pre-sell vs van sales; van as a warehouse (morning load, evening unload and settlement of stock and
cash); routes with GPS check-in; customer price lists and volume tiers; **credit limit and overdue
blocks** (credit limit already enforced at invoice posting); collections on the route; crates and
empties; **offline-first Android**; B2B invoices with buyer fiscal number; cash B2C sales from the
van still need a coupon (SEF on the handheld). KPIs: drop size, strike rate, DSO, returns %, van
stock variance.

### 6.11 Construction — *Construction pack* (ERP, POS-light)

Projects/sites with budgets by cost code; **material issues** from warehouse or direct supplier
delivery to the site (a POS-like issue terminal on a tablet: scan, project, cost code, foreman
signature); returns from site; equipment hours and fuel per project; subcontracts with their claims
and retention; **progress billing (situacione)** from the bill of quantities: cumulative quantity,
previous billed, this period, retention withheld (5–10 %), advance recovery → net due; change
orders; percentage-of-completion; public-contract formats. Reverse charge on construction services
[LAW VAT 52(1.4); VERIFY scope]. KPIs: budget vs actual, earned value, over/under billing, retention
outstanding.

### 6.12 "Houses" — *Real Estate Sales, Property Rental, Building Materials packs*

- **Developers**: building → floor → unit (m², orientation, price per m², status available /
  reserved / pre-contract / sold / handed over), linked parking and storage, reservation with deposit
  and expiry, sales contract with **installment plan** (down payment, monthly or milestone-based,
  mortgage tranche), landowner compensation deals (*kompensim*), handover. Residential is
  **VAT-exempt**, commercial 18 % → input VAT apportionment. Payments are bank-based (cash limit).
  Customer advances are liabilities until handover.
- **Rental and property management**: leases, rent schedules with indexation, security deposits,
  service charges, meter-based recharges, automatic monthly invoicing, arrears and dunning,
  inspections, owner statements; withholding tax on rent paid to individuals (PAKO already handles
  withholding) [VERIFY rate].
- **Building-materials shops**: multi-unit selling (bag/pallet, kg/bar, m²/box, metre/roll — **units
  of measure built in stock P7**), cut-to-length, **quotes → sales orders → partial deliveries →
  invoices**, contractor accounts with credit limit and price list, truck deliveries, pallet deposits,
  paint tinting (recipe), big tickets (cash limit).

### 6.13 Other Kosovo types

Kiosks/trafika (agency items: top-ups, lottery, tickets — only the commission is revenue; age
restriction); agro-pharmacies (lots, controlled items, farmer credit until harvest); car dealers and
rent-a-car (VIN stock, trade-ins, rental contracts with deposits); private healthcare; telecom
resellers (IMEI, SIM commissions); self-checkout and fast-food kiosks (attendant approval for age
and weight); omnichannel (webshop sync, click & collect, ship-from-store, **cash-on-delivery
reconciliation with couriers** — still dominant in Kosovo).

---

## 7. What PAKO already has

| Area | Present today | Gap for POS |
|---|---|---|
| Fiscal | `fiscal-bridge/` — Node 18/Express service for the till PC on `127.0.0.1:7878` with Datecs (raw serial), Tremol (ZFPLab), ErpNet.FP drivers and a mock; `/receipt`, `/void-receipt`, `/x-report`, `/z-report`, setup page, Windows-service installer. Backend `Pako.Domain/Fiscal`: `IFiscalProvider`, `PefBridgeProvider`, `SefProvider` (stub) — **registered nowhere, called nowhere** | No SEF; the backend provider calls the **server's** localhost, not the till; the "offline queue" in the README does not exist; payments only cash/card; VAT 18/8 whole-number mapping vs fraction rates |
| Sales | Invoices (Invoice, CreditNote, DebitNote, DownPayment, SalesReturn, Proforma); **pay-on-create** (create + post + settle + reconcile in one transaction with company and partner locks); credit limits; numbering; journals SAL/CSH/BNK | Invoice requires a known customer partner (no walk-in); R07 tax-ID rule for VAT counterparties; per-document posting would flood the ledger at till volumes |
| Payments | `PaymentMethod` Cash/Bank with ledger account; seeded "Arka kryesore" | No card, voucher, gift card, on-account tender kinds; no clearing accounts for card settlements |
| Items | Goods/Service/**Normative** (recipe) types; barcodes (unique per company); units (P7); lots (P8); categories; favourites per user | No exact barcode lookup endpoint; no PLU, weight-embedded rules, variants, modifiers, combos |
| Stock | Average cost engine with back-dating, warehouses, transfers, counts, write-offs (VAT reversal), price lists per warehouse + Nivelim, purchase orders, receipts/GRNI, units, lots/FEFO | `StockMoveSource` has no POS source; negative-stock "Block" conflicts with already-issued offline coupons |
| Access | Roles with areas × levels; platform module flags; partner scoping | No POS area/module; no **user ↔ store** binding; no per-action POS permissions or PIN login |
| Ledger | Hash chain + `SecureSequenceNumber` on journal entries | Link fiscal documents into the chain (SEF certification will look at tamper evidence) |
| Infra | Email outbox; 1-minute background job host with job locks | **No SignalR/websocket** (needed for KDS, supervisor screens, live sessions) |
| Mobile | Expo app sharing the API client (invoices, bills, reports) | No offline, no barcode/camera, no local DB |
| Multi-store | Warehouse = shop, per-warehouse price list, `Invoice.WarehouseId`; rule "another business unit = another company" | Store entity with fiscal branch number, registers, user scope |

---

## 8. The shared core every business needs

1. **Fiscal engine** — SEF (signing, QR, NUIKF, real-time send, offline queue with 48 h / 10th-of-
   month rules, certificate per point of sale), PEF adapter for hardware customers, corrective
   coupons referencing originals, X/Z reports, paper-block entry within 5 days, training mode.
2. **Registers and sessions** — opening float, cash movements (float, to bank, petty in/out,
   paid-outs), blind close per tender, variance with reason and approver, Z.
3. **Sales screen** — favourites, categories, search, barcode-first, keypad, park/recall, notes,
   keyboard-only; customer display.
4. **Catalogue for selling** — exact barcode lookup, PLU, weight/price-embedded barcode rules,
   variants, modifiers, combos, open-price items, age-restricted flag, deposit-linked items.
5. **Pricing** — price lists by store and customer group (exists), time-based prices, permission-
   capped discounts, **one Programs engine** for promotions, coupons, loyalty, gift cards, wallets.
6. **Tenders** — cash, card (standalone or integrated), SoftPOS, voucher, gift card, store credit,
   on-account (AR), charge-to-room, installments, mixed and split; **cash-limit rule**.
7. **Customers** — anonymous walk-in by default; quick create; business buyers with NUI/fiscal
   number → tax invoice; credit limits; consent flags.
8. **Stock** — real-time relief per order (POS source), recipes for Normative items, returns with
   restock/write-off disposition, lots/serials where items track them.
9. **Accounting** — one entry per session (revenue by account × VAT, tender clearing, over/short),
   COGS through stock, liabilities ledger (deposits, gift cards, store credit, layaway, tips, DRS),
   card settlement reconciliation with bank statements.
10. **People** — PIN/badge login on a shared terminal, roles × store scope, per-action permissions,
    manager PIN override, immutable audit log.
11. **Offline-first** — local catalogue and queue on every terminal, idempotent sync, LAN printing.
12. **Hardware** — ESC/POS printers, drawer, scanners, scales, customer display, label printers,
    kitchen printers/KDS, card terminals.
13. **Reporting** — sales by period/store/register/cashier/item/category/tender/hour, margin, tax,
    voids/refunds/discounts, session history, fiscal status, VAT book feed.

---

## 9. Vertical packs and business-type presets

### 9.1 Packs

| Pack | Main features | Typical customers |
|---|---|---|
| Grocery | 2x barcodes, scales, PLU, deposits, advanced promotions, loyalty, labels, expiry markdowns, age prompt | markets, butchers, kiosks |
| Hospitality | floors/tables, waiters, routing/KDS, modifiers/combos, courses, split/merge, tips, recipes, takeaway/delivery, QR self-order, waiter settlement | restaurants, cafés, bars, fast food |
| Bakery/Production | production plans, recipes, made-to-order with deposits, leftovers | bakeries, food producers |
| Hotel | rooms, reservations, folio, charge-to-room, city ledger, tourist tax, guest register, housekeeping | hotels, guest houses |
| Events/Venue | hall calendar, per-guest packages, banquet orders, deposits; ticketing with QR | wedding halls, event organisers |
| Fashion | variant matrix, size scales, seasons, markdowns | clothing, shoes |
| Serialized/Warranty | serials/IMEI, warranty, RMA, installments | electronics, phones, car dealers |
| Deposits & Orders | layaway, special orders, delivery/installation scheduling | furniture, appliances |
| Gift & Loyalty | gift cards, store credit, points, tiers | any retail or hospitality |
| Multi-store/Franchise | price hierarchy, assortment, transfers, replenishment, royalties, consolidation | chains |
| Pharmacy | FEFO, prescriptions, controlled register, ATC/generics, payers, price caps | pharmacies, agro-pharmacies |
| Forecourt | controller, tanks, meters, fleet cards | fuel stations |
| Workshop/Repair | job cards, vehicles/devices, labour, parts, status messages | garages, repair shops |
| Auto Parts | cross-references, fitment, core deposits | parts stores |
| Appointments | calendar, resources, deposits/no-show, packages, commissions | salons, clinics, spas |
| Membership | plans, recurring billing, freeze, access control | gyms, schools, clubs |
| Professional Time | time entries, matters, retainers, WIP | lawyers, engineers, consultants |
| Construction | projects/cost codes, site issues, equipment, subcontracts, situacione, retention | contractors |
| Building Materials | multi-unit, quotes → orders → deliveries, contractor credit, pallet deposits | builders' merchants |
| Real Estate Sales | units, reservations, installment plans, compensation deals, exempt residential | developers |
| Property Rental | leases, recurring rent, deposits, meters, arrears, owner statements | landlords |
| Van Sales/DSD | offline mobile, van stock, routes, credit blocks, collections, settlement | distributors |
| B2B Wholesale | customer price lists, volume tiers, credit control, pick/deliver | wholesalers |
| Self-service | self-checkout/kiosk, attendant approvals, electronic tax blocks | supermarkets, fast food |
| Omnichannel | webshop sync, click & collect, ship-from-store, COD reconciliation | retailers with webshops |
| Agency/Commission | sales on behalf of others, commission-only revenue | kiosks, trafika |

### 9.2 Presets (chosen when a business sets up the POS)

| Preset | Packs switched on |
|---|---|
| Mini-market / supermarket | Grocery + Gift & Loyalty |
| Café / bar | Hospitality (light: predefined tickets, no KDS) |
| Restaurant / pizzeria / fast food | Hospitality + Gift & Loyalty (+ Self-service for kiosks) |
| Bakery | Bakery/Production + Grocery (light) + Van Sales |
| Hotel | Hotel + Hospitality |
| Wedding hall | Events/Venue + Hospitality |
| Fashion store | Fashion + Gift & Loyalty + Omnichannel |
| Electronics / phones | Serialized/Warranty + Deposits & Orders |
| Pharmacy | Pharmacy + Gift & Loyalty |
| Salon / clinic | Appointments + Membership |
| Distributor | B2B Wholesale + Van Sales |
| Builders' merchant | Building Materials + B2B Wholesale |
| Contractor | Construction + Building Materials |
| Developer | Real Estate Sales (+ Construction) |

A preset sets the register profile (screen layout and enabled functions), default printers and
routing, default tender list, and the onboarding checklist. Packs stay individually switchable.

---

## 10. Decisions (proposed — need sign-off)

| # | Decision | Why |
|---|---|---|
| **D1** | **PAKO certifies as a SEF developer and maintainer** under AI 01/2026 Art. 35, and builds the SEF itself from ATK's protocol (Protobuf + ECDSA P-256, `/ca/signcsr`, `/pos/coupon`, `/citizen/coupon`). | Every competitor that matters is certified; a bridge to someone else's SEF makes PAKO dependent on a rival and splits the certificate and key from PAKO's data. Certification is a 15-working-day decision once conditions are met. |
| **D2** | **Signing happens on the point of sale.** Each register owns its key pair (generated on the device, CSR signed by ATK) inside **PAKO Station**, a local agent grown from `fiscal-bridge/` (Node, Windows/Linux/Android-compatible), which signs, queues and sends coupons to ATK, prints, opens the drawer and reads scales. The browser POS talks to PAKO Station on the till and to the PAKO cloud. A pure-browser mode (WebCrypto **non-extractable** P-256 key in IndexedDB) is the fallback for tablets/phones without the agent. | Art. 34: one certificate per point of sale, private key never leaves the machine; Art. 32(3): the SEF itself must queue and resend offline coupons. The server cannot sign for a till. Reusing the bridge keeps the printer drivers that already work. |
| **D3** | **Keep the PEF route** through the existing fiscal-bridge drivers (Datecs, Tremol, ErpNet.FP) for customers who stay on hardware until the Minister's transition decision, with the Art. 14 conformity confirmation. | Existing PEF users may keep their devices (Art. 50(1)); losing them would cut the market in half during the transition. |
| **D4** | **Fiscal document model** = type (**Sale, Cancel, Return** as ATK 1/2/3; plus **Training** and **Pre-bill**, which are never fiscalized) with mandatory reference for Cancel/Return; one `FiscalDocument` per coupon, immutable, chained into PAKO's existing hash chain. | Mirrors ATK's protocol and the Serbian ESIR matrix; training mode is essential for onboarding cashiers; immutability answers the "zapper" rule. |
| **D5** | **POS orders are their own aggregate (`PosOrder`)**, not invoices. A B2B buyer at the till gets a **tax invoice** (existing `Invoice`), linked to the order, never a coupon too unless ATK guidance says otherwise [VERIFY]. Anonymous walk-in is the default; a customer is optional. | Invoices need a known customer and post one entry each — wrong for hundreds of coupons a day. AI Art. 5(3): B2B supplies use tax invoices. |
| **D6** | **Accounting per session, stock per order.** The ledger gets **one entry per closed session**: revenue by revenue account × VAT code, tender clearing, over/short, tips/deposit/gift-card liabilities. Stock moves are written **per order in real time** (new `StockMoveSource.Pos`) so on-hand and COGS stay live. B2B invoices from the POS post individually. | Odoo's model, proven at volume; PAKO's stock engine is per-document and already handles back-dated (late offline) moves. |
| **D7** | **Sales are never refused for stock.** POS stock moves always apply with the "warn" policy (the coupon may already exist offline), and negative positions are flagged on a report, whatever the company's negative-stock setting. | A coupon issued offline is a legal fact; refusing its stock move would desynchronise the books from ATK. |
| **D8** | **Tenders extend `PaymentMethod`** with kinds Card, Voucher, GiftCard, StoreCredit, OnAccount, RoomCharge, Installment, Other, each with a clearing account; card clearing is reconciled against bank settlements (existing reconciliation). The **€2,000 B2C cash rule** is enforced on the deal value, not per tender line. | Kosovo card terminals are bank-owned and settle net of fees days later; the cash rule is law since 1 Jun 2026. |
| **D9** | **One POS with a register profile** (Retail, Grocery, Café, Restaurant, Services, Hotel outlet, Van) over one catalogue, one order model and one fiscal layer; packs (§9) switch features on. | Square and Odoo converged here; Lightspeed's split platforms are the counter-example. |
| **D10** | **Store** = a new entity inside a company: fiscal branch number, address, warehouse, price list, registers, receipt header. A separate legal entity stays a separate PAKO company (existing rule). Users get **store scope** on top of their role. | ATK's branch/unit and POS numbers are part of every coupon; chains need store-scoped staff. |
| **D11** | **Offline-first clients**: catalogue, prices, programs, customers (scoped), open orders and the fiscal queue live locally; orders carry a client UUID and are idempotent; late orders for a closed session post into an **adjustment** of that session rather than failing. | Odoo's sync failures are the top complaint; the law requires coupons to keep flowing offline. |
| **D12** | **Programs engine in the core**: one model of rules and rewards for promotions, coupons, loyalty points, gift cards, wallets and next-order coupons, priced server-side and replicated to clients; price history kept for the consumer-law "old price" rule. | One engine instead of six features (Odoo); promotions are required by grocery, retail and hospitality alike. |
| **D13** | **Liabilities ledger** shared by all packs: deposits, gift cards, store credit, layaway, tips, bottle deposits, room charges, membership prepayments — each a typed balance with movements and its own control account. | Every pack holds money that isn't revenue yet; one ledger keeps them consistent and auditable. |
| **D14** | **New access area `Pos` and platform module `Pos`**, plus **per-action POS permissions** (discount caps, price override, void line, cancel coupon, refund, no-sale, cash in/out, close session, view X/Z) with **manager PIN override** and an immutable audit log. Cashiers log in with a PIN on a shared terminal. | The coupon shows the operator by name and ID (Art. 7); refunds and voids are fraud vectors. |
| **D15** | **Realtime channel (SignalR)** for KDS, waiter handhelds, supervisor views and "ticket fired" events; LAN fallback through PAKO Station for kitchens when the internet is down. | No realtime infra exists; restaurants cannot wait for polling. |
| **D16** | **Money math stays server-side or in shared, tested pricing code.** The client computes provisional totals with the same pricing module the server uses (published as a package), and the coupon amounts come from that module; the server recomputes and flags any mismatch. | The repo rule is "never compute money in the browser", but an offline till must total a basket. One shared, versioned pricing library keeps a single source of truth. **This relaxes a repo rule and needs explicit sign-off.** |

---

## 11. Architecture

```
            ┌───────────────────────── PAKO cloud (ASP.NET Core) ─────────────────────────┐
            │  POS API: registers, sessions, orders, catalogue sync, programs, customers  │
            │  Fiscal registry: documents, ATK status mirror, certificate metadata        │
            │  Posting: session → journal entry; order → stock moves (StockMoveSource.Pos)│
            │  SignalR hub: KDS, handhelds, supervisor                                    │
            └──────────────▲───────────────────────────▲───────────────────────────────────┘
                           │ HTTPS (sync, idempotent)   │ HTTPS
            ┌──────────────┴───────────┐   ┌───────────┴──────────────┐
            │ POS client (web PWA)     │   │ Waiter / van app (Expo)  │
            │ IndexedDB: catalogue,    │   │ same sync + local queue  │
            │ prices, open orders      │   └───────────┬──────────────┘
            └──────────────┬───────────┘               │ LAN
                           │ localhost / LAN            │
            ┌──────────────┴────────────────────────────┴───────────┐
            │ PAKO Station (from fiscal-bridge, per point of sale)  │
            │ • key pair + ATK certificate (never leaves)           │
            │ • coupon builder: Protobuf, SHA-256, ECDSA, QR, NUIKF │
            │ • fiscal queue: send, retry, 48 h / 10th-of-month     │
            │ • ESC/POS printing, drawer, scale, customer display   │
            │ • kitchen printers / LAN relay when offline           │
            │ • PEF drivers (Datecs, Tremol, ErpNet) for hardware   │
            └──────────────┬────────────────────────────────────────┘
                           │ HTTPS (mutual cert)
                     ATK fiscalizimi.atk-ks.org
```

- **Order lifecycle**: draft (on the client) → paid → **fiscalized** (Station signs, prints, queues
  for ATK) → synced to cloud → **sent** (ATK accepted) / **offline** / **failed verification**.
  The cloud never holds an unsigned "paid" order without a fiscal document.
- **Where the truth lives**: the fiscal document is created and signed on the Station; the cloud
  stores a copy plus ATK's status, and posts accounting from it. If cloud and Station disagree, the
  signed document wins and the cloud raises an exception for review.
- **Catalogue sync**: versioned delta feed per company and store (items, barcodes, rules, prices,
  programs, tax letters, customers in scope) with a high-water mark; full resync on demand.
- **Hardware**: PAKO Station exposes the existing fiscal-bridge endpoints plus `/sign`,
  `/print/escpos`, `/drawer`, `/scale`, `/display`, `/kitchen/{station}`; drivers are pluggable.
- **Security**: Station binds to localhost by default (LAN mode explicit, with a pairing token);
  CORS restricted to the PAKO origin (today it is open); certificate private key in the OS keystore
  (DPAPI/Keychain/Android Keystore) or a file encrypted with it.

---

## 12. Data model

### 12.1 Setup

- `Store`: CompanyId, Code, Name, Address, **FiscalBranchNumber**, WarehouseId, PriceListId,
  ReceiptHeader/Footer, Timezone, IsActive.
- `PosRegister`: StoreId, Code, Name, **Profile** (Retail / Grocery / Café / Restaurant / Services
  / HotelOutlet / Van), **FiscalMode** (SEF / PEF / Training), **FiscalPosNumber**, Fiscalization
  Number (EDI), certificate thumbprint and expiry, allowed tenders, presets, default customer,
  printers and routing, StationId (paired agent), offline caps per tender.
- `PosUserStore`: user ↔ store scope; `PosPin` (hashed PIN/badge per member per company).
- `BarcodeRule`: prefix (20–29), layout (item digits, value digits, decimals), kind (weight / price
  / quantity), per company or store.
- `PosCategory` (screen layout), `Favourite` tiles per register profile.

### 12.2 Catalogue additions

- `Item`: SellByWeight, Tare, PLU, AgeRestricted, DepositItemId, OpenPrice, ProductionCenterId,
  KitchenName, ColourOnScreen.
- `ItemVariant` / `ItemAttribute` / `ItemAttributeValue` (style × size × colour; each variant its
  own barcodes and stock — modelled as items linked to a template to reuse the stock engine).
- `ModifierGroup` (min, max, required, free count) / `Modifier` (price delta, recipe delta,
  pre-modifier kind).
- `Combo` / `ComboSlot` (choice of items, price adjustments).
- `Recipe` / `RecipeLine` for Normative items (ingredient, qty, unit, yield %), nested allowed.
- `ProductionCenter` → printer or KDS station.

### 12.3 Sessions and cash

- `PosSession`: RegisterId, Number, OpenedBy/At, OpeningFloat, State (Opening → Open → Closing →
  Closed → Posted), ClosedBy/At, JournalEntryId, Z report snapshot (immutable JSON + PDF).
- `PosCashMovement`: SessionId, Kind (Float / ToBank / PettyIn / PettyOut / PaidOut / SafeDrop /
  WaiterSettlement), Amount, Reason, ApprovedBy, CounterpartAccountId.
- `PosSessionTender`: SessionId, PaymentMethodId, Expected, Counted, Variance, VarianceReason,
  ApprovedBy.

### 12.4 Orders and payments

- `PosOrder`: ClientUuid (idempotency), SessionId, StoreId, RegisterId, Number (daily and global),
  OperatorId, CustomerId?, Preset (dine-in / takeaway / delivery), TableId?, Covers, State (Draft /
  Open ticket / Paid / Fiscalized / Synced / Cancelled), Totals (net, tax per letter, gross),
  InvoiceId? (B2B), Notes, CreatedOffline, Timestamps.
- `PosOrderLine`: ItemId, Description, Quantity (4 decimals), UnitName/UnitFactor, LotNumber,
  Serial, UnitPrice (gross), Discount (amount/%), DiscountReason, ProgramId (what gave the
  discount), TaxDefinitionId + TaxLetter, Net, Tax, Gross, ParentLineId (modifiers/combos), Course,
  Seat, SentToKitchenAt, VoidedBy/Reason, RefundedLineId.
- `PosPayment`: OrderId, PaymentMethodId, Amount, Tendered, Change, TerminalReference, Tip,
  InstallmentPlan?, LiabilityAccountId (gift card/store credit/deposit).

### 12.5 Fiscal

- `FiscalDocument`: CompanyId, StoreId, RegisterId, OrderId, **Type** (Sale / Cancel / Return /
  Training / PreBill), CouponId (unique per business), **NUIKF**, DailyNumber, ReferenceDocumentId,
  IssuedAt, OperatorId, payload (Protobuf bytes, both CitizenCoupon and PosCoupon), Signature,
  QrContent, **AtkStatus** (Pending / Sent / Accepted / Offline / Failed / FailedVerification),
  AtkResponse, SentAt, Attempts, OfflineSince, DeadlineAt (48 h), HashChainLink.
- `FiscalPaperBlockEntry`: block number, coupon number, entered within 5 days (Art. 45).
- `FiscalIncident`: outage start/end, ATK notification reference, evidence (Art. 44).
- `FiscalCertificate`: RegisterId, subject (O/OU/L), serial, valid from/to, revoked.

### 12.6 Programs, customers, liabilities

- `Program`: Type (Promotion / Coupon / Loyalty / GiftCard / Wallet / NextOrderCoupon / BuyXGetY),
  schedule, store scope, customer-group scope, priority, stackable, `ProgramRule` (min quantity,
  min amount, items/categories, time window, code) and `ProgramReward` (discount % / amount,
  free item, points, price override).
- `LoyaltyCard` / `LoyaltyTransaction`; `GiftCard` (number, balance, expiry); `Coupon` (code,
  uses).
- `CustomerLiability`: CustomerId?, Kind (Deposit / GiftCard / StoreCredit / Layaway / Tip /
  BottleDeposit / RoomCharge / Membership), Balance, ControlAccountId; `LiabilityMovement`.
- `Partner` gains: CustomerGroup, LoyaltyCardId, MarketingConsent (+date, channel), IsWalkIn.

### 12.7 Hospitality

`Floor`, `Table` (shape, position, seats), `OpenTicket` (= PosOrder in Open state), `Course`,
`KitchenTicket` (station, lines, fired/bumped timestamps), `KdsStation`, `Reservation`,
`DeliveryOrder` (address, driver, fee), `TipPool`/`TipAllocation`, `WaiterSettlement`.

### 12.8 Other packs (outline)

Hotel: `Room`, `RoomType`, `RatePlan`, `Booking`, `Folio`/`FolioPosting`, `CityLedgerAccount`,
`TouristTaxRule`. Services: `Service` (duration, resources, commission rule), `Resource`,
`Appointment`, `Package`/`PackageBalance`, `Membership`, `RepairTicket`. Forecourt: `Tank`,
`Pump`, `Nozzle`, `Grade`, `TankDip`, `MeterReading`, `FleetCard`. Pharmacy: ATC/active
ingredient on items, `Prescription`, `ControlledRegisterEntry`, `ThirdPartyPayer`. Construction:
`Project`, `CostCode`, `MaterialIssue`, `EquipmentUsage`, `Subcontract`, `BoqLine`,
`ProgressBill`, `RetentionLedger`. Real estate: `Building`, `Unit`, `UnitReservation`,
`SalesContract`, `InstallmentSchedule`. Rental: `Lease`, `RentSchedule`, `SecurityDeposit`,
`MeterReading`. Van sales: `Route`, `RouteVisit`, `Van` (warehouse), `LoadSheet`, `Settlement`.

---

## 13. Accounting and stock

### 13.1 Session closing entry (one per session, General or a new POS journal)

| Line | Debit | Credit |
|---|---|---|
| Revenue per revenue account × VAT code (net) | | Revenue (net), with TaxId on the line |
| VAT per code | | Output VAT (TaxId), so the VAT return reads it like invoices |
| Cash tender (counted) | Cash register account (one per register or store) | |
| Card tender | **Card clearing** (per acquirer) | |
| Voucher / gift card redemption | Gift-card liability | |
| On-account sales | Receivables per customer (partner on the line) | |
| Gift cards sold / deposits taken / tips | | Liability accounts |
| Cash over / short | Over/short expense | or Over/short income |
| Discounts | reduce revenue (net presentation); optional memo account for reporting | |

- **Tax lines carry TaxId**, so PAKO's VAT return (which reads tax-coded journal lines) includes POS
  sales with no extra code. The **ATK sales book** is built from invoices today; it needs a POS
  source (daily summary per VAT letter) — part of P1.
- Refunds and cancellations reduce revenue and VAT in the session where they happen.
- Card settlements: the bank statement line (net of fee) is matched to card clearing; the fee goes
  to bank charges — existing reconciliation flow with a POS rule.
- Cash to bank: a cash movement "ToBank" posts Dr cash-in-transit / Cr register cash; the bank
  deposit clears transit.
- **Late offline orders** that arrive after the session was posted go into a **session adjustment
  entry** (same structure, dated with the coupon date).

### 13.2 Stock

- Each paid order writes stock moves (Issue from the store's warehouse, `StockMoveSource.Pos`) in
  real time; COGS pairs are added to the **session** entry (aggregated per item category account)
  so the ledger stays light while stock stays live.
- Normative items (recipes) issue their ingredients, not themselves; modifier recipe deltas apply.
- Returns: Receipt back to stock at the original cost (as sales returns do today) or to a
  damaged/quarantine location with write-off.
- Lots: FEFO from the till; serials captured on the line; units through the existing factors.
- Negative stock: always allowed for POS (D7), surfaced on the low/negative stock reports.

---

## 14. Fiscal flows in detail

### 14.1 Onboarding a point of sale

1. Taxpayer requests the **Fiscalization Number** in ATK EDI ("Kërkesë për Fiskalizim") and
   registers PAKO as their SEF (software code, developer, maintainer) [Art. 34–35].
2. In PAKO: create Store (fiscal branch number) and Register (POS number); install PAKO Station on
   the till; pair it to the register.
3. Station generates the key pair, calls `/ca/verify/{nui}`, submits the CSR
   (C=RKS, O=BusinessId, OU=PosId, L=BranchId) to `/ca/signcsr`, stores the certificate; PAKO stores
   the thumbprint and expiry and alerts before expiry.
4. Test coupons in **Training** mode, then against ATK's test environment, then production.

### 14.2 Sale

1. Cashier builds the basket; programs price it (shared pricing module).
2. Payment: tenders, cash-limit check, change.
3. Station builds CitizenCoupon + PosCoupon (identical totals), signs, generates QR and NUIKF,
   prints, opens the drawer, stores the document, sends to `/pos/coupon` and `/citizen/coupon`.
4. ATK response stored; status Accepted; order synced to cloud with the fiscal document.
5. Offline: printed with QR (mandatory) and marked OFFLINE; queued; the Station retries with
   back-off; the register shows the oldest unsent coupon and the time left to 48 h; at 36 h it
   escalates to the supervisor and offers the Art. 44 ATK notification; anything still unsent on
   the 10th of the next month is exported for submission.

### 14.3 Corrections

- Before payment: remove lines freely (permission + reason logged, no fiscal effect).
- After the coupon: **Cancel** (whole coupon, same day typical) or **Return** (some lines) — new
  coupons with ReferenceNo = original CouponId, reason required, manager approval by permission,
  linked stock and money effects; must reach ATK within 48 h.
- B2B invoice requested after a coupon: issue the tax invoice referencing the coupon [VERIFY ATK
  practice on double documents].

### 14.4 Device failure

Paper block (pre-fiscalized via EDI) used; PAKO records the outage; the device is restored within
48 h; **block coupons are keyed into PAKO within 5 days** through a dedicated screen that creates
the fiscal documents with the block references [Art. 45].

### 14.5 Reports

X (running, no reset) and Z (session close) per register: coupons by type, totals by VAT letter,
payments by tender, cancellations and returns, first/last coupon numbers, offline count; stored
immutably with the session; printable on 80 mm and A4.

---

## 15. Phases and build order

Effort is indicative for one full-stack developer with AI assistance; the critical path is
certification.

### P0 — Legal and fiscal groundwork (2–3 weeks)

- Obtain and read ATK's technical spec (01.06.2026), certification conditions and fees, coupon
  layout, NUIKF format, unit/category codes; confirm the open points in §16 with ATK or the partner
  accounting firm.
- Prototype against `fiskalizimi-test.atk-ks.org` using ATK's C# sample: CSR, signing, both
  endpoints, cancel/return with reference, offline resend.
- Decide D1–D16; register PAKO (Soloop) as SEF developer and maintainer.

### P1 — POS core + SEF (8–10 weeks) — **retail counter, any business**

1. `Pos` access area, platform module, store entity, user store scope, PIN login.
2. Registers, sessions, cash movements, per-tender close, X/Z.
3. Tender kinds (D8), cash-limit rule, card clearing accounts.
4. `PosOrder` model, sync API (idempotent), offline web client with IndexedDB catalogue.
5. Sales screen: favourites, categories, search, exact barcode lookup, keypad, park/recall,
   discounts with caps, customer (walk-in default), B2B → invoice.
6. **PAKO Station v2** from fiscal-bridge: key/CSR, Protobuf coupon, signing, QR/NUIKF, ATK client,
   offline queue with legal timers, ESC/POS printing, drawer, customer display; PEF drivers kept.
7. Fiscal documents, cancel/return with reference, training mode, paper-block entry.
8. Accounting: session entry with TaxId lines, COGS aggregation, adjustment entries; stock moves
   per order (`StockMoveSource.Pos`); ATK sales book POS source.
9. Reports: sales, tenders, cashiers, voids/refunds, fiscal status dashboard.
10. Certification submission (Art. 35); go-live with pilot customers.

### P2 — Grocery and retail (6–8 weeks)

Barcode rules (2x), scales, PLU, age prompt, deposits; **Programs engine** (promotions, coupons,
loyalty, gift cards, wallet) with price history; shelf labels; variants matrix; serials/warranty;
layaway and special orders; store credit; exchanges; multi-store price hierarchy and store-scoped
reporting; handheld counts and receiving (reuses stock P1–P8).

### P3 — Hospitality (8–10 weeks)

Floors/tables, open tickets, waiters and handhelds (Expo app, offline), modifiers/pre-modifiers,
combos, courses, routing to LAN printers with preview, **SignalR + KDS** with stages and timers,
split/merge/transfer, pre-bill, tips and pooling, recipes on Normative items with modifier deltas
and usage variance, waiter cash settlement, takeaway/delivery presets, QR menu (view + order).

### P4 — Services (5–6 weeks)

Appointments calendar with resources, online booking, reminders, deposits/no-show; packages and
memberships (deferred revenue); repair tickets; commissions into payroll.

### P5 — Hotel and venues (6–8 weeks)

Rooms, bookings, folio, charge-to-room tender, city ledger, tourist tax, guest register; wedding
hall calendar, per-guest packages, banquet orders; ticketing with QR scanning.

### P6 — Distribution and mobile (6–8 weeks)

Van sales app (offline Expo, van warehouse, load/unload, routes, credit blocks, collections,
settlement, SEF on Android); B2B wholesale price tiers; building-materials flows (quotes → orders →
delivery notes → invoices, contractor credit) — the sales-order and delivery-note documents also
close stock plan P6's open "delivery notes".

### P7 — Specialist retail (as demand appears)

Pharmacy (Rx, controlled register, payers, price caps, DataMatrix); forecourt (controller, tanks,
meters, fleet cards); auto parts (cross-references, fitment); self-checkout and kiosks;
omnichannel (webshop sync, click & collect, COD reconciliation); agency items.

### P8 — ERP verticals that sit next to the POS (separate plans)

Construction (projects, cost codes, site issues, equipment, subcontracts, situacione, retention,
percentage of completion); real estate sales (units, reservations, installment plans,
compensation deals); property rental (leases, recurring rent, deposits, meters). Each deserves its
own master plan like this one; the POS contributes only counter sales and site issue terminals.

### Milestones

| Milestone | Content | Exit criterion |
|---|---|---|
| M1 | P0 done | Signed coupon accepted by ATK test; decisions signed off |
| M2 | P1 items 1–5 | Offline web till sells, syncs and closes a session into the ledger (training mode) |
| M3 | P1 complete | Production coupons at a pilot shop; certification granted |
| M4 | P2 | Pilot mini-market with scales and promotions live |
| M5 | P3 | Pilot café and restaurant live with kitchen printing and KDS |
| M6 | P4–P5 | Pilot salon and hotel/venue |

---

## 16. Open questions to verify before building

1. Final GZK text and publication date of AI 01/2026; any Minister decision under Art. 50(1) on
   the PEF→SEF transition.
2. ATK technical spec (01.06.2026): NUIKF format, printed layout, mandatory Z for SEF, offline
   marking, unit/category codes, rounding, tax letter for non-VAT sellers.
3. Certification conditions, fees, test methodology and re-certification on new versions.
4. Whether one SEF certificate may serve several browser tills on one PC, and how key storage on
   tablets/phones must be done.
5. Coupon plus invoice for the same B2B sale: allowed, required, or forbidden?
6. B2B cash limit: €300 or €500, and since when.
7. VAT on pastries/burek, live animals, medical services, residential rent, construction reverse
   charge scope.
8. Tips: VAT and income-tax treatment; vouchers: single- vs multi-purpose VAT timing.
9. Deposit-return system: actually running? amount?
10. Hotel: fiscalize at the outlet or at check-out when charging to the room?
11. Accommodation tax by municipality.
12. Exemption of medical services from fiscalization or VAT.
13. Data-protection article numbers for consent and marketing.

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Certification delay or refusal | No legal coupons, no sales | P0 prototype against ATK test first; engage ATK early; keep PEF route |
| ATK protocol or spec changes | Rework, re-certification | Fiscal layer isolated in PAKO Station with versioned payload builders |
| Offline queue loses coupons | Legal breach, fines, closure | Durable local store with write-ahead log; queue health on supervisor dashboard; 36 h escalation |
| Browser-only key storage judged insecure | Mode not allowed | Station is the primary mode; browser keys only if ATK accepts |
| Volume overwhelms ledger | Slow books | Session-level posting (D6) |
| Relaxing "no money math in the browser" | Divergent totals | One shared, versioned pricing package; server recompute and alert (D16) |
| Scope explosion across 27 packs | Nothing ships | Strict phase order; presets only expose built packs |
| Competitors already certified (31) | Late entrant | Differentiate on native accounting, cloud + offline, all business types, accountant distribution |
| Hardware diversity (scales, printers) | Support load | Certified hardware list; ESC/POS and common scale protocols first |

---

## 18. Commercial notes

- Local price anchor: ~€19 per register per month (NovaSEF), extra registers ~€6, setup ~€40.
  International: Loyverse free + €25 add-ons, Zoho POS $30–40/location, Shopify POS Pro $89,
  Lightspeed $89–289, Square $0–69+, Toast $0–69.
- Suggested: POS core included per register at a local-market price, packs priced as add-ons per
  store (hospitality, hotel, pharmacy, forecourt higher), accountants' firms get bulk terms for
  their clients.
- Hardware partners: ESC/POS printers, scanners, scales verified by the Kosovo Metrology Agency,
  Android handhelds with printers; card terminals from the banks; SoftPOS via RaiPOS.
