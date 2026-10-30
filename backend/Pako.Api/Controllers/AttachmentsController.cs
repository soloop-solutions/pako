using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Attachments;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// B12: one generic attachment endpoint for every owner type (AttachmentOwnerType + owner id),
// not a nested .../invoices/{id}/attachments route per document — see Attachment.cs's own
// comment for why (storage choice, OCR scope, generic-over-typed reasoning).
[ApiController]
[Route("api/companies/{companyId:guid}/attachments")]
[Authorize]
public class AttachmentsController : ControllerBase
{
    private const long MaxFileSizeBytes = 20 * 1024 * 1024;

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    // The owner type is only known at runtime, so the attribute can't name an area. Every action
    // checks the owner itself (CanAccessOwnerAsync): View on the owner's area to read, Edit to
    // attach or remove (docs/USER_ACCESS_PLAN.md), and, when partner-scoped, the owner must
    // reference a visible partner — anything else is a 404, same as a missing owner. A read-only
    // member (ClientViewer) resolves to View everywhere, so it can never attach or remove.
    public AttachmentsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<AttachmentResponse>>> List(Guid companyId, [FromQuery] AttachmentOwnerType ownerType, [FromQuery] Guid ownerId)
    {
        if (!await CanAccessOwnerAsync(companyId, ownerType, ownerId))
        {
            return NotFound();
        }

        var attachments = await _db.Attachments.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.OwnerType == ownerType && a.OwnerId == ownerId)
            .OrderByDescending(a => a.UploadedAtUtc)
            .ToListAsync();

        return Ok(attachments.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess] // Edit on the owner's area is checked per owner below
    [Consumes("multipart/form-data")]
    [ProducesResponseType(typeof(AttachmentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AttachmentResponse>> Upload(Guid companyId, [FromForm] UploadAttachmentRequest request)
    {
        // OwnerType is a plain string on the request model, not AttachmentOwnerType directly:
        // ASP.NET Core's built-in OpenAPI generator describes several individual [FromForm]
        // parameters (including an enum) as an `allOf` composition that NSwag's client generator
        // doesn't flatten correctly — confirmed by regen: parameters silently vanished from the
        // generated client. Binding the whole form to UploadAttachmentRequest (see its own
        // comment) fixed that; parsing the enum here instead of at the model-binding boundary
        // keeps that generator workaround contained to this one spot.
        if (!Enum.TryParse<AttachmentOwnerType>(request.OwnerType, ignoreCase: true, out var parsedOwnerType))
        {
            return BadRequest(_localizer["AttachmentOwnerNotFound"].Value);
        }

        var file = request.File;
        if (file is null)
        {
            return BadRequest(_localizer["AttachmentFileRequired"].Value);
        }

        if (file.Length == 0)
        {
            return BadRequest(_localizer["AttachmentEmptyFile"].Value);
        }

        if (file.Length > MaxFileSizeBytes)
        {
            return BadRequest(_localizer["AttachmentTooLarge"].Value);
        }

        if (!await OwnerBelongsToCompanyAsync(companyId, parsedOwnerType, request.OwnerId) ||
            !await CanAccessOwnerAsync(companyId, parsedOwnerType, request.OwnerId, AccessLevel.Write))
        {
            return BadRequest(_localizer["AttachmentOwnerNotFound"].Value);
        }

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);

        var attachment = new Attachment
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            OwnerType = parsedOwnerType,
            OwnerId = request.OwnerId,
            FileName = file.FileName,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            SizeBytes = file.Length,
            Content = stream.ToArray(),
            UploadedAtUtc = DateTime.UtcNow,
            UploadedByUserId = CurrentUserId
        };

        _db.Attachments.Add(attachment);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(attachment));
    }

    [HttpGet("{id:guid}/download")]
    [RequireCompanyAccess]
    public async Task<IActionResult> Download(Guid companyId, Guid id)
    {
        var attachment = await _db.Attachments.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (attachment is null || !await CanAccessOwnerAsync(companyId, attachment.OwnerType, attachment.OwnerId))
        {
            return NotFound();
        }

        return File(attachment.Content, attachment.ContentType, attachment.FileName);
    }

    [HttpDelete("{id:guid}")]
    [RequireCompanyAccess] // Edit on the owner's area is checked per owner below
    public async Task<ActionResult> Delete(Guid companyId, Guid id)
    {
        var attachment = await _db.Attachments.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (attachment is null || !await CanAccessOwnerAsync(companyId, attachment.OwnerType, attachment.OwnerId, AccessLevel.Write))
        {
            return NotFound();
        }

        _db.Attachments.Remove(attachment);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<bool> OwnerBelongsToCompanyAsync(Guid companyId, AttachmentOwnerType ownerType, Guid ownerId) => ownerType switch
    {
        AttachmentOwnerType.Invoice => await _db.Invoices.AnyAsync(i => i.Id == ownerId && i.CompanyId == companyId),
        AttachmentOwnerType.Bill => await _db.Bills.AnyAsync(b => b.Id == ownerId && b.CompanyId == companyId),
        AttachmentOwnerType.JournalEntry => await _db.JournalEntries.AnyAsync(e => e.Id == ownerId && e.CompanyId == companyId),
        AttachmentOwnerType.Partner => await _db.Partners.AnyAsync(p => p.Id == ownerId && p.CompanyId == companyId),
        _ => false
    };

    private static AccessModule ModuleFor(AttachmentOwnerType ownerType) => ownerType switch
    {
        AttachmentOwnerType.Invoice => AccessModule.Sales,
        AttachmentOwnerType.Bill => AccessModule.Purchases,
        AttachmentOwnerType.JournalEntry => AccessModule.Accounting,
        AttachmentOwnerType.Partner => AccessModule.Partners,
        AttachmentOwnerType.ExpenseClaim => AccessModule.Hr,
        _ => AccessModule.None
    };

    // Unrestricted callers short-circuit to true (existence is checked separately where it
    // matters). A journal entry has no single partner to scope by, so a partner-scoped user is
    // always denied one — Department.LevelFor already forces their Accounting to None.
    // Reading needs View on the owner's area; attaching or removing evidence needs Edit there.
    private async Task<bool> CanAccessOwnerAsync(Guid companyId, AttachmentOwnerType ownerType, Guid ownerId, AccessLevel required = AccessLevel.Read)
    {
        if (_access.LevelFor(ModuleFor(ownerType)) < required)
        {
            return false;
        }

        if (!_access.IsPartnerRestricted)
        {
            return true;
        }

        return ownerType switch
        {
            AttachmentOwnerType.Invoice => await _db.Invoices.VisibleTo(_access).AnyAsync(i => i.Id == ownerId && i.CompanyId == companyId),
            AttachmentOwnerType.Bill => await _db.Bills.VisibleTo(_access).AnyAsync(b => b.Id == ownerId && b.CompanyId == companyId),
            AttachmentOwnerType.Partner => _access.CanSeePartner(ownerId),
            _ => false
        };
    }

    private static AttachmentResponse ToResponse(Attachment a) =>
        new(a.Id, a.OwnerType.ToString(), a.OwnerId, a.FileName, a.ContentType, a.SizeBytes, a.UploadedAtUtc);
}
