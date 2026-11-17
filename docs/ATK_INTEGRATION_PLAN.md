# ATK SEF Integration Plan

End-to-end implementation to connect PAKO to ATK's fiscalization service and get certified.

**Legal basis:** Administrative Instruction (MF) No. 01/2026, Law 08/L-257.
**ATK reference:** https://github.com/fiskalizimi (C#, Go, PHP, Ruby samples).
**Swagger:** https://fiskalizimi-test.atk-ks.org/swagger/index.html
**Test credentials (Soloop):** ApplicationID `895741008848`, Fiscalization No `694539400125`, NUI `812290427`.

---

## What already exists

| Component | File | Status |
|-----------|------|--------|
| Protobuf schema (PosCoupon, CitizenCoupon) | `Pako.Fiscal.Xk/Protos/atk_models.proto` | Done |
| CouponBuilder (builds both payloads) | `Pako.Fiscal.Xk/CouponBuilder.cs` | Done |
| CouponSigner (ECDSA P-256, QR) | `Pako.Fiscal.Xk/CouponSigner.cs` | Done |
| AtkFiscalClient (HTTP to ATK) | `Pako.Fiscal.Xk/AtkFiscalClient.cs` | Done |
| FiscalPki (key gen, CSR, cert reading) | `Pako.Fiscal.Xk/FiscalPki.cs` | Done |
| TaxLetters (rate → A/C/D/E) | `Pako.Fiscal.Xk/TaxLetters.cs` | Done |
| FiscalDocument entity (DB persistence) | `Pako.Domain/Pos/FiscalDocument.cs` | Done |
| AtkStatus enum (NotSent/Pending/Accepted/Rejected) | `Pako.Domain/Pos/FiscalDocument.cs` | Done |
| Store.FiscalBranchNumber, Register.FiscalPosNumber | `Pako.Domain/Pos/Store.cs` | Done |
| Register.CertificatePem + upload endpoint | `PosController.SaveCertificate` | Done |
| PosService.FiscalizeAsync (Training + SEF verify) | `Pako.Api/Services/PosService.cs` | Done |
| CouponReceipt (72mm receipt + QR) | `apps/web/src/pages/pos/CouponReceipt.tsx` | Done |
| Test suite | `Pako.Tests/FiscalSefTests.cs` | Done |
| SefProvider | `Pako.Domain/Fiscal/SefProvider.cs` | **Stub** |
| Background job infrastructure | `BackgroundJobs.cs` / `IScheduledJob` | Pattern exists |

---

## Implementation phases

### Phase 1: Onboarding flow (register → ATK certificate)

**Goal:** A store admin can onboard a POS register with ATK from the web UI.

#### 1.1 Backend: Onboarding endpoints

Add to `PosController.cs`:

```
POST /api/companies/{companyId}/pos/registers/{registerId}/atk-verify
  → calls AtkFiscalClient.VerifyAsync(nui, fiscalizationNo, posId, branchId, applicationId)
  → returns { businessName, verificationCode }
  → stores verificationCode on the register temporarily

POST /api/companies/{companyId}/pos/registers/{registerId}/atk-generate-key
  → calls FiscalPki.GenerateKey()
  → stores private key securely (DPAPI on Windows, or encrypted in DB)
  → creates CSR via FiscalPki.CreateCsr()
  → calls AtkFiscalClient.SignCsrAsync()
  → stores signed certificate PEM on register (CertificatePem)
  → returns success + certificate expiry date
```

**Data needed from the register's store/register record:**
- `Company.FiscalNumber` → ATK `business_id` (NUI)
- `Store.FiscalBranchNumber` → ATK `branch_id`
- `Register.FiscalPosNumber` → ATK `pos_id`
- `Register.FiscalizationNumber` → ATK `fiscalization_no`
- Env var `ATK_APPLICATION_ID` → ATK `application_id`

