using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Accounting document file cabinet — source documents organized by year/month/type (buy/sell).
// Access is gated by [RequireCompanyAccess(module: Accounting)]: anyone with Accounting access
// (company admins, firm accountants, or a role with Accounting >= Read) can see and manage them.
[ApiController]
[Route("api/companies/{companyId:guid}/accounting-documents")]
[Authorize]
public class AccountingDocumentsController : ControllerBase
{
    private const long MaxFileSizeBytes = 20 * 1024 * 1024; // 20 MB

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    public AccountingDocumentsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<AccountingDocumentListResponse>> List(
        Guid companyId,
        [FromQuery] int? year,
        [FromQuery] int? month,
        [FromQuery] string? documentType)
    {
        var query = _db.AccountingDocuments.AsNoTracking()
            .Where(d => d.CompanyId == companyId);

        if (year.HasValue)
            query = query.Where(d => d.Year == year.Value);

        if (month.HasValue)
            query = query.Where(d => d.Month == month.Value);

        if (!string.IsNullOrWhiteSpace(documentType) &&
            Enum.TryParse<AccountingDocumentType>(documentType, ignoreCase: true, out var parsedType))
        {
            query = query.Where(d => d.DocumentType == parsedType);
        }

        var total = await query.CountAsync();

        var items = await query
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new AccountingDocumentResponse(
                d.Id,
                d.Name,
                d.FileName,
                d.ContentType,
                d.SizeBytes,
                d.DocumentType.ToString(),
                d.Year,
                d.Month,
                d.UploadedByUserId,
                d.CreatedAt))
            .ToArrayAsync();

        return Ok(new AccountingDocumentListResponse(items, total));
    }

    [HttpPost("upload")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(typeof(AccountingDocumentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AccountingDocumentResponse>> Upload(
        Guid companyId,
        [FromForm] UploadAccountingDocumentRequest request)
    {
        if (!Enum.TryParse<AccountingDocumentType>(request.DocumentType, ignoreCase: true, out var parsedType))
        {
            return BadRequest(_localizer["AccountingDocumentInvalidType"].Value);
        }

        var file = request.File;
        if (file is null)
        {
            return BadRequest(_localizer["AccountingDocumentFileRequired"].Value);
        }

        if (file.Length == 0)
        {
            return BadRequest(_localizer["AccountingDocumentEmptyFile"].Value);
        }

        if (file.Length > MaxFileSizeBytes)
        {
            return BadRequest(_localizer["AccountingDocumentTooLarge"].Value);
        }

        if (request.Month < 1 || request.Month > 12)
        {
            return BadRequest(_localizer["AccountingDocumentInvalidMonth"].Value);
        }

        if (request.Year < 2000 || request.Year > 2100)
        {
            return BadRequest(_localizer["AccountingDocumentInvalidYear"].Value);
        }

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);

        var name = string.IsNullOrWhiteSpace(request.Name) ? file.FileName : request.Name;

        var document = new AccountingDocument
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = name,
            FileName = file.FileName,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            SizeBytes = file.Length,
            Content = stream.ToArray(),
            DocumentType = parsedType,
            Year = request.Year,
            Month = request.Month,
            UploadedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };

        _db.AccountingDocuments.Add(document);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(document));
    }

    [HttpGet("{id:guid}/download")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<IActionResult> Download(Guid companyId, Guid id)
    {
        var document = await _db.AccountingDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);

        if (document is null)
        {
            return NotFound(_localizer["AccountingDocumentNotFound"].Value);
        }

        return File(document.Content, document.ContentType, document.FileName);
    }

    [HttpDelete("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult> Delete(Guid companyId, Guid id)
    {
        var document = await _db.AccountingDocuments
            .FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);

        if (document is null)
        {
            return NotFound(_localizer["AccountingDocumentNotFound"].Value);
        }

        _db.AccountingDocuments.Remove(document);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static AccountingDocumentResponse ToResponse(AccountingDocument d) =>
        new(d.Id, d.Name, d.FileName, d.ContentType, d.SizeBytes,
            d.DocumentType.ToString(), d.Year, d.Month, d.UploadedByUserId, d.CreatedAt);
}
