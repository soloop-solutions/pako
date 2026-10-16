using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

public class EmployeeValidationTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return db;
    }

    private static EmployeesController NewController(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedCompanyAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    // --- Issue A: Negative salary validation ---

    [Fact]
    public async Task Create_NegativeSalary_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", -100m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_NegativeOneCent_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", -0.01m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ZeroSalary_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 0m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_OneCent_Accepted()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 0.01m));

        var created = Assert.IsType<EmployeeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(0.01m, created.MonthlyGrossSalary);
    }

    [Fact]
    public async Task Create_ValidSalary500_Accepted()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 500m));

        var created = Assert.IsType<EmployeeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(500m, created.MonthlyGrossSalary);
        Assert.True(created.IsActive);
    }

    [Fact]
    public async Task Create_MissingName_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("", 500m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_WhitespaceName_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("   ", 500m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // --- Issue B: Decimal precision ---

    [Fact]
    public async Task Create_ThreeDecimalPlaces_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 500.001m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_SubCentPrecision_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 999.999m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_TwoDecimalPlaces_Accepted()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 500.50m));

        var created = Assert.IsType<EmployeeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(500.50m, created.MonthlyGrossSalary);
    }

    [Fact]
    public async Task Create_WholeNumber_Accepted()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 1000m));

        var created = Assert.IsType<EmployeeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(1000m, created.MonthlyGrossSalary);
    }

    [Fact]
    public async Task Create_ExceedsMaximum_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 1_000_001m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ExactlyMaximum_Accepted()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, new CreateEmployeeRequest("Alice", 1_000_000m));

        var created = Assert.IsType<EmployeeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(1_000_000m, created.MonthlyGrossSalary);
    }

    // --- Persistence verification ---

    [Fact]
    public async Task Create_SalaryPersistedAs2Decimals_InDatabase()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        await controller.Create(companyId, new CreateEmployeeRequest("Alice", 500.12m));

        var employee = await db.Employees.FirstOrDefaultAsync(e => e.CompanyId == companyId);
        Assert.Equal(500.12m, employee.MonthlyGrossSalary);
    }

    // --- Company isolation ---

    [Fact]
    public async Task List_ReturnsOnlyOwnCompanyEmployees()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var otherCompanyId = Guid.NewGuid();
        db.Companies.Add(new Company { Id = otherCompanyId, Name = "Other Co" });
        await db.SaveChangesAsync();

        var controller = NewController(db);
        await controller.Create(companyId, new CreateEmployeeRequest("Alice", 500m));
        await controller.Create(otherCompanyId, new CreateEmployeeRequest("Bob", 600m));

        var result = await controller.List(companyId);
        var employees = Assert.IsType<List<EmployeeResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Single(employees);
        Assert.Equal("Alice", employees[0].Name);
    }
}
