using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// F9: HR reviews the bank-account changes employees request through self-service. Approving one
// writes the new IBAN onto the employee; nothing changes until then.
[ApiController]
[Route("api/companies/{companyId:guid}/employee-profile-changes")]
[Authorize]
public class EmployeeProfileChangesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public EmployeeProfileChangesController(PakoDbContext db, NotificationOutbox outbox, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _outbox = outbox;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListEmployeeProfileChanges")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<ProfileChangeResponse>>> List(Guid companyId, [FromQuery] string? state = "Pending", [FromQuery] Guid? employeeId = null)
    {
        var query = from c in _db.EmployeeProfileChanges.AsNoTracking()
            join e in _db.Employees.AsNoTracking() on c.EmployeeId equals e.Id
            where c.CompanyId == companyId
            select new { Change = c, e.Name };
        if (Enum.TryParse<ProfileChangeState>(state, true, out var parsed)) query = query.Where(x => x.Change.State == parsed);
        if (employeeId is { } id) query = query.Where(x => x.Change.EmployeeId == id);

        var rows = await query.OrderByDescending(x => x.Change.RequestedAt).Take(200).ToListAsync();
        return Ok(rows.Select(x => ToResponse(x.Change, x.Name)).ToList());
    }

    [HttpPost("{id:guid}/approve", Name = "ApproveEmployeeProfileChange")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<ProfileChangeResponse>> Approve(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: true);

    [HttpPost("{id:guid}/reject", Name = "RejectEmployeeProfileChange")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<ProfileChangeResponse>> Reject(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: false);

    private async Task<ActionResult<ProfileChangeResponse>> DecideAsync(Guid companyId, Guid id, bool approve)
    {
        var change = await _db.EmployeeProfileChanges.FirstOrDefaultAsync(c => c.Id == id && c.CompanyId == companyId);
        if (change is null) return NotFound();
        if (change.State != ProfileChangeState.Pending) return BadRequest(_localizer["ProfileChangeNotPending"].Value);

        var employee = await _db.Employees.FirstAsync(e => e.Id == change.EmployeeId);

        // A requester can't approve their own bank change, even with HR write access.
        if (approve && employee.UserId == CurrentUserId)
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["CannotApproveOwnChange"].Value);
        }

        change.Decide(approve, CurrentUserId, DateTime.UtcNow);
        if (approve)
        {
            employee.Iban = change.NewIban;
            employee.BankName = change.NewBankName;
        }

        if (await _outbox.EmployeeAsync(employee) is { } recipient)
        {
            await _outbox.EnqueueAsync(companyId, NotificationTemplates.ProfileChangeDecided, new[] { recipient }, new Dictionary<string, string>
            {
                ["employee"] = employee.Name,
                ["field"] = NotificationRenderer.Text("Email_Field_BankAccount", recipient.Culture),
                ["decision"] = NotificationRenderer.Text(approve ? "Email_Decision_Approved" : "Email_Decision_Rejected", recipient.Culture)
            });
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(change, employee.Name));
    }

    internal static ProfileChangeResponse ToResponse(EmployeeProfileChange c, string employeeName) => new(
        c.Id, c.EmployeeId, employeeName, c.NewIban, c.NewBankName, c.PreviousIban, c.PreviousBankName, c.State.ToString(), c.RequestedAt, c.DecidedAt);
}
