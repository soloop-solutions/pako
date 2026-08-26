using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/journals")]
[Authorize]
public class JournalsController : ControllerBase
{
    private readonly PakoDbContext _db;

    public JournalsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<JournalResponse>>> List(Guid companyId)
    {
        var journals = await _db.Journals.AsNoTracking()
            .Where(j => j.CompanyId == companyId)
            .OrderBy(j => j.Code)
            .ToListAsync();

        return Ok(journals.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(JournalResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalResponse>> Create(Guid companyId, CreateJournalRequest request)
    {
        var journal = new Journal
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Type = request.Type,
            Code = request.Code,
            Name = request.Name,
            SequencePrefix = request.Code,
            SequenceNextNumber = 1,
            SequencePadding = 4
        };

        _db.Journals.Add(journal);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(journal));
    }

    private static JournalResponse ToResponse(Journal j) =>
        new(j.Id, j.Type, j.Code, j.Name, j.SequencePrefix, j.SequenceNextNumber, j.SequencePadding);
}
