using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/projects")]
[Authorize]
public class ProjectsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ProjectsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<ProjectResponse>>> List(Guid companyId)
    {
        var projects = await _db.Projects.AsNoTracking()
            .Where(p => p.CompanyId == companyId)
            .OrderBy(p => p.Code)
            .ToListAsync();

        return Ok(projects.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ProjectResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ProjectResponse>> Create(Guid companyId, CreateProjectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(_localizer["ProjectCodeRequired"].Value);
        }
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(_localizer["ProjectNameRequired"].Value);
        }

        var exists = await _db.Projects.AnyAsync(p => p.CompanyId == companyId && p.Code == request.Code);
        if (exists)
        {
            return BadRequest(_localizer["ProjectCodeAlreadyExists"].Value);
        }

        var project = new Project
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Code = request.Code.Trim(),
            Name = request.Name.Trim()
        };

        _db.Projects.Add(project);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(project));
    }

    [HttpPut("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<ProjectResponse>> Update(Guid companyId, Guid id, UpdateProjectRequest request)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.CompanyId == companyId);
        if (project is null)
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(_localizer["ProjectNameRequired"].Value);
        }

        project.Name = request.Name.Trim();
        project.IsActive = request.IsActive;
        await _db.SaveChangesAsync();

        return Ok(ToResponse(project));
    }

    private static ProjectResponse ToResponse(Project p) => new(p.Id, p.Code, p.Name, p.IsActive);
}
