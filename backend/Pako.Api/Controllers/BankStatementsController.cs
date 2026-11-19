using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

// Bank statement import from the PAKO Excel template (docs/BANK_STATEMENTS.md). Accounting module:
// read to see statements, write to import and choose matches, approve to confirm (that posts payments).
[ApiController]
[Route("api/companies/{companyId:guid}/bank-statements")]
[Authorize]
public class BankStatementsController(
    BankStatementService statements, ExportLabels labels, IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("accounts", Name = "ListBankStatementAccounts")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<BankStatementAccountResponse>>> Accounts(Guid companyId) =>
        Ok(await statements.AccountsAsync(companyId));

    [ProducesXlsx]
    [EnableRateLimiting(AuthRateLimit.ExcelExportPolicy)]
    [HttpGet("template", Name = "DownloadBankStatementTemplate")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<IActionResult> Template(Guid companyId, [FromQuery] Guid bankAccountId)
    {
        var result = await statements.TemplateAsync(companyId, bankAccountId, labels);
        if (result.Error is not null) return BadRequest(result.Error);
        return File(result.Value!, ExcelExportService.XlsxContentType,
            $"bank-statement-template-{DateTime.UtcNow:yyyy-MM-dd}.xlsx");
    }

    [HttpPost("import", Name = "ImportBankStatement")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<BankStatementImportResponse>> Import(Guid companyId, [FromForm] ImportBankStatementRequest request)
    {
        if (request.File is null || request.File.Length == 0 || request.File.Length > BankStatementService.MaxFileBytes)
        {
            return BadRequest(localizer["BankStmtFile"].Value);
        }

        using var buffer = new MemoryStream();
        await request.File.CopyToAsync(buffer);
        var (statement, errors) = await statements.ImportAsync(
            companyId, request.BankAccountId, request.File.FileName, buffer.ToArray(), CurrentUserId);
        return Ok(new BankStatementImportResponse(statement, errors));
    }

    [HttpGet(Name = "ListBankStatements")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<BankStatementSummaryResponse>>> List(Guid companyId) =>
        Ok(await statements.ListAsync(companyId));

    [HttpGet("{id:guid}", Name = "GetBankStatement")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<BankStatementDetailResponse>> Get(Guid companyId, Guid id) =>
        await statements.DetailAsync(companyId, id) is { } detail ? Ok(detail) : NotFound();

    [HttpGet("{id:guid}/lines/{lineId:guid}/candidates", Name = "ListBankStatementLineCandidates")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<BankStatementCandidateResponse>>> Candidates(
        Guid companyId, Guid id, Guid lineId, [FromQuery] string? search = null) =>
        Result(await statements.CandidatesAsync(companyId, id, lineId, search));

    [HttpPut("{id:guid}/lines/{lineId:guid}", Name = "UpdateBankStatementLine")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<BankStatementDetailResponse>> UpdateLine(
        Guid companyId, Guid id, Guid lineId, UpdateBankStatementLineRequest request) =>
        Result(await statements.UpdateLineAsync(companyId, id, lineId, request));

    [HttpPost("{id:guid}/confirm", Name = "ConfirmBankStatement")]
    [RequireCompanyAccess(module: AccessModule.Accounting, approve: true)]
    public async Task<ActionResult<BankStatementDetailResponse>> Confirm(Guid companyId, Guid id) =>
        Result(await statements.ConfirmAsync(companyId, id, CurrentUserId));

    [HttpPost("{id:guid}/lines/{lineId:guid}/post", Name = "PostBankStatementLine")]
    [RequireCompanyAccess(module: AccessModule.Accounting, approve: true)]
    public async Task<ActionResult<BankStatementDetailResponse>> PostLine(Guid companyId, Guid id, Guid lineId) =>
        Result(await statements.PostLineAsync(companyId, id, lineId, CurrentUserId));

    [HttpDelete("{id:guid}", Name = "DeleteBankStatement")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var result = await statements.DeleteAsync(companyId, id, CurrentUserId);
        if (result.NotFound) return NotFound();
        if (result.Error is not null) return BadRequest(result.Error);
        return NoContent();
    }

    private ActionResult<T> Result<T>(BankStatementResult<T> result)
    {
        if (result.NotFound) return NotFound();
        if (result.Error is not null) return BadRequest(result.Error);
        return Ok(result.Value);
    }
}
