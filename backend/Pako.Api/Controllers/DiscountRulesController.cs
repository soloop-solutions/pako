using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Client feedback 2026-11: a discount percentage for a period, aimed at a customer, an item category,
// an item, or a combination. PriceListService.ResolveAsync hands the matching rule's percentage to
// invoice and sales-order lines as their starting rabat (DiscountRuleMatcher picks the rule).
[ApiController]
[Route("api/companies/{companyId:guid}/discount-rules")]
[Authorize]
public class DiscountRulesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public DiscountRulesController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet(Name = "ListDiscountRules")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<DiscountRuleResponse>>> List(Guid companyId, [FromQuery] DateOnly? activeOn = null)
    {
        var query = _db.DiscountRules.AsNoTracking().Where(r => r.CompanyId == companyId);
        if (activeOn is { } day) query = query.Where(r => r.IsActive && r.ValidFrom <= day && day <= r.ValidTo);
        var rules = await query.OrderByDescending(r => r.ValidFrom).ThenBy(r => r.Name).ToListAsync();
        return Ok(await ToResponsesAsync(companyId, rules));
    }

    [HttpPost(Name = "CreateDiscountRule")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(DiscountRuleResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<DiscountRuleResponse>> Create(Guid companyId, SaveDiscountRuleRequest request)
    {
        var rule = new DiscountRule { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, rule, request) is { } error) return BadRequest(error);
        _db.DiscountRules.Add(rule);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(companyId, [rule])).Single());
    }

    [HttpPut("{id:guid}", Name = "UpdateDiscountRule")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<DiscountRuleResponse>> Update(Guid companyId, Guid id, SaveDiscountRuleRequest request)
    {
        var rule = await _db.DiscountRules.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (rule is null) return NotFound();
        if (await ApplyAsync(companyId, rule, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(companyId, [rule])).Single());
    }

    // A rule only sets a starting value on new lines; documents already saved keep their own
    // discount, so a rule can be deleted outright.
    [HttpDelete("{id:guid}", Name = "DeleteDiscountRule")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var rule = await _db.DiscountRules.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (rule is null) return NotFound();
        _db.DiscountRules.Remove(rule);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<string?> ApplyAsync(Guid companyId, DiscountRule rule, SaveDiscountRuleRequest request)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0 || name.Length > 128) return _localizer["DiscountRuleNameRequired"].Value;
        if (request.Percent is <= 0 or > 100) return _localizer["DiscountRulePercentInvalid"].Value;
        if (request.ValidTo < request.ValidFrom) return _localizer["ReportDateRangeInvalid"].Value;
        if (request.PartnerId is null && request.ItemCategoryId is null && request.ItemId is null)
        {
            return _localizer["DiscountRuleTargetRequired"].Value;
        }
        if (request.PartnerId is { } partnerId && !await _db.Partners.AnyAsync(p => p.Id == partnerId && p.CompanyId == companyId && p.IsCustomer))
        {
            return _localizer["DiscountRuleTargetNotFound"].Value;
        }
        if (request.ItemCategoryId is { } categoryId && !await _db.ItemCategories.AnyAsync(c => c.Id == categoryId && c.CompanyId == companyId))
        {
            return _localizer["DiscountRuleTargetNotFound"].Value;
        }
        if (request.ItemId is { } itemId && !await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId))
        {
            return _localizer["DiscountRuleTargetNotFound"].Value;
        }

        rule.Name = name;
        rule.Percent = Math.Round(request.Percent, 2, MidpointRounding.AwayFromZero);
        rule.ValidFrom = request.ValidFrom;
        rule.ValidTo = request.ValidTo;
        rule.PartnerId = request.PartnerId;
        rule.ItemCategoryId = request.ItemCategoryId;
        rule.ItemId = request.ItemId;
        rule.Priority = request.Priority;
        rule.IsActive = request.IsActive;
        return null;
    }

    private async Task<List<DiscountRuleResponse>> ToResponsesAsync(Guid companyId, IReadOnlyCollection<DiscountRule> rules)
    {
        var partnerIds = rules.Where(r => r.PartnerId != null).Select(r => r.PartnerId!.Value).Distinct().ToList();
        var categoryIds = rules.Where(r => r.ItemCategoryId != null).Select(r => r.ItemCategoryId!.Value).Distinct().ToList();
        var itemIds = rules.Where(r => r.ItemId != null).Select(r => r.ItemId!.Value).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => p.CompanyId == companyId && partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var categories = await _db.ItemCategories.AsNoTracking().Where(c => c.CompanyId == companyId && categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name);
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        return rules.Select(r => new DiscountRuleResponse(
            r.Id, r.Name, r.Percent, r.ValidFrom, r.ValidTo,
            r.PartnerId, r.PartnerId is { } p ? partners.GetValueOrDefault(p) : null,
            r.ItemCategoryId, r.ItemCategoryId is { } c ? categories.GetValueOrDefault(c) : null,
            r.ItemId, r.ItemId is { } i ? items.GetValueOrDefault(i) : null,
            r.Priority, r.IsActive)).ToList();
    }
}
