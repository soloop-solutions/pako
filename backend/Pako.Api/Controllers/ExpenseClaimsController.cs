using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// H13 (HR side): every claim of the company — approve or reject submitted ones (approval drafts the
// bill), and schedule a posted one for reimbursement with a month's salary. Employees file and
// follow their own claims through MeController.
[ApiController]
[Route("api/companies/{companyId:guid}/expense-claims")]
[Authorize]
public class ExpenseClaimsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ExpenseClaimService _claims;

    public ExpenseClaimsController(PakoDbContext db, ExpenseClaimService claims)
    {
        _db = db;
        _claims = claims;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListExpenseClaims")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<ExpenseClaimResponse>>> List(Guid companyId, [FromQuery] string? state = null, [FromQuery] Guid? employeeId = null)
    {
        var query = _db.ExpenseClaims.AsNoTracking().Include(c => c.Lines)
            .Where(c => c.CompanyId == companyId && c.State != ExpenseClaimState.Draft);
        if (Enum.TryParse<ExpenseClaimState>(state, true, out var parsed)) query = query.Where(c => c.State == parsed);
        if (employeeId is { } e) query = query.Where(c => c.EmployeeId == e);

        var claims = await query.OrderByDescending(c => c.SubmittedAt).Take(500).ToListAsync();
        return Ok(await _claims.ToResponsesAsync(claims));
    }

    [HttpGet("{id:guid}", Name = "GetExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<ExpenseClaimResponse>> Get(Guid companyId, Guid id)
    {
        var claim = await _claims.LoadAsync(companyId, id);
        if (claim is null || claim.State == ExpenseClaimState.Draft) return NotFound();
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPost("{id:guid}/approve", Name = "ApproveExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<ExpenseClaimResponse>> Approve(Guid companyId, Guid id, DecideExpenseClaimRequest request) =>
        DecideAsync(companyId, id, approve: true, request.Note);

    [HttpPost("{id:guid}/reject", Name = "RejectExpenseClaim")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<ExpenseClaimResponse>> Reject(Guid companyId, Guid id, DecideExpenseClaimRequest request) =>
        DecideAsync(companyId, id, approve: false, request.Note);

    private async Task<ActionResult<ExpenseClaimResponse>> DecideAsync(Guid companyId, Guid id, bool approve, string? note)
    {
        var claim = await _claims.LoadAsync(companyId, id);
        if (claim is null) return NotFound();
        var result = await _claims.DecideAsync(claim, approve, CurrentUserId, note);
        if (result.Claim is null) return BadRequest(result.Error);
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [HttpPost("{id:guid}/reimburse-via-payroll", Name = "ReimburseExpenseClaimViaPayroll")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    public async Task<ActionResult<ExpenseClaimResponse>> ReimburseViaPayroll(Guid companyId, Guid id, ReimburseViaPayrollRequest request)
    {
        var claim = await _claims.LoadAsync(companyId, id);
        if (claim is null) return NotFound();
        var result = await _claims.ReimburseViaPayrollAsync(claim, request.Period);
        if (result.Claim is null) return BadRequest(result.Error);
        return Ok((await _claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single());
    }

    [Produces("application/octet-stream")]
    [HttpGet("{id:guid}/receipts/{receiptId:guid}", Name = "DownloadExpenseClaimReceipt")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<IActionResult> Receipt(Guid companyId, Guid id, Guid receiptId)
    {
        var claim = await _claims.LoadAsync(companyId, id);
        if (claim is null) return NotFound();
        var receipt = await _claims.ReceiptAsync(claim, receiptId);
        return receipt is null ? NotFound() : File(receipt.Content, receipt.ContentType, receipt.FileName);
    }
}
