using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using Pako.Domain.Notifications;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// Email delivery (docs/EMAIL.md): the HTTP email API sender, permanent vs temporary failures, the
// configuration check, and sending a posted invoice to the customer as a PDF.
public class EmailDeliveryTests : IAsyncLifetime
{
    private static readonly TaxComputationService Tax = new();
    private static readonly NullStringLocalizer<ErrorMessages> L = new();
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    // ---- The API sender ----

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> answer) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request, request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return await answer(request);
        }
    }

    private static EmailOptions ApiOptions(string authHeader = "Authorization", int timeout = 15) => new()
    {
        Mode = EmailOptions.ApiMode,
        FromAddress = "no-reply@pako.test",
        FromName = "PAKO",
        AppBaseUrl = "https://app.pako.test",
        Api = new EmailApiOptions { Url = "https://mail.example.test/send", ApiKey = "secret-key", AuthHeader = authHeader, TimeoutSeconds = timeout },
    };

    private static (ApiEmailSender Sender, StubHandler Handler) Api(HttpStatusCode status, EmailOptions? options = null, string body = "")
    {
        var handler = new StubHandler(_ => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) }));
        return (new ApiEmailSender(new HttpClient(handler), Options.Create(options ?? ApiOptions())), handler);
    }

    private static EmailMessage Message(params EmailAttachment[] attachments) =>
        new("customer@bar.test", "Invoice INV-1", "text body", "<p>html body</p>", attachments, "abc123");

    [Fact]
    public async Task ApiSender_PostsTheMessageWithKeyAttachmentsAndIdempotencyKey()
    {
        var (sender, handler) = Api(HttpStatusCode.Accepted);
        await sender.SendAsync(Message(new EmailAttachment("invoice-INV-1.pdf", "application/pdf", Encoding.ASCII.GetBytes("%PDF-1.7"))));

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://mail.example.test/send", request.RequestUri!.ToString());
        Assert.Equal("Bearer secret-key", request.Headers.Authorization!.ToString());
        Assert.Equal("abc123", Assert.Single(request.Headers.GetValues("Idempotency-Key")));

        // Resend's POST /emails body.
        var json = JsonDocument.Parse(body).RootElement;
        Assert.Equal("PAKO <no-reply@pako.test>", json.GetProperty("from").GetString());
        Assert.Equal("customer@bar.test", Assert.Single(json.GetProperty("to").EnumerateArray()).GetString());
        Assert.Equal("Invoice INV-1", json.GetProperty("subject").GetString());
        Assert.Equal("<p>html body</p>", json.GetProperty("html").GetString());
        Assert.Equal("text body", json.GetProperty("text").GetString());
        var attachment = Assert.Single(json.GetProperty("attachments").EnumerateArray());
        Assert.Equal("invoice-INV-1.pdf", attachment.GetProperty("filename").GetString());
        Assert.Equal("%PDF-1.7", Encoding.ASCII.GetString(Convert.FromBase64String(attachment.GetProperty("content").GetString()!)));
        Assert.Equal(new[] { "attachments", "from", "html", "subject", "text", "to" }, json.EnumerateObject().Select(p => p.Name).Order());
    }

    [Fact]
    public async Task ApiSender_NoAttachments_SendsNoAttachmentsField()
    {
        var (sender, handler) = Api(HttpStatusCode.OK);
        await sender.SendAsync(Message());
        Assert.False(JsonDocument.Parse(Assert.Single(handler.Calls).Body).RootElement.TryGetProperty("attachments", out _));
    }

    [Theory]
    [InlineData("PAKO", "PAKO <no-reply@pako.test>")]
    [InlineData("", "no-reply@pako.test")]
    [InlineData("Pako, sh.p.k.", "\"Pako, sh.p.k.\" <no-reply@pako.test>")]
    [InlineData("Say \"hi\"", "\"Say \\\"hi\\\"\" <no-reply@pako.test>")]
    public void ApiSender_FromNameAndAddress(string name, string expected)
    {
        var options = ApiOptions();
        options.FromName = name;
        Assert.Equal(expected, ApiEmailSender.Sender(options));
    }

    [Fact]
    public void Options_ApiDefaultsToResend()
    {
        Assert.Equal("https://api.resend.com/emails", new EmailOptions().Api.Url);
        var resend = new EmailOptions { Mode = "Api", FromAddress = "no-reply@pako.test", AppBaseUrl = "https://app.pako.test" };
        resend.Api.ApiKey = "re_test";
        Assert.Empty(resend.Problems());
        resend.AppBaseUrl = "http://127.0.0.1:5180";
        Assert.Empty(resend.Problems());
    }

    [Fact]
    public async Task ApiSender_CustomKeyHeader()
    {
        var (sender, handler) = Api(HttpStatusCode.OK, ApiOptions(authHeader: "X-Api-Key"));
        await sender.SendAsync(Message());
        var request = Assert.Single(handler.Calls).Request;
        Assert.Null(request.Headers.Authorization);
        Assert.Equal("secret-key", Assert.Single(request.Headers.GetValues("X-Api-Key")));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, true)]
    [InlineData(HttpStatusCode.UnprocessableEntity, true)]
    [InlineData(HttpStatusCode.TooManyRequests, false)]
    [InlineData(HttpStatusCode.RequestTimeout, false)]
    [InlineData(HttpStatusCode.ServiceUnavailable, false)]
    public async Task ApiSender_RefusalsAreFinal_OutagesAreRetried(HttpStatusCode status, bool permanent)
    {
        var (sender, _) = Api(status, body: "{\"error\":\"why\"}");
        var error = await Assert.ThrowsAnyAsync<Exception>(() => sender.SendAsync(Message()));
        Assert.Equal(permanent, error is PermanentEmailFailure);
        Assert.Contains(((int)status).ToString(), error.Message);
        Assert.Contains("why", error.Message);
    }

    [Fact]
    public async Task ApiSender_NoAnswer_IsATemporaryTimeout()
    {
        var handler = new StubHandler(async _ =>
        {
            await Task.Delay(TimeSpan.FromSeconds(5));
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var sender = new ApiEmailSender(new HttpClient(handler), Options.Create(ApiOptions(timeout: 1)));
        await Assert.ThrowsAsync<TimeoutException>(() => sender.SendAsync(Message()));
    }

    // ---- Configuration ----

    [Fact]
    public void Options_LinksShowOnlyWhileMailIsLogged_AndARealModeMustBeUsable()
    {
        Assert.True(new EmailOptions().ShowLinksToAdmins);
        Assert.Empty(new EmailOptions().Problems());
        Assert.False(ApiOptions().ShowLinksToAdmins);
        Assert.False(new EmailOptions { Mode = "Smtp" }.ShowLinksToAdmins);
        Assert.Empty(ApiOptions().Problems());

        var broken = ApiOptions();
        broken.Api.Url = "http://mail.example.test/send";
        broken.Api.ApiKey = null;
        broken.FromAddress = "no-reply@pako.local";
        broken.AppBaseUrl = "http://app.pako.test";
        var problems = broken.Problems();
        Assert.Equal(4, problems.Count);
        Assert.Contains(problems, p => p.Contains("Email:Api:Url"));
        Assert.Contains(problems, p => p.Contains("Email:Api:ApiKey"));
        Assert.Contains(problems, p => p.Contains("Email:FromAddress"));
        Assert.Contains(problems, p => p.Contains("Email:AppBaseUrl"));
        Assert.Contains(new EmailOptions { Mode = "Carrier pigeon" }.Problems(), p => p.Contains("not Log, Smtp or Api"));
    }

    // ---- Dispatcher ----

    private sealed class ScriptedSender : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = new();
        public Exception? FailWith { get; set; }

        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
        {
            if (FailWith is not null) throw FailWith;
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private static NotificationDispatcher Dispatcher(PakoDbContext db, IEmailSender sender, int maxAttachmentBytes = 10 * 1024 * 1024) =>
        new(db, sender, new NotificationRenderer(Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" })),
            new PayslipDocumentService(db), NullLogger<NotificationDispatcher>.Instance,
            new InvoiceDocumentService(db, Tax), Options.Create(new EmailOptions { MaxAttachmentBytes = maxAttachmentBytes }));

    [Fact]
    public async Task Dispatcher_ARefusedMessageFailsAtOnce_AnOutageWaitsForTheNextAttempt()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var outbox = new NotificationOutbox(db);
        await outbox.EnqueueAsync(null, NotificationTemplates.TestEmail, new[] { new NotificationRecipient("bad@x.test", "en") },
            new Dictionary<string, string> { ["company"] = "PAKO", ["mode"] = "Api" });
        await db.SaveChangesAsync();

        var sender = new ScriptedSender { FailWith = new HttpRequestException("Email API answered 503") };
        Assert.Equal(0, await Dispatcher(db, sender).DeliverDueAsync(DateTime.UtcNow));
        var row = await db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal((NotificationState.Pending, 1), (row.State, row.Attempts));

        sender.FailWith = new PermanentEmailFailure("Email API answered 422: mailbox does not exist");
        Assert.Equal(0, await Dispatcher(db, sender).DeliverDueAsync(DateTime.UtcNow.AddHours(1)));
        row = await db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal((NotificationState.Failed, 2), (row.State, row.Attempts));
        Assert.Contains("mailbox does not exist", row.LastError);
    }

    // ---- Invoices by email ----

    private sealed record Co(PakoDbContext Db, Guid Id, Guid UserId, Guid Customer, Guid NoEmailCustomer, Guid S18);

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth")),
            },
        };
        return controller;
    }

    // Client request 2026-11-24: "Print selected" — several invoices in one PDF, and no more than 100.
    [Fact]
    public async Task PdfBatch_PutsTheChosenInvoicesInOnePdf_AndRefusesAnEmptyOrForeignSelection()
    {
        var c = await SeedAsync();
        var first = await InvoiceAsync(c, c.Customer);
        var second = await InvoiceAsync(c, c.NoEmailCustomer);
        var batch = new InvoicePdfBatchController(c.Db, new InvoiceDocumentService(c.Db, Tax), CompanyAccessContext.Unrestricted(c.Id, c.UserId), L);

        var file = Assert.IsType<FileContentResult>(await batch.Pdf(c.Id, new InvoicePdfBatchRequest([first.Id, second.Id])));
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(file.FileContents, 0, 4));
        var single = Assert.IsType<FileContentResult>(await Delivery(c).Pdf(c.Id, first.Id));
        Assert.True(file.FileContents.Length > single.FileContents.Length);

        Assert.IsType<BadRequestObjectResult>(await batch.Pdf(c.Id, new InvoicePdfBatchRequest([])));
        Assert.IsType<NotFoundResult>(await batch.Pdf(c.Id, new InvoicePdfBatchRequest([first.Id, Guid.NewGuid()])));
    }

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddDataProtection();
        services.AddIdentityCore<AppUser>(o => o.User.RequireUniqueEmail = true).AddEntityFrameworkStores<PakoDbContext>().AddDefaultTokenProviders();
        var users = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();
        var owner = new AppUser { Id = Guid.NewGuid(), Email = "owner@co.test", UserName = "owner@co.test", CompanyLimit = null };
        await users.CreateAsync(owner, "Email-Test-1!");
        var created = await As(new CompaniesController(db, L), owner.Id).Create(new CreateCompanyRequest("Coffee Wholesale"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var s18 = (await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == companyId && t.Code == "S18")).Id;
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Bar Prishtina", IsCustomer = true, Email = "books@bar.test", FiscalNumber = "811000101" };
        var noEmail = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Cafe Prizren", IsCustomer = true, FiscalNumber = "811000102" };
        db.Partners.AddRange(customer, noEmail);
        await db.SaveChangesAsync();
        return new Co(db, companyId, owner.Id, customer.Id, noEmail.Id, s18);
    }

    private static InvoicesController Invoices(Co c) =>
        As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted(c.Id, c.UserId)), c.UserId);

    private static InvoiceDeliveryController Delivery(Co c) =>
        As(new InvoiceDeliveryController(c.Db, new InvoiceDocumentService(c.Db, Tax), new NotificationOutbox(c.Db),
            CompanyAccessContext.Unrestricted(c.Id, c.UserId), L), c.UserId);

    // 2 × 50.00 with 10% off, VAT 18% included (the company default): 90.00 to pay.
    private static async Task<InvoiceResponse> InvoiceAsync(Co c, Guid partnerId, bool post = true)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var created = await Invoices(c).Create(c.Id, new CreateInvoiceRequest(partnerId, today, today.AddDays(15),
            new List<CreateInvoiceLineRequest> { new("Espresso beans", 2m, 50m, c.S18, null, 10m) }));
        var invoice = (InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        if (!post) return invoice;
        var posted = await Invoices(c).Post(c.Id, invoice.Id);
        if (posted.Result is BadRequestObjectResult refused) Assert.Fail($"Post refused: {JsonSerializer.Serialize(refused.Value)}");
        return (InvoiceResponse)Assert.IsType<OkObjectResult>(posted.Result).Value!;
    }

    private static string PdfName(InvoiceResponse invoice) => $"invoice-{invoice.InvoiceNumber!.Replace('/', '-')}.pdf";

    private static string BadRequestText(IActionResult? result) => (string)Assert.IsType<BadRequestObjectResult>(result).Value!;

    // A job run has its own scope; the dispatcher must not share the request's tracked rows.
    private NotificationDispatcher DispatcherFor(Co c, IEmailSender sender, int maxAttachmentBytes = 10 * 1024 * 1024)
    {
        var db = PostgresTestDatabase.CreateAdditionalContext(c.Db);
        _contexts.Add(db);
        return Dispatcher(db, sender, maxAttachmentBytes);
    }

    [Fact]
    public async Task InvoiceDocument_HasTheSameAmountsAsTheInvoiceScreen()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.Customer);
        var shown = (InvoiceResponse)Assert.IsType<OkObjectResult>((await Invoices(c).Get(c.Id, invoice.Id)).Result).Value!;
        var document = (await new InvoiceDocumentService(c.Db, Tax).LoadAsync(c.Id, invoice.Id))!;

        Assert.Equal((shown.Totals!.AmountBeforeDiscount, shown.Totals.DiscountAmount, shown.Totals.NetAmount, shown.Totals.TaxAmount, shown.Totals.GrossAmount),
            (document.Totals.AmountBeforeDiscount, document.Totals.DiscountAmount, document.Totals.NetAmount, document.Totals.TaxAmount, document.Totals.GrossAmount));
        Assert.Equal((100m, 10m, 90m), (document.Totals.AmountBeforeDiscount, document.Totals.DiscountAmount, document.Totals.GrossAmount));
        Assert.Equal(document.Totals.GrossAmount, document.Totals.NetAmount + document.Totals.TaxAmount);
        var vat = Assert.Single(document.Taxes);
        Assert.Equal(shown.TaxBreakdown!.Single().TaxAmount, vat.Tax);
        Assert.Equal(("Bar Prishtina", "books@bar.test", "Coffee Wholesale"), (document.Customer.Name, document.Customer.Email, document.Company.Name));
        Assert.Null(await new InvoiceDocumentService(c.Db, Tax).LoadAsync(Guid.NewGuid(), invoice.Id));
    }

    // Client request 2026-11-23 (print redesign): the buyer block carries the partner's full address
    // and contact, the line its unit price on both bases, the VAT table its base and total.
    [Fact]
    public async Task InvoiceDocument_CarriesTheBuyersAddressAndContact_AndUnitPricesOnBothBases()
    {
        var c = await SeedAsync();
        var customer = await c.Db.Partners.SingleAsync(p => p.Id == c.Customer);
        (customer.City, customer.PostalCode, customer.Country, customer.Phone, customer.ContactPerson) = ("Prishtinë", "10000", "Kosovë", "+383 44 111 222", "Arben");
        await c.Db.SaveChangesAsync();
        var invoice = await InvoiceAsync(c, c.Customer);

        var document = (await new InvoiceDocumentService(c.Db, Tax).LoadAsync(c.Id, invoice.Id))!;

        Assert.Equal(("Prishtinë", "10000", "Kosovë", "+383 44 111 222", "Arben"),
            (document.Customer.City, document.Customer.PostalCode, document.Customer.Country, document.Customer.Phone, document.Customer.ContactPerson));
        var line = Assert.Single(document.Lines);
        Assert.True(line.Amounts.UnitPriceGross > line.Amounts.UnitPriceNet);
        var vat = Assert.Single(document.Taxes);
        Assert.Equal(document.Totals.GrossAmount, vat.Gross);
    }

    [Fact]
    public void InvoicePdf_ALongInvoiceWithFullPartyData_RendersOverSeveralPages()
    {
        var amounts = new DocumentLineAmounts(118m, 11.8m, 90m, 16.2m, 106.2m, 100m, 118m);
        var lines = Enumerable.Range(1, 60).Select(i => new InvoiceDocumentLine(
            $"Artikull me përshkrim të gjatë numër {i} që thyhet në dy rreshta", 1.5m, "copë", 118m, 10m, "18%", amounts, (1000 + i).ToString())).ToList();
        var total = DocumentLineAmounts.Sum(lines.Select(l => l.Amounts));
        var document = new InvoiceDocument(Guid.NewGuid(), Guid.NewGuid(), DocumentType.Invoice, InvoiceState.Posted, "INV-0042",
            new DateOnly(2026, 11, 23), new DateOnly(2026, 12, 23), 30, "EUR", null, "Faleminderit",
            new InvoiceDocumentCompany("Coffee Wholesale", "330000001", "811000001", "70000001", "Rr. Nëna Terezë 1", "Prishtinë", "Kosovë",
                "+383 44 000 000", "info@coffee.test", "TEB", "XK05 1212 0123 4567 8906", null, "Faleminderit për bashkëpunimin", null,
                LegalName: "Coffee Wholesale Group", LegalForm: "SH.P.K.", PostalCode: "10000", Website: "coffee.test"),
            new InvoiceDocumentCustomer(Guid.NewGuid(), "Bar Prishtina", "811000101", null, "Rr. Agim Ramadani 5", "books@bar.test", "330000002",
                "Prishtinë", "10000", "Kosovë", "+383 44 111 222", "Arben Krasniqi", true),
            lines, total, new[] { new InvoiceDocumentTax("TVSH 18%", 0.18m, total.NetAmount, total.TaxAmount, total.GrossAmount) });

        var pdf = InvoicePdfRenderer.Render(document, key => NotificationRenderer.Text(key, "sq"), System.Globalization.CultureInfo.GetCultureInfo("sq"));

        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdf, 0, 4));
        if (Environment.GetEnvironmentVariable("PAKO_PDF_SAMPLE") is { Length: > 0 } path) File.WriteAllBytes(path, pdf);
    }

    [Fact]
    public async Task InvoicePdf_DownloadsAsAPdfNamedByItsNumber()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.Customer);
        var file = Assert.IsType<FileContentResult>(await Delivery(c).Pdf(c.Id, invoice.Id));
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal(PdfName(invoice), file.FileDownloadName);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(file.FileContents, 0, 4));
        Assert.IsType<NotFoundResult>(await Delivery(c).Pdf(c.Id, Guid.NewGuid()));
    }

    [Theory]
    [InlineData(DocumentType.Invoice, true)]
    [InlineData(DocumentType.CreditNote, false)]
    [InlineData(DocumentType.SalesReturn, true)]
    [InlineData(DocumentType.DebitNote, false)]
    [InlineData(DocumentType.Proforma, false)]
    public void InvoicePdf_RendersEveryDocumentKind_WithOrWithoutDiscount(DocumentType type, bool discount)
    {
        var amounts = discount ? new DocumentLineAmounts(100m, 10m, 90m, 16.2m, 106.2m) : new DocumentLineAmounts(100m, 0m, 100m, 18m, 118m);
        var document = new InvoiceDocument(Guid.NewGuid(), Guid.NewGuid(), type, InvoiceState.Posted, "DOC-0001",
            new DateOnly(2026, 11, 19), new DateOnly(2026, 12, 4), 15, "EUR", type == DocumentType.Invoice ? null : "INV-0001", "Thank you",
            new InvoiceDocumentCompany("Coffee Wholesale", "330000001", "811000001", "70000001", "Rr. Nëna Terezë 1", "Prishtinë", "Kosovë",
                "+383 44 000 000", "info@coffee.test", "TEB", "XK05 1212 0123 4567 8906", "Pay within 15 days", "Thank you for your business", null),
            new InvoiceDocumentCustomer(Guid.NewGuid(), "Bar Prishtina", "330000002", "811000101", "Rr. Agim Ramadani 5", "books@bar.test"),
            new[] { new InvoiceDocumentLine("Espresso beans 1kg", 2m, "kg", 50m, discount ? 10m : 0m, "18%", amounts) },
            amounts, new[] { new InvoiceDocumentTax("TVSH 18%", 0.18m, amounts.NetAmount, amounts.TaxAmount) });

        var pdf = InvoicePdfRenderer.Render(document, key => NotificationRenderer.Text(key, "sq"), System.Globalization.CultureInfo.GetCultureInfo("sq"));
        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdf, 0, 4));
        Assert.EndsWith("-DOC-0001.pdf", InvoicePdfRenderer.FileName(document));

        // Same document, same bytes: a retry repeats the request under the same Idempotency-Key.
        var again = InvoicePdfRenderer.Render(document, key => NotificationRenderer.Text(key, "sq"), System.Globalization.CultureInfo.GetCultureInfo("sq"));
        Assert.Equal(pdf, again);
    }

    [Fact]
    public async Task EmailInvoice_GoesToTheCustomerWithItsPdf_InTheEmailsLanguage()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.Customer);

        var queued = (List<InvoiceEmailResponse>)Assert.IsType<OkObjectResult>(
            (await Delivery(c).Email(c.Id, invoice.Id, new EmailInvoiceRequest(Message: "Thanks for the order."))).Result).Value!;
        var email = Assert.Single(queued);
        Assert.Equal(("books@bar.test", "Pending"), (email.Recipient, email.State));
        var row = await c.Db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal((NotificationTemplates.InvoiceSent, NotificationAttachments.Invoice, (Guid?)invoice.Id, "sq"),
            (row.Template, row.AttachmentKind, row.AttachmentRefId, row.Culture));
        Assert.True(await c.Db.AuditEntries.AnyAsync(a => a.EntityId == invoice.Id.ToString() && a.Action == "Email"));

        var sender = new ScriptedSender();
        Assert.Equal(1, await DispatcherFor(c, sender).DeliverDueAsync(DateTime.UtcNow));
        var sent = Assert.Single(sender.Sent);
        Assert.Equal($"Coffee Wholesale: Faturë {invoice.InvoiceNumber}", sent.Subject);
        Assert.Contains("Thanks for the order.", sent.TextBody);
        Assert.Contains("90,00 EUR", sent.TextBody);
        var pdf = Assert.Single(sent.Attachments);
        Assert.Equal((PdfName(invoice), "application/pdf"), (pdf.FileName, pdf.ContentType));
        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdf.Content, 0, 4));
        Assert.Equal(row.Id.ToString("N"), sent.MessageId);

        var history = (List<InvoiceEmailResponse>)Assert.IsType<OkObjectResult>((await Delivery(c).Emails(c.Id, invoice.Id)).Result).Value!;
        Assert.Equal("Sent", Assert.Single(history).State);
    }

    [Fact]
    public async Task EmailInvoice_TypedAddressesInEnglish()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.NoEmailCustomer);
        var queued = (List<InvoiceEmailResponse>)Assert.IsType<OkObjectResult>((await Delivery(c).Email(c.Id, invoice.Id,
            new EmailInvoiceRequest(new List<string> { "a@cafe.test", " A@cafe.test ", "b@cafe.test" }, Culture: "en"))).Result).Value!;
        Assert.Equal(new[] { "a@cafe.test", "b@cafe.test" }, queued.Select(q => q.Recipient));
        Assert.All(await c.Db.Notifications.AsNoTracking().ToListAsync(), n => Assert.Equal("en", n.Culture));

        var sender = new ScriptedSender();
        await DispatcherFor(c, sender).DeliverDueAsync(DateTime.UtcNow);
        Assert.All(sender.Sent, m => Assert.Equal($"Coffee Wholesale: Invoice {invoice.InvoiceNumber}", m.Subject));
    }

    [Fact]
    public async Task EmailInvoice_RefusesDraftsMissingOrBadAddressesAndOtherCompanies()
    {
        var c = await SeedAsync();
        var draft = await InvoiceAsync(c, c.Customer, post: false);
        Assert.Equal("Only a posted document can be emailed. Post it first, then send it.",
            BadRequestText((await Delivery(c).Email(c.Id, draft.Id, new EmailInvoiceRequest())).Result));

        var noEmail = await InvoiceAsync(c, c.NoEmailCustomer);
        Assert.Equal("Cafe Prizren has no email address. Add one to the customer, or type the address to send to.",
            BadRequestText((await Delivery(c).Email(c.Id, noEmail.Id, new EmailInvoiceRequest())).Result));
        Assert.Equal("\"not-an-address\" is not a valid email address.",
            BadRequestText((await Delivery(c).Email(c.Id, noEmail.Id, new EmailInvoiceRequest(new List<string> { "not-an-address" }))).Result));
        Assert.Equal("Send to at most 5 addresses at a time.",
            BadRequestText((await Delivery(c).Email(c.Id, noEmail.Id,
                new EmailInvoiceRequest(Enumerable.Range(1, 6).Select(i => $"x{i}@cafe.test").ToList()))).Result));
        Assert.Equal("The message can be at most 2000 characters.",
            BadRequestText((await Delivery(c).Email(c.Id, noEmail.Id,
                new EmailInvoiceRequest(new List<string> { "a@cafe.test" }, new string('x', 2001)))).Result));

        Assert.IsType<NotFoundResult>((await Delivery(c).Email(Guid.NewGuid(), noEmail.Id, new EmailInvoiceRequest())).Result);
        Assert.Empty(await c.Db.Notifications.ToListAsync());
    }

    [Fact]
    public async Task EmailInvoice_AFailedEmailCanBeRetriedFromTheInvoice()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.Customer);
        await Delivery(c).Email(c.Id, invoice.Id, new EmailInvoiceRequest());
        await DispatcherFor(c, new ScriptedSender { FailWith = new PermanentEmailFailure("Email API answered 422: rejected") })
            .DeliverDueAsync(DateTime.UtcNow);
        var failed = Assert.Single((List<InvoiceEmailResponse>)Assert.IsType<OkObjectResult>((await Delivery(c).Emails(c.Id, invoice.Id)).Result).Value!);
        Assert.Equal(("Failed", "Email API answered 422: rejected"), (failed.State, failed.LastError));

        var retried = (InvoiceEmailResponse)Assert.IsType<OkObjectResult>((await Delivery(c).Retry(c.Id, invoice.Id, failed.Id)).Result).Value!;
        Assert.Equal(("Pending", (string?)null), (retried.State, retried.LastError));
        Assert.Equal(1, await DispatcherFor(c, new ScriptedSender()).DeliverDueAsync(DateTime.UtcNow));
        Assert.IsType<NotFoundResult>((await Delivery(c).Retry(c.Id, invoice.Id, Guid.NewGuid())).Result);
    }

    [Fact]
    public async Task EmailInvoice_AnOversizedPdfFailsForGood()
    {
        var c = await SeedAsync();
        var invoice = await InvoiceAsync(c, c.Customer);
        await Delivery(c).Email(c.Id, invoice.Id, new EmailInvoiceRequest());
        var sender = new ScriptedSender();
        Assert.Equal(0, await DispatcherFor(c, sender, maxAttachmentBytes: 100).DeliverDueAsync(DateTime.UtcNow));
        Assert.Empty(sender.Sent);
        var row = await c.Db.Notifications.AsNoTracking().SingleAsync();
        Assert.Equal(NotificationState.Failed, row.State);
        Assert.StartsWith("Attachments exceed", row.LastError);
    }

    // ---- Test email ----

    private EmailTestController TestEmail(Co c, IEmailSender sender, string mode = EmailOptions.ApiMode) =>
        As(new EmailTestController(c.Db, sender, new NotificationRenderer(Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" })),
            Options.Create(new EmailOptions { Mode = mode }), L, NullLogger<EmailTestController>.Instance), c.UserId);

    [Fact]
    public async Task TestEmail_GoesToTheAdminAtOnce_AndReportsTheProvidersAnswer()
    {
        var c = await SeedAsync();
        var sender = new ScriptedSender();
        var ok = (TestEmailResponse)Assert.IsType<OkObjectResult>((await TestEmail(c, sender).CompanyTest(c.Id)).Result).Value!;
        Assert.Equal(("owner@co.test", true, "Api", (string?)null), (ok.Recipient, ok.Sent, ok.Mode, ok.Error));
        var mail = Assert.Single(sender.Sent);
        Assert.Contains("Coffee Wholesale", mail.TextBody);
        Assert.Empty(await c.Db.Notifications.ToListAsync());

        var refused = (TestEmailResponse)Assert.IsType<OkObjectResult>((await TestEmail(c, new ScriptedSender
        {
            FailWith = new PermanentEmailFailure("Email API answered 401: bad key"),
        }).CompanyTest(c.Id)).Result).Value!;
        Assert.Equal((false, "Email API answered 401: bad key"), (refused.Sent, refused.Error));

        var platform = (TestEmailResponse)Assert.IsType<OkObjectResult>(
            (await TestEmail(c, sender).PlatformTest(new SendTestEmailRequest("ops@pako.test"))).Result).Value!;
        Assert.Equal(("ops@pako.test", true), (platform.Recipient, platform.Sent));
        Assert.IsType<BadRequestObjectResult>((await TestEmail(c, sender).PlatformTest(new SendTestEmailRequest("nope"))).Result);
    }
}
