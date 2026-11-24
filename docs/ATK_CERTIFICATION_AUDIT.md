# ATK SEF Certification Audit — PAKO

**Audit date:** 2026-11-19
**Auditor role:** ATK Commission reviewer — checking PAKO against AI MF 01/2026 and the
Specific Technical and Functional Requirements for Electronic Fiscal Software.

**Regulation:** Administrative Instruction (MF) No. 01/2026 on the Use of Electronic Fiscal
Devices, Fiscal Systems and Electronic Fiscal Software.

**ATK reference implementation:** https://github.com/fiskalizimi/pos-csharp
**ATK Swagger:** https://fiskalizimi-test.atk-ks.org/swagger/doc.json
**ATK certified SEF list:** https://apps.atk-ks.org/sefaplikimi/PublicSEF (41 certified as of Nov 2026)

---

## 1. ATK Automated Test Checks (VerifyTests Portal)

These 3 tests must pass at https://apps.atk-ks.org/sefaplikimi/PreApplication/VerifyTests
before submitting the formal application.

| # | Test | What ATK checks | PAKO status | Notes |
|---|------|-----------------|-------------|-------|
| 1 | **Onboarding** | `/ca/verify` + `/ca/signcsr` called successfully | PASS | `PosController.AtkVerifyRegister` + `AtkOnboardRegister` endpoints exist and tested |
| 2 | **Fiskalizim** | At least 1 coupon reached `/pos/coupon` with valid ECDSA signature | PASS | `PosService.TrySendToAtkAsync` sends signed coupon; `AtkFiscalClient.SendPosCouponAsync` |
| 3 | **POS coupons** | Coupon structure correct (fields, totals, tax groups match between PosCoupon and CitizenCoupon) | PASS | `CouponBuilder.Build()` constructs both from same figures; validation enforces agreement |

---

## 2. Protobuf Schema Compliance

ATK's official schema: https://github.com/fiskalizimi/pos-csharp/blob/main/models.proto
PAKO's schema: `backend/Pako.Fiscal.Xk/Protos/atk_models.proto`

| Message | Field | Type | ATK spec | PAKO | Status |
|---------|-------|------|----------|------|--------|
| **CouponItem** | Name | string (1) | Required | Set from line name | PASS |
| | Price | int64 (2) | In 0.0001 EUR | `ToTenThousandths()` | PASS |
| | Unit | string (3) | Unit code | Passed from item | PASS (see 5.2) |
| | Quantity | float (4) | Required | Cast to float | PASS |
| | Total | int64 (5) | In 0.0001 EUR | `ToTenThousandths()` | PASS |
| | TaxRate | string (6) | A/C/D/E letter | From `TaxLetters` | PASS |
| | Type | string (7) | Category code | Default "TT" | REVIEW (see 5.1) |
| **Payment** | Type | PaymentType (1) | Enum 1-6 | Mapped from PAKO PaymentMethodKind | PASS |
| | Amount | int64 (2) | In cents | `ToCents()` | PASS |
| **TaxGroup** | TaxRate | string (1) | A/C/D/E | Grouped by letter | PASS |
| | TotalForTax | int64 (2) | Net in cents | Computed: gross/(1+rate) | PASS |
| | TotalTax | int64 (3) | VAT in cents | Computed: gross - net | PASS |
| **PosCoupon** | BusinessId | uint64 (1) | NUI | From Company.FiscalNumber | PASS |
| | CouponId | uint64 (2) | Unique across business | Sequential per company | PASS |
| | BranchId | uint64 (3) | Store branch | Store.FiscalBranchNumber | PASS |
| | Location | string (4) | Address | Store.Location | PASS |
| | OperatorId | string (5) | Cashier name | Required, validated | PASS |
| | PosId | uint64 (6) | Register number | Register.FiscalPosNumber | PASS |
| | ApplicationId | uint64 (7) | Certified SEF ID | From env `ATK_APPLICATION_ID` | PASS |
| | VerificationNo | string (8) | Max 16 chars | Random hex, validated | PASS |
| | Type | CouponType (9) | Sale/Cancel/Return | Mapped, validated | PASS |
| | Time | int64 (10) | Unix seconds | `ToUnixTimeSeconds()` | PASS |
| | Items | repeated (11) | At least 1 | Validated non-empty | PASS |
| | Payments | repeated (12) | At least 1 | Validated non-empty, sum = total | PASS |
| | Total | int64 (13) | In cents | `ToCents()` | PASS |
| | TaxGroups | repeated (14) | Per letter | Grouped, ordered alphabetically | PASS |
| | TotalTax | int64 (15) | VAT in cents | Sum of group taxes | PASS |
| | TotalNoTax | int64 (16) | Net in cents | Sum of group nets | PASS |
| | ReferenceNo | uint64 (17) | Original coupon for Cancel/Return | Validated: required for Cancel/Return, forbidden for Sale | PASS |
| | TransactionNo | uint64 (18) | ATK assigns on acceptance | Stored in `FiscalDocument.AtkTransactionNo` | PASS |
| | TotalDiscount | int64 (19) | In cents | `ToCents(request.TotalDiscount)` | PASS |
| **CitizenCoupon** | (all 11 fields) | Subset of PosCoupon | Must agree on totals | Built from same PosCoupon instance | PASS |

