using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
using Pako.Domain.Projects;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/ERP_VERTICALS_PLAN.md §1 — construction, phase 1 (Sales: Edit; approving progress bills:
// Approve). A site carries a ledger project: bills and invoices that name it, and materials issued
// to it (site-issue stock documents), tag their ledger lines, so cost and revenue per site are read
// from the ledger. Percentage of completion is cost-to-cost against the cost-code budget.
[ApiController]
[Route("api/companies/{companyId:guid}/construction")]
[Authorize]
public class ConstructionController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ITaxComputationService _tax;

    public ConstructionController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, ITaxComputationService tax)
    {
        _db = db;
        _localizer = localizer;
        _tax = tax;
    }

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    // ---- Sites ----

    [HttpGet("sites", Name = "ListConstructionSites")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<SiteSummaryResponse>>> Sites(Guid companyId, [FromQuery] SiteState? state = null)
    {
        var query = _db.ConstructionSites.AsNoTracking().Include(s => s.CostCodes).Where(s => s.CompanyId == companyId);
        if (state is { } st) query = query.Where(s => s.State == st);
        var sites = await query.OrderBy(s => s.Name).ToListAsync();
        var result = new List<SiteSummaryResponse>();
        foreach (var site in sites)
        {
            var progress = await ProgressAsync(site);
            var project = await _db.Projects.AsNoTracking().Where(p => p.Id == site.ProjectId).Select(p => p.Code).FirstAsync();
            var client = await _db.Partners.AsNoTracking().Where(p => p.Id == site.ClientPartnerId).Select(p => p.Name).FirstAsync();
            result.Add(new SiteSummaryResponse(site.Id, project, site.Name, client, site.ContractValue, site.State, progress.Billed, progress.PercentComplete, site.ProjectId));
        }
        return Ok(result);
    }

    [HttpGet("sites/{siteId:guid}", Name = "GetConstructionSite")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<SiteResponse>> Site(Guid companyId, Guid siteId)
    {
        var site = await LoadAsync(companyId, siteId, tracking: false);
        return site is null ? NotFound() : Ok(await ToResponseAsync(site));
    }

    [HttpPost("sites", Name = "CreateConstructionSite")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(SiteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SiteResponse>> CreateSite(Guid companyId, SaveSiteRequest request)
    {
        if (await ValidateAsync(companyId, request, null) is { } error) return BadRequest(error);
        var project = await ProjectBilling.NewProjectAsync(_db, companyId, request.ProjectCode ?? "", request.Name);
        if (project is null) return BadRequest(_localizer["SiteProjectCodeInvalid"].Value);
        var site = new ConstructionSite { Id = Guid.NewGuid(), CompanyId = companyId, ProjectId = project.Id };
        Apply(site, request);
        _db.ConstructionSites.Add(site);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await ToResponseAsync(site));
    }

    // BoQ lines already certified on a progress bill stay (their code can't go).
    [HttpPut("sites/{siteId:guid}", Name = "UpdateConstructionSite")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SiteResponse>> UpdateSite(Guid companyId, Guid siteId, SaveSiteRequest request)
    {
        var site = await LoadAsync(companyId, siteId, tracking: true);
        if (site is null) return NotFound();
        if (await ValidateAsync(companyId, request, site) is { } error) return BadRequest(error);
        var used = await _db.ProgressBillLines.AsNoTracking().Where(l => site.Boq.Select(b => b.Id).Contains(l.BoqLineId)).Select(l => l.BoqLineId).Distinct().ToListAsync();
        var codes = request.Boq.Select(b => b.Code.Trim()).ToHashSet();
        if (site.Boq.Any(b => used.Contains(b.Id) && !codes.Contains(b.Code))) return BadRequest(_localizer["SiteBoqLineCertified"].Value);
        var usedCodes = await _db.BillLines.AsNoTracking().Where(l => l.CostCodeId != null && site.CostCodes.Select(c => c.Id).Contains(l.CostCodeId.Value))
            .Select(l => l.CostCodeId!.Value)
            .Union(_db.StockDocumentLines.AsNoTracking().Where(l => l.CostCodeId != null && site.CostCodes.Select(c => c.Id).Contains(l.CostCodeId.Value))
                .Select(l => l.CostCodeId!.Value))
            .ToListAsync();
        var costCodes = request.CostCodes.Select(c => c.Code.Trim()).ToHashSet();
        if (site.CostCodes.Any(c => usedCodes.Contains(c.Id) && !costCodes.Contains(c.Code))) return BadRequest(_localizer["SiteCostCodeUsed"].Value);
        Apply(site, request);
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync((await LoadAsync(companyId, siteId, tracking: false))!));
    }

    private async Task<string?> ValidateAsync(Guid companyId, SaveSiteRequest r, ConstructionSite? site)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 160 || r.ContractValue < 0 || r.RetentionPercent is < 0 or > 100
            || (r.StartDate is { } s && r.EndDate is { } e && e < s))
        {
            return _localizer["SiteInvalid"].Value;
        }
        if (!await _db.Partners.AnyAsync(p => p.Id == r.ClientPartnerId && p.CompanyId == companyId && p.IsCustomer)) return _localizer["InvalidCustomerPartner"].Value;
        if (!await _db.Items.AnyAsync(i => i.Id == r.BillingItemId && i.CompanyId == companyId)) return _localizer["SiteBillingItemInvalid"].Value;
        var costCodes = r.CostCodes ?? new();
        var boq = r.Boq ?? new();
        if (costCodes.Count > 500 || boq.Count > 2000) return _localizer["StockDocumentTooManyLines"].Value;
        if (costCodes.Any(c => string.IsNullOrWhiteSpace(c.Code) || c.Code.Trim().Length > 20 || string.IsNullOrWhiteSpace(c.Name) || c.Budget < 0)
            || costCodes.Select(c => c.Code.Trim()).Distinct().Count() != costCodes.Count)
        {
            return _localizer["SiteCostCodesInvalid"].Value;
        }
        if (boq.Any(b => string.IsNullOrWhiteSpace(b.Code) || b.Code.Trim().Length > 20 || string.IsNullOrWhiteSpace(b.Description) || string.IsNullOrWhiteSpace(b.Unit)
                || b.Quantity <= 0 || b.UnitPrice < 0)
            || boq.Select(b => b.Code.Trim()).Distinct().Count() != boq.Count)
        {
            return _localizer["SiteBoqInvalid"].Value;
        }
        return null;
    }

    // Cost codes and BoQ lines are matched by code, so ids (and what refers to them) survive edits.
    private void Apply(ConstructionSite site, SaveSiteRequest r)
    {
        site.Name = r.Name.Trim();
        site.ClientPartnerId = r.ClientPartnerId;
        site.Address = string.IsNullOrWhiteSpace(r.Address) ? null : r.Address.Trim();
        site.ContractValue = Money(r.ContractValue);
        site.RetentionPercent = r.RetentionPercent;
        site.StartDate = r.StartDate;
        site.EndDate = r.EndDate;
        site.State = r.State;
        site.BillingItemId = r.BillingItemId;

        var codes = (r.CostCodes ?? new()).ToDictionary(c => c.Code.Trim());
        foreach (var gone in site.CostCodes.Where(c => !codes.ContainsKey(c.Code)).ToList())
        {
            site.CostCodes.Remove(gone);
            _db.CostCodes.Remove(gone);
        }
        foreach (var (code, c) in codes)
        {
            var existing = site.CostCodes.FirstOrDefault(x => x.Code == code);
            if (existing is null)
            {
                var added = new CostCode { Id = Guid.NewGuid(), SiteId = site.Id, Code = code };
                site.CostCodes.Add(added);
                if (_db.Entry(site).State != Microsoft.EntityFrameworkCore.EntityState.Detached) _db.CostCodes.Add(added);
                existing = added;
            }
            (existing.Name, existing.Budget) = (c.Name.Trim(), Money(c.Budget));
        }

        var lines = (r.Boq ?? new()).Select((b, i) => (b, i)).ToDictionary(x => x.b.Code.Trim());
        foreach (var gone in site.Boq.Where(b => !lines.ContainsKey(b.Code)).ToList())
        {
            site.Boq.Remove(gone);
            _db.BoqLines.Remove(gone);
        }
        foreach (var (code, (b, i)) in lines)
        {
            var existing = site.Boq.FirstOrDefault(x => x.Code == code);
            if (existing is null)
            {
                var added = new BoqLine { Id = Guid.NewGuid(), SiteId = site.Id, Code = code };
                site.Boq.Add(added);
                if (_db.Entry(site).State != Microsoft.EntityFrameworkCore.EntityState.Detached) _db.BoqLines.Add(added);
                existing = added;
            }
            (existing.Description, existing.Unit, existing.Quantity, existing.UnitPrice, existing.SortOrder) =
                (b.Description.Trim(), b.Unit.Trim(), b.Quantity, b.UnitPrice, i);
        }
    }

    private async Task<ConstructionSite?> LoadAsync(Guid companyId, Guid siteId, bool tracking)
    {
        var query = _db.ConstructionSites.Include(s => s.CostCodes).Include(s => s.Boq).Where(s => s.Id == siteId && s.CompanyId == companyId);
        return await (tracking ? query : query.AsNoTracking()).FirstOrDefaultAsync();
    }

    private async Task<SiteResponse> ToResponseAsync(ConstructionSite site)
    {
        var project = await _db.Projects.AsNoTracking().Where(p => p.Id == site.ProjectId).Select(p => p.Code).FirstAsync();
        var client = await _db.Partners.AsNoTracking().Where(p => p.Id == site.ClientPartnerId).Select(p => p.Name).FirstAsync();
        var certified = await CertifiedAsync(site.Id);
        var boq = site.Boq.OrderBy(b => b.SortOrder).Select(b => new BoqLineResponse(b.Id, b.Code, b.Description, b.Unit, b.Quantity, b.UnitPrice,
            Money(b.Quantity * b.UnitPrice), certified.GetValueOrDefault(b.Id))).ToList();
        return new SiteResponse(site.Id, site.ProjectId, project, site.Name, site.ClientPartnerId, client, site.Address, site.ContractValue, site.RetentionPercent,
            site.RetentionReleased, site.StartDate, site.EndDate, site.State, site.BillingItemId, boq.Sum(b => b.Amount),
            site.CostCodes.OrderBy(c => c.Code).Select(c => new CostCodeResponse(c.Id, c.Code, c.Name, c.Budget)).ToList(), boq);
    }

    // Cumulative quantity per BoQ line on the latest approved (or invoiced) progress bill.
    private async Task<Dictionary<Guid, decimal>> CertifiedAsync(Guid siteId, Guid? exceptBillId = null)
    {
        var last = await _db.ProgressBills.AsNoTracking().Include(b => b.Lines)
            .Where(b => b.SiteId == siteId && b.State != ProgressBillState.Draft && b.Id != exceptBillId)
            .OrderByDescending(b => b.Number).FirstOrDefaultAsync();
        return last?.Lines.ToDictionary(l => l.BoqLineId, l => l.CumulativeQuantity) ?? new();
    }

    // ---- Progress bills ----

    [HttpGet("sites/{siteId:guid}/progress-bills", Name = "ListProgressBills")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<ProgressBillResponse>>> ProgressBills(Guid companyId, Guid siteId)
    {
        var site = await LoadAsync(companyId, siteId, tracking: false);
        if (site is null) return NotFound();
        var bills = await _db.ProgressBills.AsNoTracking().Include(b => b.Lines).Where(b => b.SiteId == siteId).OrderBy(b => b.Number).ToListAsync();
        var result = new List<ProgressBillResponse>();
        foreach (var bill in bills) result.Add(await BillResponseAsync(site, bill));
        return Ok(result);
    }

    // A draft with the cumulative quantities to date; lines left out stay where the last bill had them.
    [HttpPost("sites/{siteId:guid}/progress-bills", Name = "CreateProgressBill")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(ProgressBillResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ProgressBillResponse>> CreateProgressBill(Guid companyId, Guid siteId, SaveProgressBillRequest request)
    {
        var site = await LoadAsync(companyId, siteId, tracking: false);
        if (site is null) return NotFound();
        if (site.State != SiteState.Active) return BadRequest(_localizer["SiteNotActive"].Value);
        if (await _db.ProgressBills.AnyAsync(b => b.SiteId == siteId && b.State == ProgressBillState.Draft)) return BadRequest(_localizer["ProgressBillDraftExists"].Value);
        var number = (await _db.ProgressBills.Where(b => b.SiteId == siteId).MaxAsync(b => (int?)b.Number) ?? 0) + 1;
        var bill = new ProgressBill { Id = Guid.NewGuid(), SiteId = siteId, Number = number, State = ProgressBillState.Draft };
        if (await ApplyBillAsync(site, bill, request) is { } error) return BadRequest(error);
        _db.ProgressBills.Add(bill);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await BillResponseAsync(site, bill));
    }

    [HttpPut("progress-bills/{billId:guid}", Name = "UpdateProgressBill")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<ProgressBillResponse>> UpdateProgressBill(Guid companyId, Guid billId, SaveProgressBillRequest request)
    {
        var bill = await _db.ProgressBills.Include(b => b.Lines).FirstOrDefaultAsync(b => b.Id == billId);
        var site = bill is null ? null : await LoadAsync(companyId, bill.SiteId, tracking: false);
        if (bill is null || site is null) return NotFound();
        if (bill.State != ProgressBillState.Draft) return BadRequest(_localizer["ProgressBillNotDraft"].Value);
        _db.ProgressBillLines.RemoveRange(bill.Lines);
        if (await ApplyBillAsync(site, bill, request) is { } error) return BadRequest(error);
        _db.ProgressBillLines.AddRange(bill.Lines);
        await _db.SaveChangesAsync();
        return Ok(await BillResponseAsync(site, bill));
    }

    private async Task<string?> ApplyBillAsync(ConstructionSite site, ProgressBill bill, SaveProgressBillRequest r)
    {
        var lines = r.Lines ?? new();
        if (lines.Select(l => l.BoqLineId).Distinct().Count() != lines.Count || lines.Any(l => l.CumulativeQuantity < 0 || site.Boq.All(b => b.Id != l.BoqLineId)))
        {
            return _localizer["ProgressBillInvalid"].Value;
        }
        var certified = await CertifiedAsync(site.Id);
        // Quantities done can't go back below what an earlier bill certified.
        if (lines.Any(l => l.CumulativeQuantity < certified.GetValueOrDefault(l.BoqLineId))) return _localizer["ProgressBillBelowCertified"].Value;
        bill.PeriodTo = r.PeriodTo;
        bill.Lines = site.Boq.Select(b => new ProgressBillLine
        {
            Id = Guid.NewGuid(), ProgressBillId = bill.Id, BoqLineId = b.Id,
            CumulativeQuantity = lines.FirstOrDefault(l => l.BoqLineId == b.Id)?.CumulativeQuantity ?? certified.GetValueOrDefault(b.Id),
        }).ToList();
        return null;
    }

    // Signed off: this period's quantities and amount are fixed, and the retention held from it.
    [HttpPost("progress-bills/{billId:guid}/approve", Name = "ApproveProgressBill")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    public async Task<ActionResult<ProgressBillResponse>> Approve(Guid companyId, Guid billId)
    {
        var bill = await _db.ProgressBills.Include(b => b.Lines).FirstOrDefaultAsync(b => b.Id == billId);
        var site = bill is null ? null : await LoadAsync(companyId, bill.SiteId, tracking: false);
        if (bill is null || site is null) return NotFound();
        if (bill.State != ProgressBillState.Draft) return BadRequest(_localizer["ProgressBillNotDraft"].Value);
        var certified = await CertifiedAsync(site.Id, bill.Id);
        foreach (var line in bill.Lines)
        {
            var boq = site.Boq.First(b => b.Id == line.BoqLineId);
            line.PreviousQuantity = certified.GetValueOrDefault(line.BoqLineId);
            line.Amount = Money((line.CumulativeQuantity - line.PreviousQuantity) * boq.UnitPrice);
        }
        bill.Amount = bill.Lines.Sum(l => l.Amount);
        if (bill.Amount <= 0) return BadRequest(_localizer["ProgressBillNothingDone"].Value);
        bill.Retention = Money(bill.Amount * site.RetentionPercent / 100m);
        bill.State = ProgressBillState.Approved;
        await _db.SaveChangesAsync();
        return Ok(await BillResponseAsync(site, bill));
    }

    // A draft invoice to the client for the period: one line per BoQ line worked on, VAT-inclusive on
    // the billing item's VAT code, tagged with the site's project. The retention is held on the
    // client's side and released at handover; the invoice is for the full amount.
    [HttpPost("progress-bills/{billId:guid}/invoice", Name = "InvoiceProgressBill")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<Guid>> Invoice(Guid companyId, Guid billId)
    {
        var bill = await _db.ProgressBills.Include(b => b.Lines).FirstOrDefaultAsync(b => b.Id == billId);
        var site = bill is null ? null : await LoadAsync(companyId, bill.SiteId, tracking: false);
        if (bill is null || site is null) return NotFound();
        if (bill.State != ProgressBillState.Approved) return BadRequest(_localizer["ProgressBillNotApproved"].Value);
        var item = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == site.BillingItemId);
        var charges = new List<ProjectBilling.Charge>();
        foreach (var line in bill.Lines.Where(l => l.Amount > 0))
        {
            var boq = site.Boq.First(b => b.Id == line.BoqLineId);
            var period = line.CumulativeQuantity - line.PreviousQuantity;
            charges.Add(new(item, $"{boq.Code} {boq.Description} — {period:0.####} {boq.Unit}", 1m, await ProjectBilling.GrossAsync(_db, _tax, item, line.Amount)));
        }
        var partner = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == site.ClientPartnerId);
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var invoice = await ProjectBilling.DraftAsync(_db, companyId, site.ClientPartnerId, today, today.AddDays(partner.PaymentTermDays ?? 30), site.ProjectId, charges,
            string.Format(_localizer["ProgressBillInvoiceNote"].Value, bill.Number, site.Name, bill.Retention));
        bill.InvoiceId = invoice.Id;
        bill.State = ProgressBillState.Invoiced;
        await _db.SaveChangesAsync();
        return Ok(invoice.Id);
    }

    private async Task<ProgressBillResponse> BillResponseAsync(ConstructionSite site, ProgressBill bill)
    {
        var previous = bill.State == ProgressBillState.Draft ? await CertifiedAsync(site.Id) : null;
        var lines = site.Boq.OrderBy(b => b.SortOrder).Select(b =>
        {
            var line = bill.Lines.FirstOrDefault(l => l.BoqLineId == b.Id);
            var cumulative = line?.CumulativeQuantity ?? 0m;
            var before = previous is null ? line?.PreviousQuantity ?? 0m : previous.GetValueOrDefault(b.Id);
            var amount = previous is null ? line?.Amount ?? 0m : Money((cumulative - before) * b.UnitPrice);
            return new ProgressBillLineResponse(line?.Id ?? Guid.Empty, b.Id, b.Code, b.Description, b.Unit, b.Quantity, b.UnitPrice, before, cumulative,
                cumulative - before, amount, cumulative > b.Quantity);
        }).ToList();
        var total = previous is null ? bill.Amount : lines.Sum(l => l.Amount);
        var retention = previous is null ? bill.Retention : Money(total * site.RetentionPercent / 100m);
        return new ProgressBillResponse(bill.Id, bill.SiteId, bill.Number, bill.PeriodTo, bill.State, total, retention, total - retention, bill.InvoiceId, lines);
    }

    // ---- Progress (percentage of completion) ----

    [HttpGet("sites/{siteId:guid}/progress", Name = "GetSiteProgress")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<SiteProgressResponse>> Progress(Guid companyId, Guid siteId)
    {
        var site = await LoadAsync(companyId, siteId, tracking: false);
        return site is null ? NotFound() : Ok(await ProgressAsync(site));
    }

    // Cost from the ledger lines tagged with the site's project (classes 5 and 6), revenue from
    // class 4; cost per code from the bills and site issues that name it.
    private async Task<SiteProgressResponse> ProgressAsync(ConstructionSite site)
    {
        var tagged = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.ProjectId == site.ProjectId && l.JournalEntry!.State == JournalEntryState.Posted)
            .Select(l => new { Code = _db.Accounts.Where(a => a.Id == l.AccountId).Select(a => a.Code).First(), l.Debit, l.Credit })
            .ToListAsync();
        var actual = tagged.Where(t => t.Code.StartsWith('5') || t.Code.StartsWith('6')).Sum(t => t.Debit - t.Credit);
        var revenue = tagged.Where(t => t.Code.StartsWith('4')).Sum(t => t.Credit - t.Debit);
        var budget = site.CostCodes.Sum(c => c.Budget);
        var percent = budget > 0 ? Math.Min(1m, Math.Round(actual / budget, 4)) : 0m;
        var earned = Money(site.ContractValue * percent);
        var bills = await _db.ProgressBills.AsNoTracking().Where(b => b.SiteId == site.Id && b.State != ProgressBillState.Draft).ToListAsync();
        var billed = bills.Sum(b => b.Amount);
        var retention = bills.Sum(b => b.Retention) - site.RetentionReleased;

        var codeIds = site.CostCodes.Select(c => c.Id).ToList();
        var byCode = new Dictionary<Guid, decimal>();
        var billLines = await _db.BillLines.AsNoTracking()
            .Where(l => l.CostCodeId != null && codeIds.Contains(l.CostCodeId.Value) && l.Bill!.State == BillState.Posted)
            .Select(l => new { CostCodeId = l.CostCodeId!.Value, l.Quantity, l.UnitPrice, l.DiscountPercent, l.TaxDefinitionId, l.Bill!.PriceMode, l.Bill.DocumentType })
            .ToListAsync();
        var taxIds = billLines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        foreach (var l in billLines)
        {
            var amount = Money(l.Quantity * l.UnitPrice * (1 - l.DiscountPercent / 100m));
            var net = l.PriceMode == Pako.Domain.Invoicing.PriceMode.GrossInclusive && l.TaxDefinitionId is { } t && taxes.TryGetValue(t, out var tax)
                ? _tax.ComputeFromGross(amount, tax).NetAmount : amount;
            var sign = l.DocumentType == Pako.Domain.Bills.DocumentType.Bill ? 1m : -1m;
            byCode[l.CostCodeId] = byCode.GetValueOrDefault(l.CostCodeId) + sign * net;
        }
        var issueLines = await (from l in _db.StockDocumentLines.AsNoTracking()
                                join m in _db.StockMoves.AsNoTracking() on l.Id equals m.SourceLineId
                                where l.CostCodeId != null && codeIds.Contains(l.CostCodeId.Value) && m.SourceType == StockMoveSource.StockDocument
                                select new { CostCodeId = l.CostCodeId!.Value, m.Value }).ToListAsync();
        foreach (var l in issueLines) byCode[l.CostCodeId] = byCode.GetValueOrDefault(l.CostCodeId) + l.Value;
        var rows = site.CostCodes.OrderBy(c => c.Code)
            .Select(c => new CostCodeProgressRow(c.Id, c.Code, c.Name, c.Budget, byCode.GetValueOrDefault(c.Id), c.Budget - byCode.GetValueOrDefault(c.Id))).ToList();
        var unassigned = actual - rows.Sum(r => r.Actual);
        if (unassigned != 0) rows.Add(new CostCodeProgressRow(null, "—", _localizer["SiteCostUnassigned"].Value, 0m, unassigned, -unassigned));

        return new SiteProgressResponse(site.Id, site.ContractValue, budget, actual, percent, earned, billed, billed - earned, revenue, retention,
            revenue - actual, rows);
    }

    [HttpPost("sites/{siteId:guid}/release-retention", Name = "ReleaseSiteRetention")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    public async Task<ActionResult<SiteProgressResponse>> ReleaseRetention(Guid companyId, Guid siteId, ReleaseRetentionRequest request)
    {
        var site = await LoadAsync(companyId, siteId, tracking: true);
        if (site is null) return NotFound();
        var held = await _db.ProgressBills.Where(b => b.SiteId == siteId && b.State != ProgressBillState.Draft).SumAsync(b => b.Retention) - site.RetentionReleased;
        if (request.Amount <= 0 || request.Amount > held) return BadRequest(_localizer["SiteRetentionInvalid"].Value);
        site.RetentionReleased += Money(request.Amount);
        await _db.SaveChangesAsync();
        return Ok(await ProgressAsync(site));
    }
}
