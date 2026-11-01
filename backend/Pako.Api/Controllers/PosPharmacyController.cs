using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md §6.8 / P7 — pharmacy: third-party payers, prescriptions (dispensed at the till
// against their lines), the controlled-medicines register and substitutes by active ingredient.
[ApiController]
[Route("api/companies/{companyId:guid}/pos/pharmacy")]
[Authorize]
public class PosPharmacyController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosPharmacyController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ---- Payers ----

    [HttpGet("payers", Name = "ListPosPayers")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<PayerResponse>>> Payers(Guid companyId)
    {
        var payers = await _db.PosPayers.AsNoTracking().Where(p => p.CompanyId == companyId).OrderBy(p => p.Name).ToListAsync();
        return Ok(await PayerResponsesAsync(payers));
    }

    [HttpPost("payers", Name = "CreatePosPayer")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(PayerResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PayerResponse>> CreatePayer(Guid companyId, SavePayerRequest request)
    {
        var payer = new ThirdPartyPayer { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyPayerAsync(companyId, payer, request) is { } error) return BadRequest(error);
        _db.PosPayers.Add(payer);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await PayerResponsesAsync(new() { payer }))[0]);
    }

    [HttpPut("payers/{payerId:guid}", Name = "UpdatePosPayer")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<PayerResponse>> UpdatePayer(Guid companyId, Guid payerId, SavePayerRequest request)
    {
        var payer = await _db.PosPayers.FirstOrDefaultAsync(p => p.Id == payerId && p.CompanyId == companyId);
        if (payer is null) return NotFound();
        if (await ApplyPayerAsync(companyId, payer, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await PayerResponsesAsync(new() { payer }))[0]);
    }

    private async Task<string?> ApplyPayerAsync(Guid companyId, ThirdPartyPayer payer, SavePayerRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 120 || r.CoveragePercent is < 0 or > 100) return _localizer["PosPayerInvalid"].Value;
        if (!await _db.Partners.AnyAsync(p => p.Id == r.PartnerId && p.CompanyId == companyId && p.IsCustomer)) return _localizer["InvalidCustomerPartner"].Value;
        if (await _db.PosPayers.AnyAsync(p => p.CompanyId == companyId && p.Id != payer.Id && p.Name == r.Name.Trim())) return _localizer["PosPayerInvalid"].Value;
        (payer.Name, payer.PartnerId, payer.CoveragePercent, payer.IsActive) = (r.Name.Trim(), r.PartnerId, r.CoveragePercent, r.IsActive);
        return null;
    }

    private async Task<List<PayerResponse>> PayerResponsesAsync(List<ThirdPartyPayer> payers)
    {
        var ids = payers.Select(p => p.PartnerId).Distinct().ToList();
        var names = await _db.Partners.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return payers.Select(p => new PayerResponse(p.Id, p.Name, p.PartnerId, names.GetValueOrDefault(p.PartnerId) ?? "?", p.CoveragePercent, p.IsActive)).ToList();
    }

    // ---- Prescriptions ----

    [HttpGet("prescriptions", Name = "ListPosPrescriptions")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<PrescriptionResponse>>> Prescriptions(Guid companyId, [FromQuery] Guid? storeId = null,
        [FromQuery] string? search = null, [FromQuery] PrescriptionState? state = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosPrescriptions.AsNoTracking().Where(p => p.CompanyId == companyId);
        if (storeId is { } s) query = query.Where(p => p.StoreId == s);
        if (state is { } st) query = query.Where(p => p.State == st);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(p => EF.Functions.ILike(p.Number, pattern) || EF.Functions.ILike(p.PatientName, pattern)
                || (p.PatientPersonalNumber != null && EF.Functions.ILike(p.PatientPersonalNumber, pattern)));
        }
        var total = await query.CountAsync();
        var rows = await query.Include(p => p.Lines).OrderByDescending(p => p.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<PrescriptionResponse>(await ResponsesAsync(rows), total, page, pageSize));
    }

    [HttpGet("prescriptions/{prescriptionId:guid}", Name = "GetPosPrescription")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PrescriptionResponse>> Prescription(Guid companyId, Guid prescriptionId)
    {
        var rx = await _db.PosPrescriptions.AsNoTracking().Include(p => p.Lines).FirstOrDefaultAsync(p => p.Id == prescriptionId && p.CompanyId == companyId);
        return rx is null ? NotFound() : Ok((await ResponsesAsync(new() { rx }))[0]);
    }

    // Typed in at the counter when presented; the till then dispenses against its lines.
    [HttpPost("prescriptions", Name = "CreatePosPrescription")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(PrescriptionResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PrescriptionResponse>> CreatePrescription(Guid companyId, SavePrescriptionRequest request)
    {
        var rx = new Prescription { Id = Guid.NewGuid(), CompanyId = companyId, State = PrescriptionState.Open };
        if (await ApplyAsync(companyId, rx, request) is { } error) return BadRequest(error);
        _db.PosPrescriptions.Add(rx);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ResponsesAsync(new() { rx }))[0]);
    }

    // Corrected while nothing has been dispensed on it.
    [HttpPut("prescriptions/{prescriptionId:guid}", Name = "UpdatePosPrescription")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<PrescriptionResponse>> UpdatePrescription(Guid companyId, Guid prescriptionId, SavePrescriptionRequest request)
    {
        var rx = await _db.PosPrescriptions.Include(p => p.Lines).FirstOrDefaultAsync(p => p.Id == prescriptionId && p.CompanyId == companyId);
        if (rx is null) return NotFound();
        if (rx.State != PrescriptionState.Open || rx.Lines.Any(l => l.Dispensed > 0)) return BadRequest(_localizer["PosPrescriptionLocked"].Value);
        _db.PosPrescriptionLines.RemoveRange(rx.Lines);
        if (await ApplyAsync(companyId, rx, request) is { } error) return BadRequest(error);
        _db.PosPrescriptionLines.AddRange(rx.Lines);
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(new() { rx }))[0]);
    }

    [HttpPost("prescriptions/{prescriptionId:guid}/cancel", Name = "CancelPosPrescription")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<PrescriptionResponse>> CancelPrescription(Guid companyId, Guid prescriptionId)
    {
        var rx = await _db.PosPrescriptions.Include(p => p.Lines).FirstOrDefaultAsync(p => p.Id == prescriptionId && p.CompanyId == companyId);
        if (rx is null) return NotFound();
        rx.State = PrescriptionState.Cancelled;
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(new() { rx }))[0]);
    }

    private async Task<string?> ApplyAsync(Guid companyId, Prescription rx, SavePrescriptionRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Number) || r.Number.Trim().Length > 40 || string.IsNullOrWhiteSpace(r.Prescriber)
            || string.IsNullOrWhiteSpace(r.PatientName) || r.Lines is null || r.Lines.Count is 0 or > 50
            || r.Lines.Any(l => l.Quantity <= 0) || (r.ValidUntil is { } until && until < r.IssuedOn) || r.CoveragePercent is < 0 or > 100)
        {
            return _localizer["PosPrescriptionInvalid"].Value;
        }
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        var itemIds = r.Lines.Select(l => l.ItemId).Distinct().ToList();
        if (itemIds.Count != r.Lines.Count || await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count)
        {
            return _localizer["PosPrescriptionInvalid"].Value;
        }
        ThirdPartyPayer? payer = null;
        if (r.PayerId is { } payerId)
        {
            payer = await _db.PosPayers.AsNoTracking().FirstOrDefaultAsync(p => p.Id == payerId && p.CompanyId == companyId && p.IsActive);
            if (payer is null) return _localizer["PosPayerInvalid"].Value;
        }
        rx.StoreId = r.StoreId;
        rx.Number = r.Number.Trim();
        rx.IssuedOn = r.IssuedOn;
        rx.ValidUntil = r.ValidUntil;
        rx.Prescriber = r.Prescriber.Trim();
        rx.PrescriberLicence = Blank(r.PrescriberLicence);
        rx.PatientName = r.PatientName.Trim();
        rx.PatientPersonalNumber = Blank(r.PatientPersonalNumber);
        rx.PayerId = payer?.Id;
        rx.CoveragePercent = payer is null ? 0m : r.CoveragePercent ?? payer.CoveragePercent;
        rx.Notes = Blank(r.Notes);
        rx.Lines = r.Lines.Select(l => new PrescriptionLine
        {
            Id = Guid.NewGuid(), PrescriptionId = rx.Id, ItemId = l.ItemId, Quantity = l.Quantity, Dosage = Blank(l.Dosage),
        }).ToList();
        return null;
    }

    private async Task<List<PrescriptionResponse>> ResponsesAsync(List<Prescription> rows)
    {
        var itemIds = rows.SelectMany(r => r.Lines).Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        var payerIds = rows.Where(r => r.PayerId != null).Select(r => r.PayerId!.Value).Distinct().ToList();
        var payers = await _db.PosPayers.AsNoTracking().Where(p => payerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        return rows.Select(r =>
        {
            var payer = r.PayerId is { } id ? payers.GetValueOrDefault(id) : null;
            return new PrescriptionResponse(r.Id, r.StoreId, r.Number, r.IssuedOn, r.ValidUntil, r.Prescriber, r.PrescriberLicence, r.PatientName,
                r.PatientPersonalNumber, r.PayerId, payer?.Name, payer?.PartnerId, r.CoveragePercent, r.State, r.Notes, r.CreatedAt,
                r.Lines.Select(l => new PrescriptionLineResponse(l.Id, l.ItemId, items.GetValueOrDefault(l.ItemId) ?? "?", l.Quantity, l.Dispensed,
                    Math.Max(0m, l.Quantity - l.Dispensed), l.Dosage)).ToList());
        }).ToList();
    }

    // ---- Controlled register ----

    // Every receipt and issue of a controlled medicine in the period with its running balance, and
    // for sales the prescription, patient and prescriber — the register a pharmacy keeps for the
    // Ministry of Health. Read from the stock ledger, so it always agrees with stock.
    [HttpGet("controlled-register", Name = "GetPosControlledRegister")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<ControlledRegisterResponse>> ControlledRegister(Guid companyId, [FromQuery] Guid itemId, [FromQuery] DateOnly from,
        [FromQuery] DateOnly to)
    {
        var item = await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId && i.IsControlled);
        if (item is null) return NotFound();
        if (to < from) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        var moves = _db.StockMoves.AsNoTracking().Where(m => m.CompanyId == companyId && m.ItemId == itemId
            && (m.Kind == StockMoveKind.Receipt || m.Kind == StockMoveKind.Issue));
        var opening = await moves.Where(m => m.Date < from).SumAsync(m => m.Kind == StockMoveKind.Receipt ? m.Quantity : -m.Quantity);
        var period = await moves.Where(m => m.Date >= from && m.Date <= to).OrderBy(m => m.Date).ThenBy(m => m.Sequence).ToListAsync();

        var posLineIds = period.Where(m => m.SourceType == StockMoveSource.Pos && m.SourceLineId != null).Select(m => m.SourceLineId!.Value).ToList();
        var rx = await (from l in _db.PosOrderLines.AsNoTracking()
                        join o in _db.PosOrders.AsNoTracking() on l.OrderId equals o.Id
                        join p in _db.PosPrescriptions.AsNoTracking() on o.PrescriptionId equals p.Id
                        where posLineIds.Contains(l.Id)
                        select new { l.Id, p.Number, p.PatientName, p.Prescriber }).ToDictionaryAsync(x => x.Id);
        var billIds = period.Where(m => m.SourceType == StockMoveSource.Bill).Select(m => m.SourceId).ToList();
        var invoiceIds = period.Where(m => m.SourceType == StockMoveSource.Invoice).Select(m => m.SourceId).ToList();
        var counterparties = (await _db.Bills.AsNoTracking().Where(b => billIds.Contains(b.Id))
                .Select(b => new { b.Id, Name = _db.Partners.Where(p => p.Id == b.PartnerId).Select(p => p.Name).FirstOrDefault() }).ToListAsync())
            .Concat(await _db.Invoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .Select(i => new { i.Id, Name = _db.Partners.Where(p => p.Id == i.PartnerId).Select(p => p.Name).FirstOrDefault() }).ToListAsync())
            .ToDictionary(x => x.Id, x => x.Name);

        var balance = opening;
        var rows = new List<ControlledRegisterRow>();
        foreach (var m in period)
        {
            var isIn = m.Kind == StockMoveKind.Receipt;
            balance += isIn ? m.Quantity : -m.Quantity;
            var prescription = m.SourceLineId is { } lineId ? rx.GetValueOrDefault(lineId) : null;
            rows.Add(new ControlledRegisterRow(m.Date, m.Reference ?? m.SourceType.ToString(), counterparties.GetValueOrDefault(m.SourceId),
                prescription?.Number, prescription?.PatientName, prescription?.Prescriber, isIn ? m.Quantity : 0m, isIn ? 0m : m.Quantity, balance));
        }
        return Ok(new ControlledRegisterResponse(item.Id, item.Name, from, to, opening, rows, balance));
    }

    // ---- Substitutes ----

    // Medicines with the same active ingredient (or, without one, the same ATC code) — priced for the
    // store and with what is on hand there.
    [HttpGet("substitutes", Name = "GetPosSubstitutes")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<SubstituteResponse>>> Substitutes(Guid companyId, [FromQuery] Guid itemId, [FromQuery] Guid storeId)
    {
        var item = await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == storeId && s.CompanyId == companyId);
        if (item is null || store is null) return NotFound();
        if (item.ActiveIngredient is null && item.AtcCode is null) return Ok(new List<SubstituteResponse>());
        var ingredient = item.ActiveIngredient?.ToLower();
        var others = await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.Id != itemId
                && (ingredient != null ? i.ActiveIngredient != null && i.ActiveIngredient.ToLower() == ingredient : i.AtcCode == item.AtcCode))
            .OrderBy(i => i.Name).Take(50).ToListAsync();
        var ids = others.Select(i => i.Id).ToList();
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), ids, store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        var location = await new StockService(_db, _localizer).StockLocationAsync(companyId, store.WarehouseId);
        var onHand = await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && ids.Contains(b.ItemId))
            .ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        return Ok(others.Select(i => new SubstituteResponse(i.Id, i.Code, i.Name, i.AtcCode, i.ActiveIngredient, prices.TryGetValue(i.Id, out var p) ? p : null,
            onHand.GetValueOrDefault(i.Id), i.IsPrescriptionOnly)).ToList());
    }
}