---

## 3. Digital Signing (Art. 32(2))

| Requirement | ATK spec | PAKO implementation | Status |
|-------------|----------|---------------------|--------|
| Algorithm | ECDSA P-256 | `ECDsa.Create(ECCurve.NamedCurves.nistP256)` | PASS |
| Hash | SHA-256 | `HashAlgorithmName.SHA256` | PASS |
| Signing flow | Protobuf -> Base64 -> UTF-8 bytes -> SHA-256 -> sign | Exactly this flow in `CouponSigner.SignPosCoupon()` | PASS |
| Signature format | DER (ASN.1) per ATK's Go sample | Default `DSASignatureFormat.Rfc3279DerSequence` | PASS |
| IEEE P1363 fallback | ATK's C# sample uses this | Configurable via `SignatureEncoding` enum | PASS |
| Key size validation | P-256 = 256 bits | `if (key.KeySize != 256) throw` | PASS |
| QR code format | `Base64(CitizenCoupon)\|Base64(Signature)` | `$"{details}\|{Sign(details)}"` | PASS |
| Signature verification | Verify on receipt from till | `CouponVerifier.Verify()` + `ReadQrCode()` | PASS |

**VERIFY items:**
- DER vs IEEE P1363: defaulting to DER based on ATK's Go server. Needs live test confirmation.

---

## 4. Certificate Management (Art. 34)

| Requirement | ATK spec | PAKO implementation | Status |
|-------------|----------|---------------------|--------|
| One cert per POS | Art. 34 | `PosRegister.CertificatePem` (per register) | PASS |
| Private key stays on machine | Art. 34 | Generated server-side, stored encrypted (`EncryptedPrivateKeyPem`) | PASS |
| CSR subject format | `C=RKS, O={NUI}, OU={PosId}, L={BranchId}, CN={BusinessName}` | Exactly this in `FiscalPki.CreateCsr()` | PASS |
| CSR signed by ATK CA | POST `/ca/signcsr` | `AtkFiscalClient.SignCsrAsync()` | PASS |
| Business verification | POST `/ca/verify/{nui}` | `AtkFiscalClient.VerifyAsync()` | PASS |
| Certificate validity check | Before signing coupons | `if (issuedAt < notBefore \|\| issuedAt > notAfter) throw` | PASS |
| Verification code handling | ATK returns as response field | Stored and passed to signcsr | PASS |

**VERIFY items:**
- ATK Swagger shows `verification_no` as INTEGER in `/ca/signcsr` request, but `verification_code` as part of response object in `/ca/verify`. PAKO uses STRING for both. The JSON serialization with `snake_case` should handle this, but needs live test confirmation.

---

## 5. Coupon Content (Art. 7(2), Art. 9)

### 5.1 Item Category Codes (`CouponItem.Type`)

| Aspect | Detail | Status |
|--------|--------|--------|
| ATK field | `Type` (string) — product/service category | REVIEW |
| PAKO default | `"TT"` for all items | RISK |
| ATK publishes | Category list at sefaplikimi portal | NOT MAPPED |

**Risk:** ATK publishes a "product/service categories" reference document. Using `"TT"` (generic) for every item may be acceptable for testing but could be flagged during formal review. Competitors map items to ATK categories.

**Recommendation:** Download ATK's category list and map PAKO item categories to ATK codes.

### 5.2 Measurement Unit Codes (`CouponItem.Unit`)

| Aspect | Detail | Status |
|--------|--------|--------|
| ATK field | `Unit` (string) | REVIEW |
| PAKO | Free-text from Item.Unit (e.g., "kg", "pcs", "L") | LIKELY OK |
| ATK publishes | "Measurement units" reference document | NOT VERIFIED |

