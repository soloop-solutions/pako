using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/employees")]
[Authorize]
public class EmployeesController : ControllerBase
{
    private readonly PakoDbContext _db;

    public EmployeesController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<EmployeeResponse>>> List(Guid companyId)
    {
        var employees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId)
            .OrderBy(e => e.Name)
            .ToListAsync();

        return Ok(employees.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(EmployeeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<EmployeeResponse>> Create(Guid companyId, CreateEmployeeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest("Employee name is required.");
        }

        if (request.MonthlyGrossSalary <= 0)
        {
            return BadRequest("Monthly gross salary must be positive.");
        }

        var employee = new Employee
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = request.Name,
            MonthlyGrossSalary = request.MonthlyGrossSalary,
            IsActive = true
        };

        _db.Employees.Add(employee);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(employee));
    }

    private static EmployeeResponse ToResponse(Employee e) => new(e.Id, e.Name, e.MonthlyGrossSalary, e.IsActive);
}
