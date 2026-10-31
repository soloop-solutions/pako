namespace Pako.Api.Contracts;

public record StockMovementRow(
    Guid ItemId, int ItemCode, string ItemName, string Unit, string? CategoryName,
    decimal OpeningQuantity, decimal OpeningValue, decimal InQuantity, decimal InValue,
    decimal OutQuantity, decimal OutValue, decimal ClosingQuantity, decimal AverageCost, decimal ClosingValue,
    decimal? SellPriceExVat, decimal? MarkupPercent);

public record StockMovementsReportResponse(
    DateOnly From, DateOnly To, List<StockMovementRow> Items, int Total, int Page, int PageSize,
    decimal TotalOpeningValue, decimal TotalInValue, decimal TotalOutValue, decimal TotalClosingValue);
