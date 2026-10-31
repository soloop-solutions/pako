using Pako.Domain.Hr;

namespace Pako.Api.Contracts;

// ---- G12 timesheets ----

// Kind null = derived from the date (holiday, weekend or regular).
public record SaveTimeEntryRequest(Guid EmployeeId, DateOnly Date, decimal Hours, TimeEntryKind? Kind, string? Note);

public record TimeEntryResponse(
    Guid Id, Guid EmployeeId, string EmployeeName, DateOnly Date, decimal Hours, TimeEntryKind Kind, TimeEntrySource Source,
    string? Note, bool Approved);

public record TimesheetSummaryRow(
    Guid EmployeeId,
    string EmployeeName,
    decimal Regular,
    decimal Overtime,
    decimal Night,
    decimal Weekend,
    decimal Holiday,
    int Unapproved,
    // A payroll run already used this month's timesheet adjustments: approving again changes nothing.
    bool Locked);

public record ApproveTimesheetMonthRequest(DateOnly Month, Guid? EmployeeId);

public record TimesheetImportError(int Line, string Message);

public record TimesheetImportResponse(int Imported, List<TimesheetImportError> Errors);

// One bound class for the multipart upload — see UploadAttachmentRequest for why.
public class ImportTimesheetRequest
{
    public IFormFile? File { get; set; }
}

// ---- J15 partner statement ----

public record PartnerStatementLine(
    DateOnly Date,
    string? Reference,
    string? Description,
    string AccountCode,
    decimal Debit,
    decimal Credit,
    // Running balance after this line (debit − credit: positive = the partner owes us).
    decimal Balance);

public record PartnerStatementResponse(
    Guid PartnerId,
    string PartnerName,
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    decimal TotalDebit,
    decimal TotalCredit,
    decimal ClosingBalance,
    List<PartnerStatementLine> Lines);
