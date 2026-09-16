using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Attachments;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection.
public class AttachmentsControllerTests : IAsyncLifetime
{
    private static readonly Guid TestUserId = Guid.NewGuid();
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

    private static AttachmentsController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, TestUserId.ToString()) }, "TestAuth"));

        return new AttachmentsController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private static IFormFile MakeFormFile(int sizeBytes = 12, string fileName = "receipt.pdf", string contentType = "application/pdf")
    {
        var bytes = sizeBytes <= 12
            ? Encoding.UTF8.GetBytes("hello world!"[..sizeBytes])
            : new byte[sizeBytes];
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName) { Headers = new HeaderDictionary(), ContentType = contentType };
    }

    private static UploadAttachmentRequest MakeUploadRequest(Guid ownerId, string ownerType = "Partner", IFormFile? file = null) =>
        new() { OwnerType = ownerType, OwnerId = ownerId, File = file ?? MakeFormFile() };

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId)> SeedAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Acme", IsCustomer = true };
        db.Companies.Add(company);
        db.Partners.Add(partner);
        await db.SaveChangesAsync();
        return (db, company.Id, partner.Id);
    }

    [Fact]
    public async Task Upload_Succeeds_ReturnsMetadataOnly()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Upload(companyId, MakeUploadRequest(partnerId));

        var created = Assert.IsType<AttachmentResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("receipt.pdf", created.FileName);
        Assert.Equal("application/pdf", created.ContentType);
        Assert.Equal("Partner", created.OwnerType);
        Assert.Equal(partnerId, created.OwnerId);
        Assert.Equal(12, created.SizeBytes);
    }

    [Fact]
    public async Task Upload_InvalidOwnerType_Rejected()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Upload(companyId, MakeUploadRequest(partnerId, ownerType: "NotARealOwnerType"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upload_OwnerNotInCompany_Rejected()
    {
        var (db, companyId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Upload(companyId, MakeUploadRequest(Guid.NewGuid()));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upload_EmptyFile_Rejected()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Upload(companyId, MakeUploadRequest(partnerId, file: MakeFormFile(sizeBytes: 0)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Upload_FileOverSizeLimit_Rejected()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Upload(companyId, MakeUploadRequest(partnerId, file: MakeFormFile(sizeBytes: 21 * 1024 * 1024)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task List_ReturnsOnlyAttachmentsForThatOwner()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var otherPartnerId = Guid.NewGuid();
        db.Partners.Add(new Partner { Id = otherPartnerId, CompanyId = companyId, Name = "Other Co", IsCustomer = true });
        await db.SaveChangesAsync();
        var controller = NewController(db);
        await controller.Upload(companyId, MakeUploadRequest(partnerId, file: MakeFormFile(fileName: "a.pdf")));
        await controller.Upload(companyId, MakeUploadRequest(otherPartnerId, file: MakeFormFile(fileName: "b.pdf")));

        var result = await controller.List(companyId, AttachmentOwnerType.Partner, partnerId);

        var list = Assert.IsType<List<AttachmentResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var item = Assert.Single(list);
        Assert.Equal("a.pdf", item.FileName);
    }

    [Fact]
    public async Task Download_ReturnsOriginalBytesAndContentType()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);
        var uploadResult = await controller.Upload(companyId, MakeUploadRequest(partnerId));
        var uploaded = Assert.IsType<AttachmentResponse>(Assert.IsType<ObjectResult>(uploadResult.Result).Value);

        var result = await controller.Download(companyId, uploaded.Id);

        var fileResult = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", fileResult.ContentType);
        Assert.Equal("hello world!", Encoding.UTF8.GetString(fileResult.FileContents));
    }

    [Fact]
    public async Task Delete_RemovesAttachment()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = NewController(db);
        var uploadResult = await controller.Upload(companyId, MakeUploadRequest(partnerId));
        var uploaded = Assert.IsType<AttachmentResponse>(Assert.IsType<ObjectResult>(uploadResult.Result).Value);

        var deleteResult = await controller.Delete(companyId, uploaded.Id);

        Assert.IsType<NoContentResult>(deleteResult);
        var downloadResult = await controller.Download(companyId, uploaded.Id);
        Assert.IsType<NotFoundResult>(downloadResult);
    }
}