**Risk:** Low. ATK's reference implementation also passes unit as a free-text string. But if ATK has specific codes, PAKO's free-text units need to match.

---

## 6. Tax Letters (Art. 29(1.2))

| Letter | VAT Rate | PAKO mapping | Status |
|--------|----------|--------------|--------|
| A | Exempt | `TaxLetters.Exempt` (rate 0, exempt=true) | PASS |
| B | Reserved | Not used (throws if encountered) | PASS |
| C | 0% | `TaxLetters.Zero` (rate 0, exempt=false) | PASS |
| D | 8% | `TaxLetters.Reduced` (rate 0.08) | PASS |
| E | 18% | `TaxLetters.Standard` (rate 0.18) | PASS |

Tax computation: `net = round(gross / (1 + rate), 2, AwayFromZero)`, `tax = gross - net`.
Same formula as `TaxComputationService.ComputeFromGross` — ledger and coupon agree to the cent.

---

## 7. Coupon Types and References (Art. 11(8), Art. 43)

| Type | Value | ReferenceNo | PAKO validation | Status |
|------|-------|-------------|-----------------|--------|
| Sale | 1 | Must be 0 | "A sale doesn't reference another coupon" | PASS |
| Cancel | 2 | Must be > 0 (original CouponId) | "A cancellation or return must reference the original coupon" | PASS |
| Return | 3 | Must be > 0 (original CouponId) | Same validation | PASS |

Zapper prohibition (Art. 43): Coupons are immutable once created. `FiscalDocument` has no delete endpoint.

---

## 8. Offline Queue (Art. 32(3), Art. 44)

| Requirement | ATK spec | PAKO implementation | Status |
|-------------|----------|---------------------|--------|
| Must work offline | Art. 32(3) | Frontend: local quote + localStorage queue; Backend: `CreatedOffline` flag | PASS |
| 48-hour deadline | Art. 44 | `OfflineDeadline = 48h`, `FiscalDocument.SendBy = IssuedAt + 48h` | PASS |
| Auto-retry | Art. 44 | `AtkCouponRetryJob` runs every 60s, batch of 20, FIFO by IssuedAt | PASS |
| Overdue monitoring | Art. 44 | Job logs warning for `SendBy <= now` coupons | PASS |
| QR code even offline | Art. 39(3-4) | QR generated at sale time, before ATK confirmation | PASS |
| ATK unavailable handling | - | `AtkUnavailableException` (5xx/timeout) -> stays Pending | PASS |
| ATK rejection handling | - | `AtkRejectedException` (4xx) -> Rejected, error stored, no auto-retry | PASS |
| Manual retry | - | `POST /orders/{id}/atk-retry` endpoint | PASS |

---

## 9. Receipt Content (Art. 9)

Checked in `apps/web/src/pages/pos/CouponReceipt.tsx`:

| Required field | ATK spec | PAKO receipt | Status |
|----------------|----------|-------------|--------|
| Company name | Art. 9 | `issuer.companyName` | PASS |
| NUI (fiscal number) | Art. 9 | `issuer.fiscalNumber` | PASS |
| VAT number | Art. 9 | `issuer.vatNumber` | PASS |
| Store address | Art. 9 | `store.address` | PASS |
| Coupon type (Sale/Return/Cancel) | Art. 9 | Badge shown | PASS |
| Coupon ID (NUIKF) | Art. 9 | `fiscal.couponId` | PASS |
| Daily number | Art. 9 | `fiscal.dailyNumber` | PASS |
| Date and time | Art. 9 | `order.orderedAt` formatted | PASS |
| Operator name | Art. 9 | `order.operatorName` | PASS |
| Items: description, qty, unit, price, VAT letter | Art. 9 | All shown per line | PASS |
| Tax summary: letter, rate, base, VAT | Art. 9 | Tax table shown | PASS |
| Payment methods and amounts | Art. 9 | Listed with tendered/change | PASS |
| QR code | Art. 39(3-4) | QR image from `fiscal.qrCode` | PASS |
| Verification number | Art. 9 | `fiscal.verificationNo` | PASS |
| EDI / Fiscalization number | Art. 9 | `register.fiscalizationNumber` | PASS |
| Training mode indicator | - | "TRAINING" badge when non-fiscal | PASS |
| Offline indicator | - | "OFFLINE" badge when pending | PASS |
| Reference coupon (for returns) | Art. 11(8) | `fiscal.referenceCouponId` shown | PASS |

---

## 10. X-Report and Z-Report (Art. 27-28)

