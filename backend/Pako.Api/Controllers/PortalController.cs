using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Invoicing;
using Pako.Domain.Notifications;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Client feedback phase 5 — the customer portal. A customer's contact (ClientCustomer membership)
// browses the catalogue at their own prices, places orders that reach the company as draft sales
// orders, follows them, and sees their posted invoices and balance. Everything is scoped to the
// membership's partner by PortalAccessFilter; no partner id is ever taken from the request.
// Staff confirm a portal order in Sales orders, which also makes its draft invoice.
[ApiController]
[Route("api/portal/companies")]
[Authorize]
public class PortalController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PortalService _portalService;
    private readonly PortalContext _portal;
    private readonly SalesCreditService _credit;
    private readonly NotificationOutbox _outbox;
    private readonly EmailOptions _email;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PortalController(PakoDbContext db, PortalService portalService, PortalContext portal, SalesCreditService credit,
        NotificationOutbox outbox, IOptions<EmailOptions> email, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _portalService = portalService;
        _portal = portal;
        _credit = credit;
        _outbox = outbox;
        _email = email.Value;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // The companies this login buys from through the portal (empty for staff-only logins).
    [HttpGet(Name = "ListPortalCompanies")]
    public async Task<ActionResult<List<PortalCompanyResponse>>> Companies() =>
        Ok(await _portalService.CompaniesAsync(CurrentUserId));

    [HttpGet("{companyId:guid}", Name = "GetPortalSummary")]
    [RequirePortalAccess]
    public async Task<ActionResult<PortalSummaryResponse>> Summary(Guid companyId)
    {
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var partner = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == _portal.PartnerId);
        var credit = await _credit.StatusAsync(companyId, _portal.PartnerId);
        return Ok(new PortalSummaryResponse(company.Id, company.Name, company.Email, company.Phone, company.LogoUrl, partner.Id, partner.Name,
            credit?.Outstanding ?? 0m, credit?.Overdue ?? 0m, credit?.OpenOrders ?? 0m, credit?.CreditLimit, credit?.Available,
            credit?.OverdueBlocked ?? false));
    }

    // ---- Catalogue ----

    [HttpGet("{companyId:guid}/categories", Name = "ListPortalCategories")]
    [RequirePortalAccess]
    public async Task<ActionResult<List<PortalCategoryResponse>>> Categories(Guid companyId) =>
        Ok(await _portalService.CategoriesAsync(companyId));

    [HttpGet("{companyId:guid}/catalogue", Name = "ListPortalCatalogue")]
    [RequirePortalAccess]
    public async Task<ActionResult<PaginatedResponse<PortalCatalogueItemResponse>>> Catalogue(Guid companyId,
        [FromQuery] string? search = null, [FromQuery] Guid? categoryId = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50) =>
        Ok(await _portalService.CatalogueAsync(companyId, _portal.PartnerId, search, categoryId, page, pageSize));

    // Prices the cart exactly as placing it would.
    [HttpPost("{companyId:guid}/cart", Name = "PricePortalCart")]
    [RequirePortalAccess]
    public async Task<ActionResult<PortalCartResponse>> Cart(Guid companyId, PortalCartRequest request)
    {
        var priced = await _portalService.PriceAsync(companyId, _portal.PartnerId, request.Lines);
        if (priced.Error is { } error) return BadRequest(error);
        var (lines, net, vat, gross) = await _portalService.AmountsAsync(priced.Lines!);
        return Ok(new PortalCartResponse(lines, net, vat, gross));
    }

    // ---- Orders ----

    [HttpGet("{companyId:guid}/orders", Name = "ListPortalOrders")]
    [RequirePortalAccess]
    public async Task<ActionResult<PaginatedResponse<PortalOrderSummaryResponse>>> Orders(Guid companyId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = MyOrders(companyId);
        var total = await query.CountAsync();
        var orders = await query.OrderByDescending(o => o.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize)
            .Include(o => o.Lines).AsNoTracking().ToListAsync();
        return Ok(new PaginatedResponse<PortalOrderSummaryResponse>(orders.Select(o => new PortalOrderSummaryResponse(o.Id,
            PortalService.Reference(o), o.Number, o.Date, o.DeliveryDate, PortalService.Status(o.State), o.Lines.Sum(l => l.Gross),
            o.Lines.Count, o.CustomerReference, o.CreatedAt)).ToList(), total, page, pageSize));
    }

    [HttpGet("{companyId:guid}/orders/{id:guid}", Name = "GetPortalOrder")]
    [RequirePortalAccess]
    public async Task<ActionResult<PortalOrderResponse>> Order(Guid companyId, Guid id)
    {
        var order = await MyOrders(companyId).Include(o => o.Lines).AsNoTracking().FirstOrDefaultAsync(o => o.Id == id);
        return order is null ? NotFound() : Ok(await ToResponseAsync(order));
    }

    // The order reaches the company as a draft sales order at this customer's prices of today.
    [HttpPost("{companyId:guid}/orders", Name = "PlacePortalOrder")]
    [RequirePortalAccess]
    [ProducesResponseType(typeof(PortalOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PortalOrderResponse>> Place(Guid companyId, PlacePortalOrderRequest request)
    {
        var today = PortalService.Today;
        if (request.DeliveryDate is { } wanted && wanted < today) return BadRequest(_localizer["PortalDeliveryDateInPast"].Value);
        var priced = await _portalService.PriceAsync(companyId, _portal.PartnerId, request.Lines);
        if (priced.Error is { } error) return BadRequest(error);

        var order = new SalesOrder
        {
            Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = _portal.PartnerId, Date = today, DeliveryDate = request.DeliveryDate,
            CustomerReference = Clip(request.CustomerReference, 128), DeliveryAddress = Clip(request.DeliveryAddress, 500),
            Notes = Clip(request.Notes, 2000), Source = SalesOrderSource.Portal, CreatedByUserId = CurrentUserId,
        };
        foreach (var line in priced.Lines!)
        {
            line.SalesOrderId = order.Id;
            order.Lines.Add(line);
        }
        _db.SalesOrders.Add(order);

        var (_, _, _, gross) = await _portalService.AmountsAsync(order.Lines);
        var company = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).FirstAsync();
        var customer = await _db.Partners.AsNoTracking().Where(p => p.Id == _portal.PartnerId).Select(p => p.Name).FirstAsync();
        await _outbox.EnqueueLocalizedAsync(companyId, NotificationTemplates.PortalOrderPlaced, await _outbox.SalesTeamAsync(companyId), _ =>
            new Dictionary<string, string>
            {
                ["company"] = company,
                ["customer"] = customer,
                ["reference"] = PortalService.Reference(order),
                ["total"] = gross.ToString("N2", System.Globalization.CultureInfo.InvariantCulture),
                ["lines"] = order.Lines.Count.ToString(),
                ["link"] = $"{_email.AppBaseUrl.TrimEnd('/')}/sales-orders/{order.Id}",
            });
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await ToResponseAsync(order));
    }

    // While the company hasn't answered yet, the customer can withdraw the order.
    [HttpPost("{companyId:guid}/orders/{id:guid}/cancel", Name = "CancelPortalOrder")]
    [RequirePortalAccess]
    public async Task<ActionResult<PortalOrderResponse>> Cancel(Guid companyId, Guid id)
    {
        var order = await MyOrders(companyId).Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Draft) return BadRequest(_localizer["PortalOrderNotCancellable"].Value);
        order.State = SalesOrderState.Cancelled;
        order.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // All of this customer's orders, the ones staff took for them included.
    private IQueryable<SalesOrder> MyOrders(Guid companyId) =>
        _db.SalesOrders.Where(o => o.CompanyId == companyId && o.PartnerId == _portal.PartnerId);

    private async Task<PortalOrderResponse> ToResponseAsync(SalesOrder order)
    {
        var (lines, net, vat, gross) = await _portalService.AmountsAsync(order.Lines);
        return new PortalOrderResponse(order.Id, PortalService.Reference(order), order.Number, order.Date, order.DeliveryDate,
            PortalService.Status(order.State), order.CustomerReference, order.DeliveryAddress, order.Notes, order.CreatedAt,
            order.State == SalesOrderState.Draft && order.Source == SalesOrderSource.Portal,
            lines, net, vat, gross, await _portalService.InvoicesForOrderAsync(order));
    }

    // ---- Invoices ----

    [HttpGet("{companyId:guid}/invoices", Name = "ListPortalInvoices")]
    [RequirePortalAccess]
    public async Task<ActionResult<PaginatedResponse<PortalInvoiceSummaryResponse>>> Invoices(Guid companyId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _portalService.Invoices(companyId, _portal.PartnerId);
        var total = await query.CountAsync();
        var invoices = await query.OrderByDescending(i => i.IssueDate).ThenByDescending(i => i.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize)
            .Include(i => i.Lines).ToListAsync();
        var totals = await _portalService.TotalsAsync(companyId, _portal.PartnerId, invoices);
        var today = PortalService.Today;
        return Ok(new PaginatedResponse<PortalInvoiceSummaryResponse>(invoices.Select(i =>
        {
            var (amount, open) = totals[i.Id];
            return new PortalInvoiceSummaryResponse(i.Id, i.InvoiceNumber, i.DocumentType.ToString(), i.IssueDate, i.DueDate,
                amount.GrossAmount, open, open > 0 && i.DueDate < today);
        }).ToList(), total, page, pageSize));
    }

    // Email delivery: the invoice as a PDF — only the customer's own posted documents (same scope as above).
    [HttpGet("{companyId:guid}/invoices/{id:guid}/pdf", Name = "GetPortalInvoicePdf")]
    [ProducesPdf]
    [RequirePortalAccess]
    public async Task<IActionResult> InvoicePdf(Guid companyId, Guid id, [FromServices] InvoiceDocumentService documents)
    {
        if (!await _portalService.Invoices(companyId, _portal.PartnerId).AnyAsync(i => i.Id == id)) return NotFound();
        var document = await documents.LoadAsync(companyId, id);
        if (document is null) return NotFound();
        var bytes = InvoicePdfRenderer.Render(document, key => _localizer[key].Value, System.Globalization.CultureInfo.CurrentUICulture);
        return File(bytes, InvoicePdfRenderer.PdfContentType, InvoicePdfRenderer.FileName(document));
    }

    [HttpGet("{companyId:guid}/invoices/{id:guid}", Name = "GetPortalInvoice")]
    [RequirePortalAccess]
    public async Task<ActionResult<PortalInvoiceResponse>> Invoice(Guid companyId, Guid id)
    {
        var invoice = await _portalService.Invoices(companyId, _portal.PartnerId).Include(i => i.Lines).FirstOrDefaultAsync(i => i.Id == id);
        if (invoice is null) return NotFound();
        var (amount, open) = (await _portalService.TotalsAsync(companyId, _portal.PartnerId, new List<Invoice> { invoice }))[invoice.Id];
        var taxes = await _portalService.TaxesForAsync(companyId, invoice.Lines);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var partner = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == _portal.PartnerId);
        var lines = invoice.Lines.Select(l =>
        {
            var a = _portalService.LineAmounts(l, invoice.PriceMode, taxes);
            return new PortalPricedLineResponse(l.ItemId, l.Description, l.Quantity, l.UnitName, l.UnitPrice, l.DiscountPercent,
                a.NetAmount, a.TaxAmount, a.GrossAmount);
        }).ToList();
        return Ok(new PortalInvoiceResponse(invoice.Id, invoice.InvoiceNumber, invoice.DocumentType.ToString(), invoice.IssueDate, invoice.DueDate,
            company.Name, company.FiscalNumber, company.VatNumber, Address(company.StreetAddress, company.PostalCode, company.Municipality),
            partner.Name, partner.FiscalNumber, Address(partner.StreetAddress, partner.PostalCode, partner.City),
            lines, amount.NetAmount, amount.TaxAmount, amount.GrossAmount, open, open > 0 && invoice.DueDate < PortalService.Today));
    }

    private static string? Address(params string?[] parts)
    {
        var text = string.Join(", ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
        return text.Length == 0 ? null : text;
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}
