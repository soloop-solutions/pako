using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class CreditLimitTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
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

    private static PartnersController NewPartnersController(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted());

    private static InvoicesController NewInvoicesController(PakoDbContext db) =>
        new(db, TaxService, new DocumentNumberService(), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid AccountId)> SeedAsync(decimal? creditLimit = null)
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co", IsVatRegistered = false };
        var partnerId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var depositsAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner
        {
            Id = partnerId,
            CompanyId = company.Id,
            Name = "Acme",
            IsCustomer = true,
            CreditLimit = creditLimit
        });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4001", Name = "Other Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "2100", Name = "VAT Payable", AccountType = AccountType.CurrentLiability });
        db.Accounts.Add(new Account { Id = depositsAccountId, CompanyId = company.Id, Code = "2500", Name = "Customer Deposits", AccountType = AccountType.CurrentLiability });
        db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
            CustomerDepositsAccountId = depositsAccountId
        });
        await db.SaveChangesAsync();
        return (db, company.Id, partnerId, receivableAccountId);
    }

    private static CreateInvoiceRequest InvoiceRequest(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", quantity, unitPrice, null, null) });

    // --- Partner validation tests ---

    [Fact(Skip = "Credit limit validation not yet enforced in PartnersController")]
    public async Task Create_RejectsNegativeCreditLimit()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var account = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1200", Name = "AR", AccountType = AccountType.Receivable };
        db.Companies.Add(company);
        db.Accounts.Add(account);
        await db.SaveChangesAsync();

        var controller = NewPartnersController(db);
        var result = await controller.Create(company.Id, new CreatePartnerRequest(
            "Acme", null, true, false, CreditLimit: -100m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact(Skip = "Credit limit validation not yet enforced in PartnersController")]
    public async Task Update_RejectsNegativeCreditLimit()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var controller = NewPartnersController(db);
        var created = await controller.Create(company.Id, new CreatePartnerRequest("Acme", null, true, false));
        var partner = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Update(company.Id, partner.Id, new UpdatePartnerRequest(
            "Acme", null, true, false, CreditLimit: -50m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // --- Credit limit enforcement on posting ---

    [Fact]
    public async Task PostInvoice_AllowedWhenNoCreditLimit()
    {
        // null credit limit = unlimited
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: null);
        var controller = NewInvoicesController(db);

        var created = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 10000m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, invoice.Id);
        var posted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Posted", posted.State);
    }

    [Fact]
    public async Task PostInvoice_AllowedBelowLimit()
    {
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: 500m);
        var controller = NewInvoicesController(db);

        var created = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 300m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, invoice.Id);
        var posted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Posted", posted.State);
    }

    [Fact]
    public async Task PostInvoice_AllowedAtExactLimit()
    {
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: 100m);
        var controller = NewInvoicesController(db);

        var created = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, invoice.Id);
        var posted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Posted", posted.State);
    }

    [Fact(Skip = "Credit limit enforcement on posting not yet implemented")]
    public async Task PostInvoice_BlockedAboveLimit()
    {
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: 50m);
        var controller = NewInvoicesController(db);

        var created = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, invoice.Id);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact(Skip = "Credit limit enforcement on posting not yet implemented")]
    public async Task PostInvoice_BlockedWithExistingOutstanding()
    {
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: 150m);
        var controller = NewInvoicesController(db);

        // Post first invoice for 100
        var created1 = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 100m));
        var invoice1 = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created1.Result).Value);
        var post1 = await controller.Post(companyId, invoice1.Id);
        Assert.IsType<OkObjectResult>(post1.Result); // 100 outstanding, 50 available

        // Try to post second invoice for 60 — exceeds remaining 50
        var created2 = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 60m));
        var invoice2 = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created2.Result).Value);

        var result = await controller.Post(companyId, invoice2.Id);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task PostInvoice_AllowedAfterPaymentReducesOutstanding()
    {
        var (db, companyId, partnerId, _) = await SeedAsync(creditLimit: 150m);
        var controller = NewInvoicesController(db);

        // Seed a cash account for payment
        var cashAccountId = await db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.AccountSubType == AccountSubType.Cash)
            .Select(a => a.Id)
            .FirstAsync();

        // Post first invoice for 100
        var created1 = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 100m));
        var invoice1 = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created1.Result).Value);
        await controller.Post(companyId, invoice1.Id);

        // Record payment of 80 against the first invoice
        await controller.RecordPayment(companyId, invoice1.Id,
            new RecordPaymentRequest(80m, cashAccountId, new DateOnly(2026, 8, 27)));

        // Now outstanding is 20, available is 130
        // Post second invoice for 60 — should succeed (20 + 60 = 80 < 150)
        var created2 = await controller.Create(companyId, InvoiceRequest(partnerId, 1m, 60m));
        var invoice2 = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created2.Result).Value);

        var result = await controller.Post(companyId, invoice2.Id);
        var posted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Posted", posted.State);
    }

    // --- Credit exposure endpoint ---

    [Fact(Skip = "CreditExposure endpoint not yet implemented")]
    public async Task CreditExposure_ReturnsCorrectValues()
    {
        await Task.CompletedTask;
    }

    [Fact(Skip = "CreditExposure endpoint not yet implemented")]
    public async Task CreditExposure_NullLimitReturnsNullAvailable()
    {
        await Task.CompletedTask;
    }
}
