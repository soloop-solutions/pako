using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Tests;

public class PayrollImmutabilityTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static async Task<(PakoDbContext Db, PayrollRun Run)> SeedPostedRun()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var run = new PayrollRun
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PeriodStart = new DateOnly(2026, 8, 1),
            PeriodEnd = new DateOnly(2026, 8, 31),
            Lines =
            {
                new PayslipLine
                {
                    Id = Guid.NewGuid(),
                    EmployeeId = Guid.NewGuid(),
                    GrossSalary = 200m,
                    PitAmount = 0m,
                    EmployeePensionAmount = 10m,
                    EmployerPensionAmount = 10m,
                    NetPay = 190m
                }
            }
        };
        run.Post(company, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        db.Companies.Add(company);
        db.PayrollRuns.Add(run);
        await db.SaveChangesAsync();

        return (db, run);
    }

    [Fact]
    public async Task ModifyingPostedRun_Throws()
    {
        var (db, run) = await SeedPostedRun();

        run.PeriodEnd = run.PeriodEnd.AddDays(1);

        await Assert.ThrowsAsync<PostedPayrollRunImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ModifyingLineOfPostedRun_Throws()
    {
        var (db, run) = await SeedPostedRun();

        run.Lines[0].NetPay = 999m;

        await Assert.ThrowsAsync<PostedPayrollRunImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingPostedRun_Throws()
    {
        var (db, run) = await SeedPostedRun();

        db.PayrollRuns.Remove(run);

        await Assert.ThrowsAsync<PostedPayrollRunImmutableException>(() => db.SaveChangesAsync());
    }
}