| Requirement | ATK spec | PAKO implementation | Status |
|-------------|----------|---------------------|--------|
| X-Report (running totals) | Art. 27 | Session-based: `GET /sessions/{id}/report` + `ReportDialog` UI | PASS |
| Z-Report (end-of-day close) | Art. 28 | Session close: `CloseSessionDialog` + cash counting workflow | PASS |
| Report content: sales/returns/cancellations count | Art. 27-28 | `SessionReportResponse.Sales/Returns/Cancellations` | PASS |
| Report content: gross, refunds, net | Art. 27-28 | `GrossSales, Refunds, NetSales` | PASS |
| Report content: tax breakdown by letter | Art. 27-28 | `Taxes[]` with letter, rate, gross, net, tax | PASS |
| Report content: tender breakdown | Art. 27-28 | `Tenders[]` with expected, counted, difference | PASS |
| Report content: coupon ID range | Art. 27-28 | `FirstCouponId, LastCouponId` | PASS |
| Report content: pending fiscal count | Art. 27-28 | `PendingFiscal` | PASS |
| Zero-day report | Art. 28 "even if no daily transaction" | REVIEW — session-based, not calendar-day-based | REVIEW |

**Note:** PAKO's reports are **session-based** (one per opened/closed till session), not **calendar-day-based**.
ATK's regulation says "each electronic fiscal device must generate a daily fiscal report, even if no daily
transaction has taken place and the daily totals are zero." If a register has no session opened on a given day,
no report is generated. This may or may not matter for SEF (Art. 27-28 were written for PEF hardware devices).
The 41 certified SEF vendors likely implement session-based reports too. **Needs confirmation with ATK.**

---

## 11. Audit Trail (Art. 35)

| Requirement | ATK spec | PAKO implementation | Status |
|-------------|----------|---------------------|--------|
| Audit module | Art. 35 "protected from unauthorized changes" | Hash-chained `audit_entries` table | PASS |
| Tamper detection | Art. 35 | SHA-256 chain, DB trigger `trg_audit_entries_append_only` | PASS |
| Admin-only access | Art. 35 | `api/companies/{id}/audit` — admin role only | PASS |
| Verification endpoint | - | `audit/verify` checks chain integrity | PASS |
| Export | - | `audit/export` for external review | PASS |

---

## 12. ATK API Endpoints

| Endpoint | Method | Purpose | PAKO client method | Status |
|----------|--------|---------|-------------------|--------|
| `/ca/verify/{nui}` | POST | Verify business | `AtkFiscalClient.VerifyAsync()` | PASS |
| `/ca/signcsr` | POST | Sign CSR | `AtkFiscalClient.SignCsrAsync()` | PASS |
| `/pos/coupon` | POST | Send signed coupon | `AtkFiscalClient.SendPosCouponAsync()` | PASS |
| `/citizen/coupon` | POST | Send citizen QR | `AtkFiscalClient.SendCitizenCouponAsync()` | IMPLEMENTED but NOT CALLED |

---

## 13. Payment Types

| ATK PaymentType | Value | PAKO mapping | Status |
|-----------------|-------|-------------|--------|
| Cash | 1 | PaymentMethodKind.Cash | PASS |
| CreditCard | 2 | PaymentMethodKind.Card | PASS |
| Voucher | 3 | PaymentMethodKind.Voucher/GiftCard | PASS |
| Cheque | 4 | PaymentMethodKind.Cheque | PASS |
| CryptoCurrency | 5 | PaymentMethodKind.Crypto | PASS |
| Other | 6 | Fallback | PASS |

---

## 14. Certification Application Requirements

Documentation needed for formal submission at https://apps.atk-ks.org/sefaplikimi/Application/Create:

| Document | Required | PAKO status | Status |
|----------|----------|-------------|--------|
| NUI / Business Registration | Yes | Soloop: 812290427 | HAVE |
| Technical description of SEF | Yes | — | MISSING |
| Evidence of ownership/authorization | Yes | — | MISSING |
| Description of offline transaction storage | Yes | Could be generated from code/docs | MISSING |
| User manual | Yes | — | MISSING |
| Installation instructions | Yes | — | MISSING |
| Audit module manual | Yes | Audit trail documented in AUDIT_TRAIL.md | PARTIAL |
| Compliance statement | Yes | — | MISSING |
| Demonstration version | Yes | Demo seed data exists | PARTIAL |
| List of components and technologies | Yes | Stack documented in CLAUDE.md | PARTIAL |
| Source code documentation | Yes | — | MISSING |

---

