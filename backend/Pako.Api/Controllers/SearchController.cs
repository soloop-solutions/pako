using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/search")]
[Authorize]
public class SearchController : ControllerBase
{
    private readonly PakoDbContext _db;

    private readonly CompanyAccessContext _access;

    public SearchController(PakoDbContext db, CompanyAccessContext access)
    {
        _db = db;
        _access = access;
    }

    // Search returns only what the caller could open anyway: areas their role (and the company's
    // modules) allow, and only the partners their partner scope shows.
    private bool CanRead(AccessModule area) => _access.LevelFor(area) >= AccessLevel.Read;

    public record SearchResultItem(string Id, string Label, string Category, string? Url);
    public record SearchResponse(List<SearchResultItem> Results);

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<SearchResponse>> Search(Guid companyId, [FromQuery] string? q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
        {
            return Ok(new SearchResponse(new List<SearchResultItem>()));
        }

        var query = q.Trim();
        var pattern = $"%{query}%";
        const int limit = 5;

        var results = new List<SearchResultItem>();

        // Search invoices by number
        var invoices = !CanRead(AccessModule.Sales) ? [] : await _db.Invoices.AsNoTracking().VisibleTo(_access)
            .Where(i => i.CompanyId == companyId && i.InvoiceNumber != null && EF.Functions.ILike(i.InvoiceNumber, pattern))
            .OrderByDescending(i => i.CreatedAt)
            .Take(limit)
            .Select(i => new { i.Id, i.InvoiceNumber, i.DocumentType })
            .ToListAsync();

        foreach (var inv in invoices)
        {
            var docType = inv.DocumentType;
            var category = docType == Domain.Invoicing.DocumentType.SalesReturn ? "salesReturns" : "invoices";
            var url = docType == Domain.Invoicing.DocumentType.SalesReturn
                ? $"/sales-returns/{inv.Id}"
                : $"/invoicing/{inv.Id}";
            results.Add(new SearchResultItem(inv.Id.ToString(), inv.InvoiceNumber!, category, url));
        }

        // Search bills by vendor reference
        var bills = !CanRead(AccessModule.Purchases) ? [] : await _db.Bills.AsNoTracking().VisibleTo(_access)
            .Where(b => b.CompanyId == companyId && b.VendorReference != null && EF.Functions.ILike(b.VendorReference, pattern))
            .OrderByDescending(b => b.CreatedAt)
            .Take(limit)
            .Select(b => new { b.Id, b.VendorReference, b.DocumentType })
            .ToListAsync();

        foreach (var bill in bills)
        {
            var category = bill.DocumentType == Domain.Bills.DocumentType.PurchaseReturn ? "purchaseReturns" : "bills";
            var url = bill.DocumentType == Domain.Bills.DocumentType.PurchaseReturn
                ? $"/purchase-returns/{bill.Id}"
                : $"/bills/{bill.Id}";
            results.Add(new SearchResultItem(bill.Id.ToString(), bill.VendorReference!, category, url));
        }

        // Search partners by name
        var partners = !CanRead(AccessModule.Partners) ? [] : await _db.Partners.AsNoTracking().VisibleTo(_access)
            .Where(p => p.CompanyId == companyId && EF.Functions.ILike(p.Name, pattern))
            .OrderBy(p => p.Name)
            .Take(limit)
            .Select(p => new { p.Id, p.Name })
            .ToListAsync();

        foreach (var p in partners)
        {
            results.Add(new SearchResultItem(p.Id.ToString(), p.Name, "partners", $"/partners"));
        }

        // Search accounts by code or name
        var accounts = !CanRead(AccessModule.Accounting) ? [] : await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && (EF.Functions.ILike(a.Code, pattern) || EF.Functions.ILike(a.Name, pattern)))
            .OrderBy(a => a.Code)
            .Take(limit)
            .Select(a => new { a.Id, a.Code, a.Name })
            .ToListAsync();

        foreach (var a in accounts)
        {
            results.Add(new SearchResultItem(a.Id.ToString(), $"{a.Code} — {a.Name}", "accounts", $"/chart-of-accounts"));
        }

        // Search items by name (code is numeric, search by name only)
        var items = !CanRead(AccessModule.Items) ? [] : await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && EF.Functions.ILike(i.Name, pattern))
            .OrderBy(i => i.Code)
            .Take(limit)
            .Select(i => new { i.Id, i.Code, i.Name })
            .ToListAsync();

        foreach (var item in items)
        {
            results.Add(new SearchResultItem(item.Id.ToString(), $"{item.Code} — {item.Name}", "items", "/items"));
        }

        return Ok(new SearchResponse(results));
    }
}
