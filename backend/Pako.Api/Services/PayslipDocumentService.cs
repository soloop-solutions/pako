using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// Who issued the document, printed in the header of every payslip and annual statement.
public record DocumentIssuer(string Name, string? FiscalNumber, string? BusinessNumber, string? Address)
{
    public static DocumentIssuer From(Company company) => new(
        string.IsNullOrWhiteSpace(company.TradingName) ? company.Name : company.TradingName!,
        company.FiscalNumber,
        company.BusinessNumber,
        string.Join(", ", new[] { company.StreetAddress, company.PostalCode, company.Municipality }
            .Where(p => !string.IsNullOrWhiteSpace(p))) is { Length: > 0 } a ? a : null);
}

public record PayslipDocument(
    DocumentIssuer Issuer,
    Guid RunId,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    PayrollRunState State,
    PayslipDetailResponse Line);

// Loads payslips and annual statements exactly as stored on the run (snapshots only — nothing is
// recomputed), for the HR screens, the PDF renderer and employee self-service alike.
public class PayslipDocumentService
{
    private readonly PakoDbContext _db;

    public PayslipDocumentService(PakoDbContext db)
    {
        _db = db;
    }

    public async Task<List<PayslipDocument>> LoadRunAsync(Guid companyId, Guid runId, Guid? lineId = null, Guid? employeeId = null)
    {
        var run = await _db.PayrollRuns.AsNoTracking()
            .Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == runId && r.CompanyId == companyId);
        if (run is null) return new List<PayslipDocument>();

        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var lookups = await PayrollRunsController.LookupsAsync(_db, companyId);
        var adjustments = await _db.PayrollAdjustments.AsNoTracking().Where(a => a.PayrollRunId == run.Id).ToListAsync();
        var detail = PayrollRunsController.ToResponse(run, lookups, adjustments, new List<string>(), includeLines: true);
        var issuer = DocumentIssuer.From(company);

        return detail.Lines
            .Where(l => lineId is null || l.Id == lineId)
            .Where(l => employeeId is null || l.EmployeeId == employeeId)
            .Select(l => new PayslipDocument(issuer, run.Id, run.PeriodStart, run.PeriodEnd, run.State, l))
            .ToList();
    }

    // The yearly income and withholding statement each employee needs for their own annual
    // return (due 31 March). Posted and Paid runs only — a Draft isn't income yet.
    public async Task<AnnualEmployeeStatementResponse?> AnnualStatementAsync(Guid companyId, Guid employeeId, int year)
    {
        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == employeeId && e.CompanyId == companyId);
        if (employee is null) return null;

        var yearStart = new DateOnly(year, 1, 1);
        var yearEnd = new DateOnly(year, 12, 31);
        var months = await (
            from l in _db.PayslipLines.AsNoTracking()
            join r in _db.PayrollRuns.AsNoTracking() on l.PayrollRunId equals r.Id
            where r.CompanyId == companyId && l.EmployeeId == employeeId &&
                (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid) &&
                r.PeriodEnd >= yearStart && r.PeriodEnd <= yearEnd
            orderby r.PeriodStart
            select new AnnualEmployeeStatementMonth(r.PeriodStart, r.PeriodEnd, l.GrossSalary, l.EmployeePensionAmount,
                l.EmployerPensionAmount, l.PitAmount, l.NetPay)).ToListAsync();

        return new AnnualEmployeeStatementResponse(
            employee.Id, employee.Name, employee.PersonalNumber, year, months,
            months.Sum(m => m.GrossSalary), months.Sum(m => m.EmployeePension), months.Sum(m => m.EmployerPension),
            months.Sum(m => m.Pit), months.Sum(m => m.NetPay));
    }

    public async Task<DocumentIssuer> IssuerAsync(Guid companyId) =>
        DocumentIssuer.From(await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId));
}