**CSR subject** (must match ATK's format exactly):
```
C=RKS, O={NUI}, OU={PosId}, L={BranchId}, CN={BusinessName}
```

**Security:** The private key must never leave the machine. For a cloud-hosted setup, encrypt it at rest in the DB (consider `Register.EncryptedPrivateKeyPem` with a per-deployment encryption key from env vars).

#### 1.2 Frontend: Onboarding UI

In `PosSetup.tsx` (Stores & registers page), add to the register edit/detail:

1. **"Connect to ATK" button** — visible when register has `FiscalPosNumber` and `FiscalizationNumber` set but no certificate.
2. Click → calls `atk-verify` → shows business name confirmation.
3. Click "Generate certificate" → calls `atk-generate-key` → shows success + expiry.
4. Register card shows certificate status (none / valid / expiring / expired).

#### 1.3 Tests

- `Onboarding_VerifiesBusinessAndGetsCertificate` — mock ATK HTTP, assert CSR subject format, assert certificate stored.
- `Onboarding_RefusesWhenFiscalFieldsMissing` — no branch number, no POS number → 400.

---

### Phase 2: Live coupon sending (the SEF flow)

**Goal:** When a register is in SEF mode with a valid certificate, coupons are sent to ATK in real-time.

#### 2.1 Backend: Send coupon to ATK after sale

In `PosService.FiscalizeAsync()`, after storing the `FiscalDocument`:

```csharp
if (register.FiscalMode == FiscalMode.Sef && fiscal.AtkStatus == AtkStatus.Pending)
{
    try
    {
        var response = await _atkClient.SendPosCouponAsync(
            new SignedPosCoupon(fiscal.PosCouponDetails, fiscal.Signature));
        fiscal.AtkStatus = AtkStatus.Accepted;
        fiscal.AtkTransactionNo = response.TransactionId;
        fiscal.SentAt = DateTime.UtcNow;
    }
    catch (AtkUnavailableException)
    {
        // Stay Pending — the background job will retry (Phase 3).
        fiscal.SendBy = DateTime.UtcNow.AddHours(48);
    }
    catch (AtkRejectedException ex)
    {
        fiscal.AtkStatus = AtkStatus.Rejected;
        fiscal.AtkError = ex.Error;
    }
}
```

**Wire up `AtkFiscalClient`** in DI (`Program.cs`):
```csharp
services.AddHttpClient<AtkFiscalClient>(client =>
{
    var url = builder.Configuration["ATK_BASE_URL"] ?? "https://fiskalizimi-test.atk-ks.org";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(10);
});
```

#### 2.2 Register mode switch

The register's mode switch from Training → SEF should:
- Require a valid, non-expired certificate
- Require `FiscalPosNumber`, `FiscalBranchNumber`, `FiscalizationNumber` all set
- Be irreversible (once you go SEF, you can't go back to Training — every sale is real)

#### 2.3 Tests

- `SefSale_SendsCouponToAtk_ReturnsTransactionId` — mock ATK 200.
- `SefSale_AtkDown_StaysPending` — mock ATK 500/timeout → `AtkStatus.Pending`, `SendBy` set.
- `SefSale_AtkRejects_MarkedRejected` — mock ATK 400 → `AtkStatus.Rejected`, error stored.

---

### Phase 3: Background retry job (offline queue)

**Goal:** Coupons that couldn't reach ATK at sale time are retried automatically, within the 48-hour deadline.

#### 3.1 Backend: `AtkCouponRetryJob`

Add a new `IScheduledJob` in `BackgroundJobs.cs` (runs every minute via existing `BackgroundJobsHostedService`):

```
AtkCouponRetryJob:
  1. Query: FiscalDocuments WHERE AtkStatus = Pending AND SendBy > now, ORDER BY IssuedAt, LIMIT 20
  2. For each: call AtkFiscalClient.SendPosCouponAsync()
     - 200 → Accepted, store TransactionId
     - 5xx/timeout → increment Attempts, leave Pending
     - 4xx → Rejected, store error
  3. Query: FiscalDocuments WHERE AtkStatus = Pending AND SendBy <= now
     - These have breached the 48h deadline — flag as overdue (new AtkStatus.Overdue? or log alert)
```

**Unlike daily jobs, this should run every tick (1 min) not once per day.** Modify the job's `IsDue()` to always return true, or add a separate timer.

#### 3.2 Tests

- `RetryJob_SendsPendingCoupons_InOrder`
- `RetryJob_RespectsMaxAttempts`
- `RetryJob_FlagsOverdueCoupons`

---

### Phase 4: Coupon status monitoring UI

**Goal:** Back office users can see which coupons reached ATK, which are pending, and which failed.

#### 4.1 Backend: Endpoint already exists

The existing `PosHome` / orders list already shows `AtkStatus` per order. Enhance if needed:

- Add a filter for ATK status on the orders paged endpoint (Pending/Rejected/Accepted).
- Add a `POST /api/companies/{id}/pos/orders/{orderId}/atk-retry` to manually retry a rejected coupon.

#### 4.2 Frontend: Status indicators

In `PosHome.tsx` (already shows ATK status column):
- **Pending** → yellow badge, tooltip "Waiting to reach ATK"
- **Accepted** → green badge with transaction number
- **Rejected** → red badge with error message + "Retry" button
- **Overdue** → red badge "48h deadline passed"

Add a summary card at the top: "X pending, Y rejected" with a link to filter.

#### 4.3 Tests

- Filter by ATK status works.
- Retry button calls the retry endpoint.

---

### Phase 5: Citizen coupon (QR verification)

**Goal:** The QR code on the receipt is also sent to ATK for citizen verification.

#### 5.1 Backend

After the PosCoupon is accepted, also send the citizen coupon:

```csharp
await _atkClient.SendCitizenCouponAsync(fiscal.QrCode);
```

This is optional (ATK doesn't require it for certification) but enables customers to verify receipts on ATK's portal.

---

### Phase 6: Testing against ATK

**Goal:** Pass all 3 ATK test checks (onboarding, fiscalization, POS coupons).

#### 6.1 Steps

1. **Set env vars** to point at test environment (already done in `launchSettings.json`).
2. **Create a test store** with `FiscalBranchNumber = 1`.
3. **Create a test register** with `FiscalPosNumber = 1`, `FiscalizationNumber = 694539400125`.
4. **Run onboarding** (Phase 1) → get test certificate from ATK.
5. **Switch register to SEF mode.**
6. **Make 3 sales** (one normal, one return referencing the first, one cancellation).
7. **Verify on ATK portal:** https://apps.atk-ks.org/sefaplikimi/PreApplication/VerifyTests
   ApplicationID: `895741008848`, Fiscalization No: `694539400125`.
8. All 3 checks (onboarding, fiskalizim, POS coupons) must show green.

#### 6.2 What ATK checks

| Test | What it validates |
|------|-------------------|
| Onboarding | `/ca/verify` + `/ca/signcsr` were called successfully |
| Fiskalizim | At least one coupon reached `/pos/coupon` with valid signature |
| POS coupons | Coupon structure is correct (fields, totals, tax groups match) |

---

### Phase 7: Certification application

**Goal:** Submit PAKO for formal ATK certification.

1. All Phase 6 tests pass.
2. Go to https://apps.atk-ks.org/sefaplikimi/Application/Create.
3. Fill in Soloop's details + PAKO's version + supported platforms (Web).
4. ATK reviews and assigns a **SEF number** + real **application_id**.
5. Update `ATK_APPLICATION_ID` env var with the real value.
6. Switch `ATK_BASE_URL` to `https://fiskalizimi.atk-ks.org` for production.

---

## Implementation order & estimates

| # | Phase | Depends on | Scope |
|---|-------|-----------|-------|
| 1 | Onboarding flow | Nothing | 2 endpoints + UI + tests |
| 2 | Live coupon sending | Phase 1 | Edit FiscalizeAsync + DI wiring + tests |
| 3 | Background retry | Phase 2 | 1 scheduled job + tests |
| 4 | Status monitoring UI | Phase 2 | Filter + retry button + badges |
| 5 | Citizen coupon | Phase 2 | 1 extra API call (optional) |
| 6 | ATK testing | Phases 1-3 | Manual testing + verification |
| 7 | Certification | Phase 6 | Application submission |

Phases 1-3 are the critical path. Phase 4 is polish. Phase 5 is optional. Phases 6-7 are process, not code.

---

## Env vars needed

| Variable | Test | Production |
|----------|------|-----------|
| `ATK_BASE_URL` | `https://fiskalizimi-test.atk-ks.org` | `https://fiskalizimi.atk-ks.org` |
| `ATK_FISCALIZATION_NO` | `694539400125` | Per-company (from ATK EDI) |
| `ATK_APPLICATION_ID` | `1` | ATK-assigned SEF number |
| `ATK_PRIVATE_KEY_ENCRYPTION_KEY` | Generate a 256-bit key | Different key, securely stored |

---

## Files to create/modify

### New files
- `Pako.Api/Services/AtkCouponRetryJob.cs` — background retry job (Phase 3)

### Modified files
- `Pako.Api/Services/PosService.cs` — add ATK send after fiscalize (Phase 2)
- `Pako.Api/Controllers/PosController.cs` — add onboarding endpoints (Phase 1)
- `Pako.Api/Program.cs` — register `AtkFiscalClient` in DI (Phase 2)
- `Pako.Domain/Pos/Store.cs` — add `EncryptedPrivateKeyPem` to Register (Phase 1)
- `Pako.Api/Services/Notifications/BackgroundJobs.cs` — register retry job (Phase 3)
- `apps/web/src/pages/pos/PosSetup.tsx` — onboarding UI (Phase 1)
- `apps/web/src/pages/pos/PosHome.tsx` — status badges + retry (Phase 4)
- `Pako.Tests/FiscalSefTests.cs` — new tests for all phases

### Not modified
- `Pako.Fiscal.Xk/*` — all fiscal crypto code is done and matches ATK spec
- `Pako.Domain/Pos/FiscalDocument.cs` — schema already has all needed fields
- `apps/web/src/pages/pos/CouponReceipt.tsx` — receipt rendering is done