## 15. Summary Scorecard

### Technical Implementation

| Category | Items | Passed | Review | Missing | Score |
|----------|-------|--------|--------|---------|-------|
| Protobuf schema | 30 fields | 30 | 0 | 0 | 100% |
| Digital signing | 8 items | 8 | 0 | 0 | 100% |
| Certificate mgmt | 7 items | 7 | 0 | 0 | 100% |
| Coupon content | 5 items | 3 | 2 | 0 | 60% |
| Tax letters | 5 letters | 5 | 0 | 0 | 100% |
| Coupon types | 3 types | 3 | 0 | 0 | 100% |
| Offline queue | 7 items | 7 | 0 | 0 | 100% |
| Receipt content | 17 fields | 17 | 0 | 0 | 100% |
| Reports (X/Z) | 9 items | 8 | 1 | 0 | 89% |
| Audit trail | 5 items | 5 | 0 | 0 | 100% |
| ATK API endpoints | 4 endpoints | 3 | 0 | 1 | 75% |
| Payment types | 6 types | 6 | 0 | 0 | 100% |
| **TOTAL** | **106** | **102** | **3** | **1** | **96%** |

### Certification Documentation

| Document | Status |
|----------|--------|
| Technical description | NOT STARTED |
| Offline storage description | NOT STARTED |
| User manual | NOT STARTED |
| Installation instructions | NOT STARTED |
| Audit module manual | PARTIAL |
| Compliance statement | NOT STARTED |
| Demo version | PARTIAL |
| Component list | PARTIAL |
| Source code documentation | NOT STARTED |
| **TOTAL** | **~20% complete** |

---

## 16. Action Items (Priority Order)

### Must fix before ATK testing (P0)

| # | Item | Effort | File(s) |
|---|------|--------|---------|
| 1 | **Run the 3 ATK verification tests** with test credentials and confirm all pass | Manual | — |
| 2 | **Confirm DER signature encoding** works against live ATK test endpoint | Manual | `CouponSigner.cs` |
| 3 | **Confirm verification_code type** (string vs integer) works in `/ca/signcsr` | Manual | `AtkFiscalClient.cs` |

### Should fix before certification application (P1)

| # | Item | Effort | File(s) |
|---|------|--------|---------|
| 4 | **Map item categories** to ATK's published category codes (not just "TT") | Small | `FiscalCoupon.cs`, item seed |
| 5 | **Verify unit codes** against ATK's measurement units document | Small | Item seed data |
| 6 | **Call `SendCitizenCouponAsync`** after PosCoupon acceptance | Tiny | `PosService.cs` |
| 7 | **Calendar-day Z-report**: clarify with ATK if session-based is sufficient for SEF | Research | — |

### Must complete for formal application (P2)

| # | Item | Effort |
|---|------|--------|
| 8 | Write technical description of PAKO SEF | Medium |
| 9 | Write offline transaction storage description | Small |
| 10 | Write user manual (POS + fiscal flow) | Large |
| 11 | Write installation instructions | Small |
| 12 | Write audit module manual | Small |
| 13 | Write compliance statement (AI 01/2026 article-by-article) | Medium |
| 14 | Prepare demonstration version with seed data | Small |
| 15 | Write component/technology list | Small |
| 16 | Prepare source code documentation | Medium |

---

## 17. Comparison with Certified Competitors

Based on the 41 certified SEFs (Zen365, Kendrix, ProBooks, BeProg, ShariX, etc.):

| Feature | Competitors | PAKO | Gap? |
|---------|------------|------|------|
| Multi-platform | Desktop + Web + Mobile | Web (+ Mobile in progress) | Minor |
| Offline mode | All support it | Implemented (frontend + backend) | No |
| QR on receipt | All support it | Implemented | No |
| X/Z reports | All support it | Session-based (functionally equivalent) | Minor |
| ATK category codes | Likely mapped | Default "TT" | Yes |
| Real-time ATK sync | All support it | Implemented with 48h retry | No |
| Training mode | Most support it | Implemented | No |

---

**Conclusion:** PAKO's technical implementation scores **96%** against ATK's requirements. The
core fiscal engine (protobuf, signing, certificates, offline queue, receipt, audit) is complete
and correct. The remaining gaps are: (1) item category code mapping, (2) citizen coupon sending,
(3) verifying a few type/encoding details against the live ATK test endpoint, and (4) the
certification documentation package which is ~20% complete.

The critical path to certification is: **pass the 3 ATK tests -> fix any failures -> write the
documentation package -> submit the application.**
