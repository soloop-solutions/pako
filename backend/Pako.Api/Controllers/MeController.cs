using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// F9: an employee's own HR data — payslips, annual statement, leave, profile — plus the leave
// requests of their direct reports. Every action resolves "me" from the signed-in user's linked
// Employee in this company and NEVER takes an employee id from the request, so no input can reach
// another employee's data. Open to any member with a linked employee, whatever their department's
// HR access ([RequireCompanyAccess] with no module).
[ApiController]
[Route("api/companies/{companyId:guid}/me")]
[Authorize]
public class MeController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly LeaveService _leave;
    private readonly PayslipDocumentService _documents;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExpenseClaimService _claims;

    public MeController(
        PakoDbContext db, LeaveService leave, PayslipDocumentService documents, NotificationOutbox outbox,
        IStringLocalizer<ErrorMessages> localizer, ExpenseClaimService? claims = null)
    {
        _db = db;
        _leave = leave;
        _documents = documents;
        _outbox = outbox;
        _localizer = localizer;
        _claims = claims ?? new ExpenseClaimService(db, outbox, localizer);
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private Task<Employee?> MeAsync(Guid companyId, bool track = false)
    {
        var query = _db.Employees.Where(e => e.CompanyId == companyId && e.UserId == CurrentUserId);
        return (track ? query : query.AsNoTracking()).FirstOrDefaultAsync();
    }

    private ObjectResult NotLinked() => NotFound(_localizer["NoEmployeeForUser"].Value);

    // ---- Profile ----

    [HttpGet("profile", Name = "GetMyProfile")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<MyProfileResponse>> Profile(Guid companyId)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        return Ok(await ToProfileAsync(me));
    }

    [HttpPut("profile", Name = "UpdateMyProfile")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<MyProfileResponse>> UpdateProfile(Guid companyId, UpdateMyProfileRequest request)
    {
        if (await MeAsync(companyId, track: true) is not { } me) return NotLinked();

        me.Phone = Clean(request.Phone, 64);
        me.Address = Clean(request.Address, 512);
        if (request.ReceivePayslipsByEmail is { } byEmail) me.ReceivePayslipsByEmail = byEmail;
        if (request.PreferredLanguage is "sq" or "en") me.PreferredLanguage = request.PreferredLanguage;

        if (!string.IsNullOrWhiteSpace(request.Iban))
        {
            var iban = EmployeeValidation.NormalizeIban(request.Iban);
            if (!EmployeeValidation.IsValidIban(iban)) return BadRequest(_localizer["IbanInvalid"].Value);
            var bankName = Clean(request.BankName, 128);

            if (iban != me.Iban || (bankName is not null && bankName != me.BankName))
            {
                // One open request per employee: a new one replaces the previous pending one.
                var open = await _db.EmployeeProfileChanges.FirstOrDefaultAsync(c => c.EmployeeId == me.Id && c.State == ProfileChangeState.Pending);
                if (open is not null)
                {
                    open.State = ProfileChangeState.Cancelled;
                    await _db.SaveChangesAsync();
                }

                _db.EmployeeProfileChanges.Add(new EmployeeProfileChange
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    EmployeeId = me.Id,
                    NewIban = iban,
                    NewBankName = bankName ?? me.BankName,
                    PreviousIban = me.Iban,
                    PreviousBankName = me.BankName,
                    RequestedByUserId = CurrentUserId,
                    RequestedAt = DateTime.UtcNow
                });
                await _outbox.EnqueueLocalizedAsync(companyId, NotificationTemplates.ProfileChangeRequested, await _outbox.HrTeamAsync(companyId),
                    culture => new Dictionary<string, string>
                    {
                        ["employee"] = me.Name,
                        ["field"] = NotificationRenderer.Text("Email_Field_BankAccount", culture)
                    });
            }
        }

        await _db.SaveChangesAsync();
        return Ok(await ToProfileAsync(me));
    }

    private async Task<MyProfileResponse> ToProfileAsync(Employee me)
    {
        var department = me.DepartmentId is { } d
            ? await _db.Departments.AsNoTracking().Where(x => x.Id == d).Select(x => x.Name).FirstOrDefaultAsync()
            : null;
        var manager = me.ManagerId is { } m
            ? await _db.Employees.AsNoTracking().Where(x => x.Id == m).Select(x => x.Name).FirstOrDefaultAsync()
            : null;
        var pending = await _db.EmployeeProfileChanges.AsNoTracking()
            .Where(c => c.EmployeeId == me.Id && c.State == ProfileChangeState.Pending)
            .FirstOrDefaultAsync();

        return new MyProfileResponse(me.Id, me.Name, me.PersonalNumber, me.Email, me.Phone, me.Address, me.JobTitle, department, manager,
            me.HireDate, me.Iban, me.BankName, me.ReceivePayslipsByEmail, me.PreferredLanguage,
            pending is null ? null : EmployeeProfileChangesController.ToResponse(pending, me.Name));
    }

    // ---- Payslips ----

    [HttpGet("payslips", Name = "ListMyPayslips")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<MyPayslipResponse>>> Payslips(Guid companyId)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();

        var rows = await (
            from l in _db.PayslipLines.AsNoTracking()
            join r in _db.PayrollRuns.AsNoTracking() on l.PayrollRunId equals r.Id
            where r.CompanyId == companyId && l.EmployeeId == me.Id &&
                (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid)
            orderby r.PeriodStart descending
            select new MyPayslipResponse(r.Id, l.Id, r.PeriodStart, r.PeriodEnd, r.State.ToString(), l.GrossSalary, l.NetPay, r.PaidOn))
            .ToListAsync();
        return Ok(rows);
    }

    [HttpGet("payslips/{lineId:guid}", Name = "GetMyPayslip")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<PayslipDetailResponse>> Payslip(Guid companyId, Guid lineId)
    {
        if (await MyPostedPayslipAsync(companyId, lineId) is not { } document) return NotFound();
        return Ok(document.Line);
    }

    [Produces(PayslipPdfRenderer.PdfContentType)]
    [HttpGet("payslips/{lineId:guid}/pdf", Name = "MyPayslipPdf")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<IActionResult> PayslipPdf(Guid companyId, Guid lineId)
    {
        if (await MyPostedPayslipAsync(companyId, lineId) is not { } document) return NotFound();

        var bytes = PayslipPdfRenderer.RenderPayslip(document, key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, PayslipPdfRenderer.PdfContentType, PayslipPdfRenderer.FileName(document));
    }

    // Someone else's line, an unknown id and a Draft/Approved run all answer 404 alike, so the
    // response never confirms that a given payslip exists.
    private async Task<PayslipDocument?> MyPostedPayslipAsync(Guid companyId, Guid lineId)
    {
        if (await MeAsync(companyId) is not { } me) return null;

        var runId = await _db.PayslipLines.AsNoTracking()
            .Where(l => l.Id == lineId && l.EmployeeId == me.Id)
            .Select(l => (Guid?)l.PayrollRunId)
            .FirstOrDefaultAsync();
        if (runId is null) return null;

        var document = (await _documents.LoadRunAsync(companyId, runId.Value, lineId: lineId, employeeId: me.Id)).SingleOrDefault();
        return document is { State: PayrollRunState.Posted or PayrollRunState.Paid } ? document : null;
    }

    [HttpGet("annual-statement", Name = "GetMyAnnualStatement")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<AnnualEmployeeStatementResponse>> AnnualStatement(Guid companyId, [FromQuery] int year)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        return Ok(await _documents.AnnualStatementAsync(companyId, me.Id, year));
    }

    [Produces(PayslipPdfRenderer.PdfContentType)]
    [HttpGet("annual-statement/pdf", Name = "MyAnnualStatementPdf")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<IActionResult> AnnualStatementPdf(Guid companyId, [FromQuery] int year)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var statement = (await _documents.AnnualStatementAsync(companyId, me.Id, year))!;
        var bytes = PayslipPdfRenderer.RenderAnnualStatement(
            await _documents.IssuerAsync(companyId), statement, key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, PayslipPdfRenderer.PdfContentType, $"annual-statement-{year}.pdf");
    }

    // ---- Leave ----

    [HttpGet("leave/types", Name = "ListMyLeaveTypes")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<LeaveTypeResponse>>> LeaveTypes(Guid companyId)
    {
        if (await MeAsync(companyId) is null) return NotLinked();
        await _leave.EnsureDefaultsAsync(companyId);
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId && t.IsActive).OrderBy(t => t.Code).ToListAsync();
        return Ok(types.Select(t => new LeaveTypeResponse(t.Id, t.Code, t.Name, t.DefaultAnnualDays, t.PayPercent, t.IsActive,
            t.CarryOverMaxDays, t.CarryOverExpiryMonth)).ToList());
    }

    [HttpGet("leave/balances", Name = "ListMyLeaveBalances")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<LeaveBalanceResponse>>> LeaveBalances(Guid companyId, [FromQuery] int year)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        await _leave.EnsureDefaultsAsync(companyId);
        return Ok(await _leave.ComputeBalancesAsync(companyId, year, me.Id));
    }

    [HttpGet("leave/requests", Name = "ListMyLeaveRequests")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<LeaveRequestResponse>>> LeaveRequests(Guid companyId)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var requests = await _db.LeaveRequests.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.EmployeeId == me.Id)
            .OrderByDescending(r => r.StartDate)
            .Take(200)
            .ToListAsync();
        return Ok(await _leave.ToResponsesAsync(companyId, requests));
    }

    [HttpPost("leave/requests", Name = "CreateMyLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    [ProducesResponseType(typeof(LeaveRequestResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<LeaveRequestResponse>> CreateLeaveRequest(Guid companyId, CreateMyLeaveRequest request)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();

        var result = await _leave.CreateAsync(companyId,
            new CreateLeaveRequestRequest(me.Id, request.LeaveTypeId, request.StartDate, request.EndDate, request.Reason));
        if (result.Leave is null) return BadRequest(result.Error);
        return StatusCode(StatusCodes.Status201Created, (await _leave.ToResponsesAsync(companyId, new List<LeaveRequest> { result.Leave })).Single());
    }

    [HttpPost("leave/requests/{id:guid}/cancel", Name = "CancelMyLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<LeaveRequestResponse>> CancelLeaveRequest(Guid companyId, Guid id)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();

        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId && r.EmployeeId == me.Id);
        if (leave is null) return NotFound();
        // An approved absence is HR's to undo (payroll may already count it).
        if (leave.State != LeaveRequestState.Pending) return BadRequest(_localizer["OnlyOwnPendingLeaveCancels"].Value);

        var result = await _leave.CancelAsync(leave);
        if (result.Leave is null) return BadRequest(result.Error);
        return Ok((await _leave.ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    // ---- My team (direct reports) ----

    [HttpGet("team/leave", Name = "ListMyTeamLeaveRequests")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<LeaveRequestResponse>>> TeamLeave(Guid companyId, [FromQuery] string? state = "Pending")
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();

        var query = from r in _db.LeaveRequests.AsNoTracking()
            join e in _db.Employees.AsNoTracking() on r.EmployeeId equals e.Id
            where r.CompanyId == companyId && e.ManagerId == me.Id && e.Id != me.Id
            select r;
        if (Enum.TryParse<LeaveRequestState>(state, true, out var parsed)) query = query.Where(r => r.State == parsed);

        var requests = await query.OrderBy(r => r.StartDate).Take(200).ToListAsync();
        return Ok(await _leave.ToResponsesAsync(companyId, requests));
    }

    [HttpPost("team/leave/{id:guid}/approve", Name = "ApproveTeamLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public Task<ActionResult<LeaveRequestResponse>> ApproveTeamLeave(Guid companyId, Guid id) => DecideTeamLeaveAsync(companyId, id, approve: true);

    [HttpPost("team/leave/{id:guid}/reject", Name = "RejectTeamLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public Task<ActionResult<LeaveRequestResponse>> RejectTeamLeave(Guid companyId, Guid id) => DecideTeamLeaveAsync(companyId, id, approve: false);

    private async Task<ActionResult<LeaveRequestResponse>> DecideTeamLeaveAsync(Guid companyId, Guid id, bool approve)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();

        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (leave is null) return NotFound();

        var reportsToMe = leave.EmployeeId != me.Id &&
            await _db.Employees.AnyAsync(e => e.Id == leave.EmployeeId && e.ManagerId == me.Id);
        if (!reportsToMe) return StatusCode(StatusCodes.Status403Forbidden, _localizer["NotYourReport"].Value);

        var result = await _leave.DecideAsync(leave, approve, CurrentUserId);
        if (result.Leave is null) return BadRequest(result.Error);
        return Ok((await _leave.ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    // ---- My expense claims (H13) ----

    [HttpGet("expense-claims/options", Name = "GetMyExpenseOptions")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<ExpenseOptionsResponse>> ExpenseOptions(Guid companyId)
    {
        if (await MeAsync(companyId) is null) return NotLinked();
        return Ok(await _claims.OptionsAsync(companyId));
    }

    [HttpGet("expense-claims", Name = "ListMyExpenseClaims")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<ExpenseClaimResponse>>> ExpenseClaims(Guid companyId)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var claims = await _db.ExpenseClaims.AsNoTracking().Include(c => c.Lines)
            .Where(c => c.CompanyId == companyId && c.EmployeeId == me.Id)
            .OrderByDescending(c => c.CreatedAt).Take(200).ToListAsync();
        return Ok(await _claims.ToResponsesAsync(claims));
    }

    [HttpPost("expense-claims", Name = "CreateMyExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    [ProducesResponseType(typeof(ExpenseClaimResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ExpenseClaimResponse>> CreateExpenseClaim(Guid companyId, SaveExpenseClaimRequest request)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var claim = new ExpenseClaim { Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = me.Id };
        if (await _claims.ApplyAsync(companyId, claim, request) is { } error) return BadRequest(error);
        _db.ExpenseClaims.Add(claim);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPut("expense-claims/{id:guid}", Name = "UpdateMyExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<ExpenseClaimResponse>> UpdateExpenseClaim(Guid companyId, Guid id, SaveExpenseClaimRequest request)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        if (await _claims.ApplyAsync(companyId, claim, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPost("expense-claims/{id:guid}/submit", Name = "SubmitMyExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<ExpenseClaimResponse>> SubmitExpenseClaim(Guid companyId, Guid id)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        var result = await _claims.SubmitAsync(claim);
        if (result.Claim is null) return BadRequest(result.Error);
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPost("expense-claims/{id:guid}/cancel", Name = "CancelMyExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<ExpenseClaimResponse>> CancelExpenseClaim(Guid companyId, Guid id)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        var result = await _claims.CancelAsync(claim);
        if (result.Claim is null) return BadRequest(result.Error);
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPost("expense-claims/{id:guid}/receipts", Name = "UploadMyExpenseReceipt")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(typeof(AttachmentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AttachmentResponse>> UploadReceipt(Guid companyId, Guid id, [FromForm] UploadReceiptRequest request)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        var (receipt, error) = await _claims.AddReceiptAsync(claim, request.File, CurrentUserId);
        if (receipt is null) return BadRequest(error);
        return StatusCode(StatusCodes.Status201Created,
            new AttachmentResponse(receipt.Id, receipt.OwnerType.ToString(), receipt.OwnerId, receipt.FileName, receipt.ContentType, receipt.SizeBytes, receipt.UploadedAtUtc));
    }

    [Produces("application/octet-stream")]
    [HttpGet("expense-claims/{id:guid}/receipts/{receiptId:guid}", Name = "DownloadMyExpenseReceipt")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<IActionResult> DownloadReceipt(Guid companyId, Guid id, Guid receiptId)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        var receipt = await _claims.ReceiptAsync(claim, receiptId);
        return receipt is null ? NotFound() : File(receipt.Content, receipt.ContentType, receipt.FileName);
    }

    [HttpDelete("expense-claims/{id:guid}/receipts/{receiptId:guid}", Name = "DeleteMyExpenseReceipt")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<IActionResult> DeleteReceipt(Guid companyId, Guid id, Guid receiptId)
    {
        if (await MyClaimAsync(companyId, id) is not { } claim) return NotFound();
        if (!claim.IsEditable) return BadRequest(_localizer["ExpenseClaimNotEditable"].Value);
        var receipt = await _claims.ReceiptAsync(claim, receiptId);
        if (receipt is null) return NotFound();
        _db.Attachments.Remove(receipt);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // Someone else's claim answers 404, exactly like a missing one.
    private async Task<ExpenseClaim?> MyClaimAsync(Guid companyId, Guid id)
    {
        if (await MeAsync(companyId) is not { } me) return null;
        var claim = await _claims.LoadAsync(companyId, id);
        return claim?.EmployeeId == me.Id ? claim : null;
    }

    // ---- My team's expense claims ----

    [HttpGet("team/expense-claims", Name = "ListMyTeamExpenseClaims")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public async Task<ActionResult<List<ExpenseClaimResponse>>> TeamExpenseClaims(Guid companyId)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var claims = await (
            from c in _db.ExpenseClaims.AsNoTracking().Include(c => c.Lines)
            join e in _db.Employees.AsNoTracking() on c.EmployeeId equals e.Id
            where c.CompanyId == companyId && e.ManagerId == me.Id && e.Id != me.Id && c.State == ExpenseClaimState.Submitted
            orderby c.SubmittedAt
            select c).Take(200).ToListAsync();
        return Ok(await _claims.ToResponsesAsync(claims));
    }

    [HttpPost("team/expense-claims/{id:guid}/approve", Name = "ApproveTeamExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public Task<ActionResult<ExpenseClaimResponse>> ApproveTeamExpenseClaim(Guid companyId, Guid id, DecideExpenseClaimRequest request) =>
        DecideTeamClaimAsync(companyId, id, approve: true, request.Note);

    [HttpPost("team/expense-claims/{id:guid}/reject", Name = "RejectTeamExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Self)]
    public Task<ActionResult<ExpenseClaimResponse>> RejectTeamExpenseClaim(Guid companyId, Guid id, DecideExpenseClaimRequest request) =>
        DecideTeamClaimAsync(companyId, id, approve: false, request.Note);

    private async Task<ActionResult<ExpenseClaimResponse>> DecideTeamClaimAsync(Guid companyId, Guid id, bool approve, string? note)
    {
        if (await MeAsync(companyId) is not { } me) return NotLinked();
        var claim = await _claims.LoadAsync(companyId, id);
        if (claim is null) return NotFound();

        var reportsToMe = claim.EmployeeId != me.Id && await _db.Employees.AnyAsync(e => e.Id == claim.EmployeeId && e.ManagerId == me.Id);
        if (!reportsToMe) return StatusCode(StatusCodes.Status403Forbidden, _localizer["NotYourReport"].Value);

        var result = await _claims.DecideAsync(claim, approve, CurrentUserId, note);
        if (result.Claim is null) return BadRequest(result.Error);
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    private static string? Clean(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var t && t.Length > max ? t[..max] : value.Trim();
}
