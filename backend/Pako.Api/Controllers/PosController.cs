using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Fiscal.Xk;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md — the point of sale. Pos: Read sees sessions and orders; Write sells, moves cash
// and closes its own session; Approve sets up stores and registers and makes returns and
// cancellations (D14). Every request is refused while the company's POS module is off.
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PosService _pos;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    private readonly PosOperatorService _operators;

    public PosController(PakoDbContext db, PosService pos, PriceListService prices, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access,
        PosOperatorService operators)
    {
        _db = db;
        _pos = pos;
        _prices = prices;
        _localizer = localizer;
        _access = access;
        _operators = operators;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ---- Stores ----

    [HttpGet("stores", Name = "ListPosStores")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<StoreResponse>>> Stores(Guid companyId) =>
        Ok((await _db.PosStores.AsNoTracking().Where(s => s.CompanyId == companyId).OrderBy(s => s.Code).ToListAsync()).Select(ToResponse).ToList());

    [HttpPost("stores", Name = "CreatePosStore")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(StoreResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<StoreResponse>> CreateStore(Guid companyId, SaveStoreRequest request)
    {
        if (await ValidateStoreAsync(companyId, null, request) is { } error) return BadRequest(error);
        var store = new Store { Id = Guid.NewGuid(), CompanyId = companyId };
        Apply(store, request);
        _db.PosStores.Add(store);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(store));
    }

    [HttpPut("stores/{storeId:guid}", Name = "UpdatePosStore")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<StoreResponse>> UpdateStore(Guid companyId, Guid storeId, SaveStoreRequest request)
    {
        var store = await _db.PosStores.FirstOrDefaultAsync(s => s.Id == storeId && s.CompanyId == companyId);
        if (store is null) return NotFound();
        if (await ValidateStoreAsync(companyId, storeId, request) is { } error) return BadRequest(error);
        // ATK knows the shop by its branch number: once a coupon carries it, it can't change.
        if (store.FiscalBranchNumber != request.FiscalBranchNumber
            && await _db.FiscalDocuments.AnyAsync(d => _db.PosRegisters.Any(r => r.Id == d.RegisterId && r.StoreId == storeId)))
        {
            return BadRequest(_localizer["PosFiscalIdentityLocked"].Value);
        }
        Apply(store, request);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(store));
    }

    private async Task<string?> ValidateStoreAsync(Guid companyId, Guid? id, SaveStoreRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Code) || string.IsNullOrWhiteSpace(r.Name) || string.IsNullOrWhiteSpace(r.Location)) return _localizer["PosStoreFieldsRequired"].Value;
        if (r.FiscalBranchNumber is < 1 or > 999) return _localizer["PosBranchNumberInvalid"].Value;
        if (await _db.PosStores.AnyAsync(s => s.CompanyId == companyId && s.Id != id && (s.Code == r.Code.Trim().ToUpper() || s.FiscalBranchNumber == r.FiscalBranchNumber)))
        {
            return _localizer["PosStoreTaken"].Value;
        }
        if (!await _db.Warehouses.AnyAsync(w => w.Id == r.WarehouseId && w.CompanyId == companyId && w.IsActive)) return _localizer["WarehouseNotFound"].Value;
        if (r.PriceListId is { } p && !await _db.PriceLists.AnyAsync(x => x.Id == p && x.CompanyId == companyId)) return _localizer["PriceListNotFound"].Value;
        if (r.TipsAccountId is { } t && !await _db.Accounts.AnyAsync(a => a.Id == t && a.CompanyId == companyId && a.IsActive && a.IsPostable)) return _localizer["PosAccountInvalid"].Value;
        if (r.TouristTaxItemId is { } tt && !await _db.Items.AnyAsync(i => i.Id == tt && i.CompanyId == companyId)) return _localizer["PosItemNotFound"].Value;
        return null;
    }

    private static void Apply(Store s, SaveStoreRequest r)
    {
        s.Code = r.Code.Trim().ToUpperInvariant();
        s.Name = r.Name.Trim();
        s.Address = string.IsNullOrWhiteSpace(r.Address) ? null : r.Address.Trim();
        s.FiscalBranchNumber = r.FiscalBranchNumber;
        s.Location = r.Location.Trim();
        s.WarehouseId = r.WarehouseId;
        s.PriceListId = r.PriceListId;
        s.ReceiptHeader = string.IsNullOrWhiteSpace(r.ReceiptHeader) ? null : r.ReceiptHeader.Trim();
        s.ReceiptFooter = string.IsNullOrWhiteSpace(r.ReceiptFooter) ? null : r.ReceiptFooter.Trim();
        s.IsActive = r.IsActive;
        s.TipsAccountId = r.TipsAccountId;
        s.TouristTaxItemId = r.TouristTaxItemId;
    }

    private static StoreResponse ToResponse(Store s) => new(s.Id, s.Code, s.Name, s.Address, s.FiscalBranchNumber, s.Location, s.WarehouseId,
        s.PriceListId, s.ReceiptHeader, s.ReceiptFooter, s.IsActive, s.TipsAccountId, s.TouristTaxItemId, s.BookingToken);

    // ---- Registers ----

    [HttpGet("registers", Name = "ListPosRegisters")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<RegisterResponse>>> Registers(Guid companyId)
    {
        var registers = await _db.PosRegisters.AsNoTracking().Where(r => r.CompanyId == companyId).OrderBy(r => r.Code).ToListAsync();
        var result = new List<RegisterResponse>();
        foreach (var r in registers) result.Add(await RegisterResponseAsync(r));
        return Ok(result);
    }

    [HttpPost("registers", Name = "CreatePosRegister")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(RegisterResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RegisterResponse>> CreateRegister(Guid companyId, SaveRegisterRequest request)
    {
        if (await ValidateRegisterAsync(companyId, null, request) is { } error) return BadRequest(error);
        var register = new PosRegister { Id = Guid.NewGuid(), CompanyId = companyId };
        Apply(register, request);
        _db.PosRegisters.Add(register);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await RegisterResponseAsync(register));
    }

    [HttpPut("registers/{registerId:guid}", Name = "UpdatePosRegister")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<RegisterResponse>> UpdateRegister(Guid companyId, Guid registerId, SaveRegisterRequest request)
    {
        var register = await _db.PosRegisters.FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        if (await ValidateRegisterAsync(companyId, registerId, request) is { } error) return BadRequest(error);
        // The fiscal identity of a till can't move while a session is open.
        if ((register.StoreId != request.StoreId || register.FiscalPosNumber != request.FiscalPosNumber || register.FiscalMode != request.FiscalMode)
            && await _db.PosSessions.AnyAsync(s => s.RegisterId == registerId && s.State == PosSessionState.Open))
        {
            return BadRequest(_localizer["PosSessionAlreadyOpen"].Value);
        }
        // Nor once a coupon carries it: ATK knows the till by branch and POS number.
        if ((register.StoreId != request.StoreId || register.FiscalPosNumber != request.FiscalPosNumber)
            && await _db.FiscalDocuments.AnyAsync(d => d.RegisterId == registerId))
        {
            return BadRequest(_localizer["PosFiscalIdentityLocked"].Value);
        }
        Apply(register, request);
        await _db.SaveChangesAsync();
        return Ok(await RegisterResponseAsync(register));
    }

    // The certificate ATK's CA signed for the till (Art. 34). Only its public part is kept here.
    [HttpPut("registers/{registerId:guid}/certificate", Name = "SavePosRegisterCertificate")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<RegisterResponse>> SaveCertificate(Guid companyId, Guid registerId, SaveRegisterCertificateRequest request)
    {
        var register = await _db.PosRegisters.FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        if (request.CertificatePem.Contains("PRIVATE KEY", StringComparison.OrdinalIgnoreCase)) return BadRequest(_localizer["PosPrivateKeyRefused"].Value);
        try
        {
            var (key, _, notAfter, thumbprint) = FiscalPki.ReadCertificate(request.CertificatePem);
            key.Dispose();
            register.CertificatePem = request.CertificatePem.Trim();
            register.CertificateThumbprint = thumbprint;
            register.CertificateNotAfter = notAfter;
        }
        catch (Exception ex) when (ex is FiscalCouponException or System.Security.Cryptography.CryptographicException or ArgumentException)
        {
            return BadRequest(_localizer["PosCertificateInvalid"].Value);
        }
        await _db.SaveChangesAsync();
        return Ok(await RegisterResponseAsync(register));
    }

    private async Task<string?> ValidateRegisterAsync(Guid companyId, Guid? id, SaveRegisterRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Code) || string.IsNullOrWhiteSpace(r.Name)) return _localizer["PosStoreFieldsRequired"].Value;
        if (r.FiscalPosNumber is < 1 or > 999) return _localizer["PosBranchNumberInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        if (await _db.PosRegisters.AnyAsync(x => x.CompanyId == companyId && x.Id != id
                && (x.Code == r.Code.Trim().ToUpper() || (x.StoreId == r.StoreId && x.FiscalPosNumber == r.FiscalPosNumber))))
        {
            return _localizer["PosRegisterTaken"].Value;
        }
        if (!await _db.Accounts.AnyAsync(a => a.Id == r.CashAccountId && a.CompanyId == companyId && a.AccountSubType == Domain.Ledger.AccountSubType.Cash && a.IsActive))
        {
            return _localizer["PosCashAccountInvalid"].Value;
        }
        if (r.FiscalMode == FiscalMode.Pef) return _localizer["PosFiscalModeUnsupported"].Value;
        return null;
    }

    private static void Apply(PosRegister r, SaveRegisterRequest q)
    {
        r.StoreId = q.StoreId;
        r.Code = q.Code.Trim().ToUpperInvariant();
        r.Name = q.Name.Trim();
        r.Profile = q.Profile;
        r.FiscalMode = q.FiscalMode;
        r.FiscalPosNumber = q.FiscalPosNumber;
        r.CashAccountId = q.CashAccountId;
        r.FiscalizationNumber = string.IsNullOrWhiteSpace(q.FiscalizationNumber) ? null : q.FiscalizationNumber.Trim();
        r.IsActive = q.IsActive;
    }

    private async Task<RegisterResponse> RegisterResponseAsync(PosRegister r)
    {
        var store = await _db.PosStores.AsNoTracking().Where(s => s.Id == r.StoreId).Select(s => s.Name).FirstOrDefaultAsync() ?? "?";
        var open = await _db.PosSessions.AsNoTracking().Where(s => s.RegisterId == r.Id && s.State == PosSessionState.Open).Select(s => (Guid?)s.Id).FirstOrDefaultAsync();
        return new RegisterResponse(r.Id, r.StoreId, store, r.Code, r.Name, r.Profile, r.FiscalMode, r.FiscalPosNumber, r.FiscalizationNumber,
            r.CashAccountId, r.IsActive, r.CertificateNotAfter, open);
    }

    // ---- The till ----

    // Everything the till needs to start: the register, its store, the open session, the tenders.
    [HttpGet("registers/{registerId:guid}/bootstrap", Name = "GetPosBootstrap")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosBootstrapResponse>> Bootstrap(Guid companyId, Guid registerId)
    {
        var register = await _db.PosRegisters.AsNoTracking().FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == register.StoreId);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var session = await _db.PosSessions.AsNoTracking().FirstOrDefaultAsync(s => s.RegisterId == registerId && s.State == PosSessionState.Open);
        var tenders = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == companyId).OrderBy(m => m.Kind).ThenBy(m => m.Name)
            .Select(m => new PosTenderResponse(m.Id, m.Name, m.Kind)).ToListAsync();
        return Ok(new PosBootstrapResponse(await RegisterResponseAsync(register), ToResponse(store),
            session is null ? null : await SessionSummaryAsync(session, register.Code), tenders, PosService.CashLimitB2C,
            company.Name, company.FiscalNumber, company.VatNumber));
    }

    // The sellable catalogue for the till's store: price from the store's price list (then the
    // company list, then the item), barcodes, VAT letter (D11 caches this offline).
    [HttpGet("registers/{registerId:guid}/catalog", Name = "GetPosCatalog")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<PosCatalogItemResponse>>> Catalog(Guid companyId, Guid registerId)
    {
        var register = await _db.PosRegisters.AsNoTracking().FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == register.StoreId);
        return Ok(await CatalogAsync(companyId, store, null));
    }

    // The catalogue entries for a store (all sellable items, or just these).
    private async Task<List<PosCatalogItemResponse>> CatalogAsync(Guid companyId, Store store, IReadOnlyCollection<Guid>? itemIds)
    {
        // A variant template isn't sold itself; its variants are.
        var query = _db.Items.AsNoTracking().Include(i => i.Barcodes).Where(i => i.CompanyId == companyId && !i.IsVariantTemplate);
        if (itemIds is not null) query = query.Where(i => itemIds.Contains(i.Id));
        var items = await query.OrderBy(i => i.Code).ToListAsync();
        var labels = await ItemVariantsController.VariantLabelsAsync(_db, items.Where(i => i.VariantOfItemId != null).Select(i => i.Id).ToList());
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)),
                items.Select(i => i.Id).ToList(), store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        var taxes = await _db.TaxDefinitions.AsNoTracking().Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);
        var result = new List<PosCatalogItemResponse>();
        foreach (var i in items)
        {
            var tax = i.DefaultTaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null;
            // The same letter the order will record; a VAT code the coupon can't carry (a purchase-only
            // or inactive code, or a rate with no letter) leaves the item off the till.
            if (tax is not null && !PosService.IsSalesVat(tax)) continue;
            if (PosService.LetterFor(tax) is not { } letter) continue;
            result.Add(new PosCatalogItemResponse(i.Id, i.Code, i.Name, i.Unit, i.SalesUnit, i.SalesUnitFactor,
                i.Barcodes.Select(b => b.Barcode).ToList(), prices.TryGetValue(i.Id, out var p) ? p : null, tax?.Id, letter, tax?.Rate ?? 0m,
                i.TrackInventory, i.TrackLots, i.CategoryId, i.Plu, i.SellByWeight, i.OpenPrice, i.MinimumAge, i.DepositItemId,
                i.TrackSerials, i.VariantOfItemId, labels.GetValueOrDefault(i.Id), i.IsBookable, i.DurationMinutes, i.PackageServiceItemId,
                i.PackageSessions, i.MembershipDays, i.ActiveIngredient, i.IsPrescriptionOnly, i.IsControlled, i.MaxRetailPrice));
        }
        return result;
    }

    // P2: what a scanned or typed code is — an item barcode, an item code, a PLU, or an in-store 2x
    // label carrying a weight, a price or a quantity (EAN-13 check digit verified).
    [HttpGet("registers/{registerId:guid}/scan", Name = "ScanPosCode")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosScanResponse>> Scan(Guid companyId, Guid registerId, [FromQuery] string code)
    {
        var register = await _db.PosRegisters.AsNoTracking().FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == register.StoreId);
        code = (code ?? "").Trim();
        if (code.Length == 0) return NotFound();

        async Task<ActionResult<PosScanResponse>> Found(Guid itemId, string match, decimal? quantity = null, decimal? unitPrice = null)
        {
            var entry = (await CatalogAsync(companyId, store, new[] { itemId })).FirstOrDefault();
            return entry is null ? NotFound() : Ok(new PosScanResponse(entry, match, quantity, unitPrice));
        }

        var byBarcode = await _db.ItemBarcodes.AsNoTracking().Where(b => b.Barcode == code && _db.Items.Any(i => i.Id == b.ItemId && i.CompanyId == companyId))
            .Select(b => (Guid?)b.ItemId).FirstOrDefaultAsync();
        if (byBarcode is { } barcodeItem) return await Found(barcodeItem, "barcode");

        // P7: a GS1 DataMatrix (medicine packs): the GTIN finds the item; lot, expiry and serial come along.
        if (Gs1.Parse(code) is { } gs1)
        {
            var candidates = Gs1.Candidates(gs1.Gtin);
            var gtinItem = await _db.ItemBarcodes.AsNoTracking()
                .Where(b => candidates.Contains(b.Barcode) && _db.Items.Any(i => i.Id == b.ItemId && i.CompanyId == companyId))
                .Select(b => (Guid?)b.ItemId).FirstOrDefaultAsync();
            if (gtinItem is null) return NotFound();
            var entry = (await CatalogAsync(companyId, store, new[] { gtinItem.Value })).FirstOrDefault();
            return entry is null ? NotFound() : Ok(new PosScanResponse(entry, "gs1", null, null, gs1.Lot, gs1.Expiry, gs1.Serial));
        }

        // The company's active rules; with none active, the defaults.
        var rules = await _db.PosBarcodeRules.AsNoTracking().Where(r => r.CompanyId == companyId && r.IsActive).ToListAsync();
        if (BarcodeScanner.Decode(code, rules.Count > 0 ? rules : BarcodeScanner.Defaults) is { } decoded)
        {
            var labelled = await ItemByPluAsync(companyId, decoded.Plu);
            if (labelled is null) return NotFound();
            return decoded.Rule.Kind switch
            {
                BarcodeRuleKind.Weight => await Found(labelled.Value, "weight", quantity: decoded.Value),
                BarcodeRuleKind.Price => await Found(labelled.Value, "price", quantity: 1m, unitPrice: decoded.Value),
                _ => await Found(labelled.Value, "quantity", quantity: decoded.Value),
            };
        }

        if (code.All(char.IsAsciiDigit))
        {
            if (await ItemByPluAsync(companyId, code.TrimStart('0')) is { } pluItem) return await Found(pluItem, "plu");
            if (int.TryParse(code, out var number)
                && await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.Code == number).Select(i => (Guid?)i.Id).FirstOrDefaultAsync() is { } coded)
            {
                return await Found(coded, "code");
            }
        }
        return NotFound();
    }

    // PLUs are compared without leading zeros (scales pad them).
    private async Task<Guid?> ItemByPluAsync(Guid companyId, string plu)
    {
        var key = plu.TrimStart('0');
        if (key.Length == 0) key = "0";
        var candidates = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.Plu != null)
            .Select(i => new { i.Id, i.Plu }).ToListAsync();
        return candidates.FirstOrDefault(i => (i.Plu!.TrimStart('0') is { Length: > 0 } t ? t : "0") == key)?.Id;
    }

    // P2: the warranty desk — what a serial number (IMEI) is and whether it is still under warranty.
    [HttpGet("serials/{serial}", Name = "LookupPosSerial")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<SerialLookupResponse>>> Serial(Guid companyId, string serial)
    {
        var key = serial.Trim();
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var rows = await (from s in _db.ItemSerials.AsNoTracking()
                          join i in _db.Items.AsNoTracking() on s.ItemId equals i.Id
                          join o in _db.PosOrders.AsNoTracking() on s.SoldOrderId equals o.Id into orders
                          from o in orders.DefaultIfEmpty()
                          where s.CompanyId == companyId && s.Serial == key
                          select new { s, i.Name, OrderNumber = o != null ? o.Number : null }).ToListAsync();
        if (rows.Count == 0) return NotFound();
        return Ok(rows.Select(r => new SerialLookupResponse(r.s.ItemId, r.Name, r.s.Serial, r.s.Status, r.s.SoldAt, r.s.SoldOrderId, r.OrderNumber,
            r.s.WarrantyUntil, r.s.Status == Pako.Domain.Inventory.ItemSerialStatus.Sold && r.s.WarrantyUntil is { } until && until >= today)).ToList());
    }

    // ---- P2: in-store barcode rules ----

    [HttpGet("barcode-rules", Name = "ListPosBarcodeRules")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<BarcodeRuleResponse>>> BarcodeRules(Guid companyId) =>
        Ok(await _db.PosBarcodeRules.AsNoTracking().Where(r => r.CompanyId == companyId).OrderBy(r => r.Prefix)
            .Select(r => new BarcodeRuleResponse(r.Id, r.Prefix, r.Kind, r.ItemDigits, r.ValueDigits, r.ValueDecimals, r.IsActive)).ToListAsync());

    [HttpPost("barcode-rules", Name = "CreatePosBarcodeRule")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(BarcodeRuleResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BarcodeRuleResponse>> CreateBarcodeRule(Guid companyId, SaveBarcodeRuleRequest request)
    {
        var rule = new BarcodeRule { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyBarcodeRuleAsync(companyId, rule, request) is { } error) return BadRequest(error);
        _db.PosBarcodeRules.Add(rule);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new BarcodeRuleResponse(rule.Id, rule.Prefix, rule.Kind, rule.ItemDigits, rule.ValueDigits, rule.ValueDecimals, rule.IsActive));
    }

    [HttpPut("barcode-rules/{ruleId:guid}", Name = "UpdatePosBarcodeRule")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<BarcodeRuleResponse>> UpdateBarcodeRule(Guid companyId, Guid ruleId, SaveBarcodeRuleRequest request)
    {
        var rule = await _db.PosBarcodeRules.FirstOrDefaultAsync(r => r.Id == ruleId && r.CompanyId == companyId);
        if (rule is null) return NotFound();
        if (await ApplyBarcodeRuleAsync(companyId, rule, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(new BarcodeRuleResponse(rule.Id, rule.Prefix, rule.Kind, rule.ItemDigits, rule.ValueDigits, rule.ValueDecimals, rule.IsActive));
    }

    private async Task<string?> ApplyBarcodeRuleAsync(Guid companyId, BarcodeRule rule, SaveBarcodeRuleRequest r)
    {
        var candidate = new BarcodeRule { Prefix = (r.Prefix ?? "").Trim(), Kind = r.Kind, ItemDigits = r.ItemDigits, ValueDigits = r.ValueDigits,
            ValueDecimals = r.ValueDecimals, IsActive = r.IsActive };
        if (!BarcodeScanner.ValidLayout(candidate)) return _localizer["PosBarcodeRuleInvalid"].Value;
        if (await _db.PosBarcodeRules.AnyAsync(x => x.CompanyId == companyId && x.Prefix == candidate.Prefix && x.Id != rule.Id))
        {
            return _localizer["PosBarcodeRuleTaken"].Value;
        }
        (rule.Prefix, rule.Kind, rule.ItemDigits, rule.ValueDigits, rule.ValueDecimals, rule.IsActive) =
            (candidate.Prefix, candidate.Kind, candidate.ItemDigits, candidate.ValueDigits, candidate.ValueDecimals, candidate.IsActive);
        return null;
    }

    [HttpPost("registers/{registerId:guid}/quote", Name = "QuotePosBasket")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosQuoteResponse>> Quote(Guid companyId, Guid registerId, PosQuoteRequest request)
    {
        var register = await _db.PosRegisters.AsNoTracking().FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == register.StoreId);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        try
        {
            return Ok(await _pos.QuoteAsync(company, store, request));
        }
        catch (Exception ex) when (ex is PosException or ArgumentException)
        {
            return BadRequest(ex.Message);
        }
    }

    // ---- Sessions ----

    [HttpPost("registers/{registerId:guid}/sessions", Name = "OpenPosSession")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(SessionSummaryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SessionSummaryResponse>> OpenSession(Guid companyId, Guid registerId, OpenSessionRequest request)
    {
        var register = await _db.PosRegisters.FirstOrDefaultAsync(r => r.Id == registerId && r.CompanyId == companyId);
        if (register is null) return NotFound();
        try
        {
            var session = await _pos.OpenSessionAsync(companyId, register, request.OpeningFloat, CurrentUserId);
            await _db.SaveChangesAsync();
            return StatusCode(StatusCodes.Status201Created, await SessionSummaryAsync(session, register.Code));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (DbUpdateException)
        {
            // Two tills raced to open the same register: the unique "one open session" index won.
            return BadRequest(_localizer["PosSessionAlreadyOpen"].Value);
        }
    }

    [HttpGet("sessions", Name = "ListPosSessions")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<SessionSummaryResponse>>> Sessions(Guid companyId, [FromQuery] Guid? registerId = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosSessions.AsNoTracking().Where(s => s.CompanyId == companyId);
        if (registerId is { } r) query = query.Where(s => s.RegisterId == r);
        var total = await query.CountAsync();
        var sessions = await query.OrderByDescending(s => s.OpenedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var codes = await _db.PosRegisters.AsNoTracking().Where(x => x.CompanyId == companyId).ToDictionaryAsync(x => x.Id, x => x.Code);
        var rows = new List<SessionSummaryResponse>();
        foreach (var s in sessions) rows.Add(await SessionSummaryAsync(s, codes.GetValueOrDefault(s.RegisterId) ?? "?"));
        return Ok(new PaginatedResponse<SessionSummaryResponse>(rows, total, page, pageSize));
    }

    // X report while open, Z report once closed.
    [HttpGet("sessions/{sessionId:guid}/report", Name = "GetPosSessionReport")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<SessionReportResponse>> SessionReport(Guid companyId, Guid sessionId)
    {
        var session = await _db.PosSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId && s.CompanyId == companyId);
        if (session is null) return NotFound();
        var register = await _db.PosRegisters.AsNoTracking().FirstAsync(r => r.Id == session.RegisterId);
        return Ok(await _pos.ReportAsync(session, register));
    }

    [HttpPost("sessions/{sessionId:guid}/cash-movements", Name = "AddPosCashMovement")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(CashMovementResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CashMovementResponse>> AddCashMovement(Guid companyId, Guid sessionId, CashMovementRequest request)
    {
        // Serialized with closing (same lock), so a movement can't land on a session being posted.
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var session = await _db.PosSessions.FirstOrDefaultAsync(s => s.Id == sessionId && s.CompanyId == companyId);
        if (session is null) return NotFound();
        try
        {
            var m = await _pos.AddCashMovementAsync(companyId, session, request, CurrentUserId);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return StatusCode(StatusCodes.Status201Created, new CashMovementResponse(m.Id, m.Kind, m.Amount, m.Reason, m.CounterpartAccountId, m.CreatedAt));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    // Counts the drawer, records the differences, prints the Z report and posts the session's entry.
    [HttpPost("sessions/{sessionId:guid}/close", Name = "ClosePosSession")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<SessionReportResponse>> CloseSession(Guid companyId, Guid sessionId, CloseSessionRequest request)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var session = await _db.PosSessions.FirstOrDefaultAsync(s => s.Id == sessionId && s.CompanyId == companyId);
        if (session is null) return NotFound();
        var register = await _db.PosRegisters.AsNoTracking().FirstAsync(r => r.Id == session.RegisterId);
        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        try
        {
            await _pos.CloseSessionAsync(company, session, register, request, CurrentUserId);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok(await _pos.ReportAsync(session, register));
        }
        catch (Exception ex) when (ex is PosException or Domain.Ledger.AccountingLockDateViolationException or Domain.Ledger.HardLockDateViolationException
            or Domain.Ledger.TaxLockDateViolationException or Domain.Ledger.UnbalancedJournalEntryException or StockException)
        {
            return BadRequest(ex.Message);
        }
    }

    private async Task<SessionSummaryResponse> SessionSummaryAsync(PosSession s, string registerCode)
    {
        var sales = await _db.PosOrders.AsNoTracking().Where(o => o.SessionId == s.Id)
            .SumAsync(o => o.Kind == PosOrderKind.Sale ? o.Total : -o.Total);
        return new SessionSummaryResponse(s.Id, s.RegisterId, registerCode, s.Number, s.State, s.BusinessDate, s.OpenedAt, s.ClosedAt, sales, s.JournalEntryId);
    }

    // ---- Orders ----

    // Records a till order with its coupon. Sales need Pos: Write; returns and cancellations Approve.
    [HttpPost("orders", Name = "SubmitPosOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(PosOrderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(PosOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PosOrderResponse>> SubmitOrder(Guid companyId, PosOrderRequest request)
    {
        if (request.Kind != PosOrderKind.Sale && _access.LevelFor(AccessModule.Pos) < AccessLevel.Approve) return Forbid();
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var session = await _db.PosSessions.FirstOrDefaultAsync(s => s.Id == request.SessionId && s.CompanyId == companyId);
        if (session is null) return BadRequest(_localizer["PosSessionNotOpen"].Value);
        var register = await _db.PosRegisters.AsNoTracking().FirstAsync(r => r.Id == session.RegisterId);
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == register.StoreId);
        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        try
        {
            // P3: on a shared till the order is the signed-in waiter's (PIN), not the terminal's.
            var operatorId = await _operators.OperatorAsync(Request, companyId) ?? CurrentUserId;
            var operatorName = operatorId == CurrentUserId ? await OperatorNameAsync(companyId) : await _operators.NameAsync(companyId, operatorId);
            var result = await _pos.SubmitOrderAsync(company, register, store, session, request, operatorId, operatorName);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            var response = await _pos.ToResponseAsync(result.Order, result.Fiscal);
            return result.Duplicate ? Ok(response) : StatusCode(StatusCodes.Status201Created, response);
        }
        catch (Exception ex) when (ex is PosException or StockException or FiscalCouponException or Domain.Ledger.AccountingLockDateViolationException
            or Domain.Ledger.TaxLockDateViolationException or Domain.Ledger.HardLockDateViolationException or Domain.Ledger.UnbalancedJournalEntryException)
        {
            // Nothing of a refused order may linger in the context.
            _db.ChangeTracker.Clear();
            return BadRequest(ex.Message);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "IX_fiscal_documents_CompanyId_CouponId" })
        {
            _db.ChangeTracker.Clear();
            // A coupon id the till reused: a clear refusal, not a 500 its queue would retry forever.
            return BadRequest(_localizer["PosCouponIdTaken"].Value);
        }
    }

    // ---- P3: staff ----

    // Sets the signed-in member's own till PIN.
    [HttpPut("pins/me", Name = "SetMyPosPin")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<IActionResult> SetPin(Guid companyId, SetPosPinRequest request)
    {
        try
        {
            await _operators.SetPinAsync(companyId, CurrentUserId, request.Pin);
            await _db.SaveChangesAsync();
            return NoContent();
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    // A waiter signs in on a shared till with their PIN.
    [HttpPost("pins/sign-in", Name = "PosPinSignIn")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<PosOperatorResponse>> PinSignIn(Guid companyId, PosPinSignInRequest request)
    {
        if (await _operators.SignInAsync(companyId, request.Pin) is not { } found) return BadRequest(_localizer["PosPinWrong"].Value);
        return Ok(new PosOperatorResponse(found.UserId, await _operators.NameAsync(companyId, found.UserId), found.Token, found.ExpiresAt));
    }

    [HttpGet("sessions/{sessionId:guid}/waiters", Name = "ListPosSessionWaiters")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<WaiterSummaryResponse>>> Waiters(Guid companyId, Guid sessionId)
    {
        var session = await _db.PosSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId && s.CompanyId == companyId);
        return session is null ? NotFound() : Ok(await _pos.WaitersAsync(session));
    }

    [HttpPost("sessions/{sessionId:guid}/waiter-settlements", Name = "SettlePosWaiter")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<List<WaiterSummaryResponse>>> SettleWaiter(Guid companyId, Guid sessionId, SettleWaiterRequest request)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var session = await _db.PosSessions.FirstOrDefaultAsync(s => s.Id == sessionId && s.CompanyId == companyId);
        if (session is null) return NotFound();
        try
        {
            await _pos.SettleWaiterAsync(session, request, CurrentUserId);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok(await _pos.WaitersAsync(session));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("orders", Name = "ListPosOrders")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<PosOrderSummaryResponse>>> Orders(Guid companyId, [FromQuery] Guid? sessionId = null,
        [FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosOrders.AsNoTracking().Where(o => o.CompanyId == companyId);
        if (sessionId is { } s) query = query.Where(o => o.SessionId == s);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = long.TryParse(term, out var coupon)
                ? query.Where(o => _db.FiscalDocuments.Any(d => d.OrderId == o.Id && d.CouponId == coupon) || EF.Functions.ILike(o.Number, $"%{term}%"))
                : query.Where(o => EF.Functions.ILike(o.Number, $"%{term}%"));
        }
        var total = await query.CountAsync();
        var orders = await query.OrderByDescending(o => o.OrderedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var ids = orders.Select(o => o.Id).ToList();
        var docs = await _db.FiscalDocuments.AsNoTracking().Where(d => ids.Contains(d.OrderId)).ToDictionaryAsync(d => d.OrderId);
        var codes = await _db.PosRegisters.AsNoTracking().Where(x => x.CompanyId == companyId).ToDictionaryAsync(x => x.Id, x => x.Code);
        return Ok(new PaginatedResponse<PosOrderSummaryResponse>(orders.Select(o => new PosOrderSummaryResponse(o.Id, o.Number, o.Kind, o.State, o.OrderedAt,
            codes.GetValueOrDefault(o.RegisterId) ?? "?", o.OperatorName, o.Total, docs.GetValueOrDefault(o.Id)?.CouponId, docs.GetValueOrDefault(o.Id)?.AtkStatus)).ToList(),
            total, page, pageSize));
    }

    [HttpGet("orders/{orderId:guid}", Name = "GetPosOrder")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosOrderResponse>> Order(Guid companyId, Guid orderId)
    {
        var order = await _db.PosOrders.AsNoTracking().Include(o => o.Lines).Include(o => o.Payments)
            .FirstOrDefaultAsync(o => o.Id == orderId && o.CompanyId == companyId);
        if (order is null) return NotFound();
        var fiscal = await _db.FiscalDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.OrderId == orderId);
        return Ok(await _pos.ToResponseAsync(order, fiscal));
    }

    // The operator on the coupon (AI 01/2026 Art. 7): the linked employee's name, else the login.
    private async Task<string> OperatorNameAsync(Guid companyId)
    {
        var userId = CurrentUserId;
        var name = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId && e.UserId == userId).Select(e => e.Name).FirstOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(name)) return name;
        var email = User.FindFirstValue(JwtRegisteredClaimNames.Email) ?? User.FindFirstValue(ClaimTypes.Email);
        return string.IsNullOrWhiteSpace(email) ? userId.ToString()[..8] : email.Split('@')[0];
    }
}
