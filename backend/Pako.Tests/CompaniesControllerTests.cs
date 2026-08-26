using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Infrastructure;

namespace Pako.Tests;

public class CompaniesControllerTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static CompaniesController NewController(PakoDbContext db, Guid userId)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"));

        return new CompaniesController(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    [Fact]
    public async Task Create_RejectsNameOver256Characters()
    {
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest(new string('A', 257)));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name must be 256 characters or fewer.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_RejectsWhitespaceOnlyName()
    {
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("   "));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Company name is required.", badRequest.Value);
        Assert.Empty(db.Companies);
    }

    [Fact]
    public async Task Create_AcceptsUnicodeAlbanianCharacters()
    {
        var db = NewContext();
        var controller = NewController(db, Guid.NewGuid());

        var result = await controller.Create(new CreateCompanyRequest("Shoqëria Çelniku Sh.p.k."));

        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Shoqëria Çelniku Sh.p.k.", created.Name);
    }
}
