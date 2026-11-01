using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P2: promotions, coupons and loyalty programs, loyalty cards and gift cards.
// Pos: Read sees them; Approve sets up programs; Write issues loyalty cards at the till.
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosProgramsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosProgramsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    // ---- Programs ----

    [HttpGet("programs", Name = "ListPosPrograms")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<ProgramResponse>>> Programs(Guid companyId)
    {
        var programs = await _db.PosPrograms.AsNoTracking().Include(p => p.Targets).Where(p => p.CompanyId == companyId)
            .OrderBy(p => p.Kind).ThenBy(p => p.Priority).ThenBy(p => p.Name).ToListAsync();
        return Ok(programs.Select(ToResponse).ToList());
    }

    [HttpPost("programs", Name = "CreatePosProgram")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(ProgramResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ProgramResponse>> CreateProgram(Guid companyId, SaveProgramRequest request)
    {
        var program = new PosProgram { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, program, request) is { } error) return BadRequest(error);
        _db.PosPrograms.Add(program);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(program));
    }

    [HttpPut("programs/{programId:guid}", Name = "UpdatePosProgram")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<ProgramResponse>> UpdateProgram(Guid companyId, Guid programId, SaveProgramRequest request)
    {
        var program = await _db.PosPrograms.Include(p => p.Targets).FirstOrDefaultAsync(p => p.Id == programId && p.CompanyId == companyId);
        if (program is null) return NotFound();
        if (await ApplyAsync(companyId, program, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(program));
    }

    private async Task<string?> ApplyAsync(Guid companyId, PosProgram p, SaveProgramRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return _localizer["PosProgramNameRequired"].Value;
        var code = string.IsNullOrWhiteSpace(r.Code) ? null : r.Code.Trim().ToUpperInvariant();
        if (r.Kind == ProgramKind.Coupon && code is null) return _localizer["PosProgramCodeRequired"].Value;
        if (code is not null && await _db.PosPrograms.AnyAsync(x => x.CompanyId == companyId && x.Code == code && x.Id != p.Id))
        {
            return _localizer["PosProgramCodeTaken"].Value;
        }
        if (r.ValidFrom is { } from && r.ValidTo is { } to && to < from) return _localizer["PosProgramDatesInvalid"].Value;
        if (r.Days is < 0 or > 127 || (r.TimeFrom is null) != (r.TimeTo is null)) return _localizer["PosProgramDatesInvalid"].Value;
        if (r.Kind == ProgramKind.Loyalty)
        {
            if (r.PointsPerEuro is not > 0 || r.PointValue is not > 0) return _localizer["PosProgramRewardInvalid"].Value;
            if (r.IsActive && await _db.PosPrograms.AnyAsync(x => x.CompanyId == companyId && x.Kind == ProgramKind.Loyalty && x.IsActive && x.Id != p.Id))
            {
                return _localizer["PosLoyaltyProgramExists"].Value;
            }
        }
        else
        {
            var valid = r.Reward switch
            {
                ProgramRewardKind.PercentOff => r.Percent is > 0 and <= 100,
                ProgramRewardKind.AmountOff => r.Amount is > 0,
                ProgramRewardKind.FixedPrice => r.Price is >= 0,
                ProgramRewardKind.BuyXGetY => r.BuyQuantity is > 0 && r.GetQuantity is > 0,
                ProgramRewardKind.MultiBuy => r.BuyQuantity is > 1 && r.Price is >= 0,
                ProgramRewardKind.BasketDiscount => (r.Percent is > 0 and <= 100) != (r.Amount is > 0),
                _ => false,
            };
            if (!valid) return _localizer["PosProgramRewardInvalid"].Value;
        }
        if (r.StoreId is { } store && !await _db.PosStores.AnyAsync(s => s.Id == store && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        var itemIds = (r.ItemIds ?? new()).Distinct().ToList();
        var categoryIds = (r.CategoryIds ?? new()).Distinct().ToList();
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count
            || await _db.ItemCategories.CountAsync(c => c.CompanyId == companyId && categoryIds.Contains(c.Id)) != categoryIds.Count)
        {
            return _localizer["PosItemNotFound"].Value;
        }

        p.Name = r.Name.Trim();
        p.Kind = r.Kind;
        p.Reward = r.Kind == ProgramKind.Loyalty ? ProgramRewardKind.BasketDiscount : r.Reward;
        p.IsActive = r.IsActive;
        (p.ValidFrom, p.ValidTo, p.Days, p.TimeFrom, p.TimeTo, p.StoreId) = (r.ValidFrom, r.ValidTo, r.Days, r.TimeFrom, r.TimeTo, r.StoreId);
        (p.Priority, p.Stackable, p.Code, p.MaxUses) = (r.Priority, r.Stackable, code, r.MaxUses);
        (p.MinQuantity, p.MinAmount, p.Percent, p.Amount, p.Price) = (r.MinQuantity, r.MinAmount, r.Percent, r.Amount, r.Price);
        (p.BuyQuantity, p.GetQuantity, p.PointsPerEuro, p.PointValue) = (r.BuyQuantity, r.GetQuantity, r.PointsPerEuro, r.PointValue);
        // Targets are replaced as a whole.
        _db.PosProgramTargets.RemoveRange(p.Targets);
        p.Targets = itemIds.Select(i => new PosProgramTarget { Id = Guid.NewGuid(), ProgramId = p.Id, ItemId = i })
            .Concat(categoryIds.Select(c => new PosProgramTarget { Id = Guid.NewGuid(), ProgramId = p.Id, CategoryId = c })).ToList();
        _db.PosProgramTargets.AddRange(p.Targets);
        return null;
    }

    private static ProgramResponse ToResponse(PosProgram p) => new(p.Id, p.Name, p.Kind, p.Reward, p.IsActive, p.ValidFrom, p.ValidTo, p.Days,
        p.TimeFrom, p.TimeTo, p.StoreId, p.Priority, p.Stackable, p.Code, p.MaxUses, p.Uses, p.MinQuantity, p.MinAmount, p.Percent, p.Amount,
        p.Price, p.BuyQuantity, p.GetQuantity, p.PointsPerEuro, p.PointValue,
        p.Targets.Where(t => t.ItemId != null).Select(t => t.ItemId!.Value).ToList(),
        p.Targets.Where(t => t.CategoryId != null).Select(t => t.CategoryId!.Value).ToList());

    // ---- Loyalty cards ----

    [HttpGet("loyalty-cards", Name = "ListLoyaltyCards")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<LoyaltyCardResponse>>> LoyaltyCards(Guid companyId, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.LoyaltyCards.AsNoTracking().Where(c => c.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(c => EF.Functions.ILike(c.Number, term) || EF.Functions.ILike(c.HolderName ?? "", term) || EF.Functions.ILike(c.Phone ?? "", term));
        }
        var total = await query.CountAsync();
        var items = await query.OrderBy(c => c.Number).Skip((page - 1) * pageSize).Take(pageSize).Select(c => ToResponse(c)).ToListAsync();
        return Ok(new PaginatedResponse<LoyaltyCardResponse>(items, total, page, pageSize));
    }

    // Issued at the till (Pos: Write); an empty number gets a new one.
    [HttpPost("loyalty-cards", Name = "CreateLoyaltyCard")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(LoyaltyCardResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<LoyaltyCardResponse>> CreateLoyaltyCard(Guid companyId, SaveLoyaltyCardRequest request)
    {
        var number = string.IsNullOrWhiteSpace(request.Number) ? NewNumber() : request.Number.Trim();
        if (await _db.LoyaltyCards.AnyAsync(c => c.CompanyId == companyId && c.Number == number)) return BadRequest(_localizer["PosCardNumberTaken"].Value);
        if (request.PartnerId is { } partner && !await _db.Partners.AnyAsync(p => p.Id == partner && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["PosCustomerNotFound"].Value);
        }
        var card = new LoyaltyCard
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Number = number, HolderName = Blank(request.HolderName), Phone = Blank(request.Phone),
            PartnerId = request.PartnerId, IsActive = request.IsActive,
        };
        _db.LoyaltyCards.Add(card);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(card));
    }

    [HttpPut("loyalty-cards/{cardId:guid}", Name = "UpdateLoyaltyCard")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<LoyaltyCardResponse>> UpdateLoyaltyCard(Guid companyId, Guid cardId, SaveLoyaltyCardRequest request)
    {
        var card = await _db.LoyaltyCards.FirstOrDefaultAsync(c => c.Id == cardId && c.CompanyId == companyId);
        if (card is null) return NotFound();
        if (request.PartnerId is { } partner && !await _db.Partners.AnyAsync(p => p.Id == partner && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["PosCustomerNotFound"].Value);
        }
        (card.HolderName, card.Phone, card.PartnerId, card.IsActive) = (Blank(request.HolderName), Blank(request.Phone), request.PartnerId, request.IsActive);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(card));
    }

    private static LoyaltyCardResponse ToResponse(LoyaltyCard c) => new(c.Id, c.Number, c.HolderName, c.Phone, c.PartnerId, c.Points, c.IsActive);

    // ---- Gift cards and store credit ----

    [HttpGet("gift-cards", Name = "ListGiftCards")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<GiftCardResponse>>> GiftCards(Guid companyId, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.GiftCards.AsNoTracking().Where(c => c.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(c => EF.Functions.ILike(c.Number, $"%{search.Trim()}%"));
        var total = await query.CountAsync();
        var cards = await query.OrderByDescending(c => c.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<GiftCardResponse>(cards.Select(c => ToResponse(c, new())).ToList(), total, page, pageSize));
    }

    // The balance check at the till, with the card's history.
    [HttpGet("gift-cards/{number}", Name = "GetGiftCard")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<GiftCardResponse>> GiftCard(Guid companyId, string number)
    {
        var card = await _db.GiftCards.AsNoTracking().FirstOrDefaultAsync(c => c.CompanyId == companyId && c.Number == number.Trim());
        if (card is null) return NotFound();
        var movements = await (from m in _db.GiftCardMovements.AsNoTracking()
                               join o in _db.PosOrders.AsNoTracking() on m.OrderId equals o.Id into orders
                               from o in orders.DefaultIfEmpty()
                               where m.GiftCardId == card.Id
                               orderby m.At
                               select new GiftCardMovementResponse(m.OrderId, o != null ? o.Number : null, m.Amount, m.At)).ToListAsync();
        return Ok(ToResponse(card, movements));
    }

    private static GiftCardResponse ToResponse(GiftCard c, List<GiftCardMovementResponse> movements) =>
        new(c.Id, c.Number, c.Kind, c.Balance, c.ExpiresOn, c.IsActive, c.CreatedAt, movements);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string NewNumber() => string.Concat(Enumerable.Range(0, 12).Select(_ => (char)('0' + RandomNumberGenerator.GetInt32(10))));
}
