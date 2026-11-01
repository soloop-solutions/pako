using Pako.Domain.Projects;

namespace Pako.Api.Contracts;

// docs/ERP_VERTICALS_PLAN.md — construction, real estate sales, property rental (phase 1).

// ---- Construction ----
public record CostCodeRequest(string Code, string Name, decimal Budget);
public record BoqLineRequest(string Code, string Description, string Unit, decimal Quantity, decimal UnitPrice);
// ProjectCode: the ledger project created for a new site (ignored on update).
public record SaveSiteRequest(string Name, Guid ClientPartnerId, decimal ContractValue, decimal RetentionPercent, Guid BillingItemId,
    List<CostCodeRequest> CostCodes, List<BoqLineRequest> Boq, string? ProjectCode = null, string? Address = null, DateOnly? StartDate = null,
    DateOnly? EndDate = null, SiteState State = SiteState.Active);
public record CostCodeResponse(Guid Id, string Code, string Name, decimal Budget);
public record BoqLineResponse(Guid Id, string Code, string Description, string Unit, decimal Quantity, decimal UnitPrice, decimal Amount, decimal Certified);
public record SiteResponse(Guid Id, Guid ProjectId, string ProjectCode, string Name, Guid ClientPartnerId, string ClientName, string? Address,
    decimal ContractValue, decimal RetentionPercent, decimal RetentionReleased, DateOnly? StartDate, DateOnly? EndDate, SiteState State, Guid BillingItemId,
    decimal BoqTotal, List<CostCodeResponse> CostCodes, List<BoqLineResponse> Boq);
public record SiteSummaryResponse(Guid Id, string ProjectCode, string Name, string ClientName, decimal ContractValue, SiteState State, decimal Billed,
    decimal PercentComplete, Guid? ProjectId = null);

public record ProgressBillLineRequest(Guid BoqLineId, decimal CumulativeQuantity);
public record SaveProgressBillRequest(DateOnly PeriodTo, List<ProgressBillLineRequest> Lines);
public record ProgressBillLineResponse(Guid Id, Guid BoqLineId, string Code, string Description, string Unit, decimal ContractQuantity, decimal UnitPrice,
    decimal PreviousQuantity, decimal CumulativeQuantity, decimal PeriodQuantity, decimal Amount, bool OverContract);
public record ProgressBillResponse(Guid Id, Guid SiteId, int Number, DateOnly PeriodTo, ProgressBillState State, decimal Amount, decimal Retention,
    decimal NetDue, Guid? InvoiceId, List<ProgressBillLineResponse> Lines);

// Percentage of completion (cost-to-cost) and the site's position.
public record CostCodeProgressRow(Guid? CostCodeId, string Code, string Name, decimal Budget, decimal Actual, decimal Variance);
public record SiteProgressResponse(Guid SiteId, decimal ContractValue, decimal BudgetCost, decimal ActualCost, decimal PercentComplete, decimal EarnedRevenue,
    decimal Billed, decimal OverUnderBilling, decimal LedgerRevenue, decimal RetentionHeld, decimal Margin, List<CostCodeProgressRow> CostCodes);
public record ReleaseRetentionRequest(decimal Amount);

// ---- Real estate ----
public record SaveBuildingRequest(string Name, Guid SaleItemId, string? ProjectCode = null, string? Address = null);
public record BuildingResponse(Guid Id, Guid ProjectId, string ProjectCode, string Name, string? Address, Guid SaleItemId, int Units, int Available, int Reserved,
    int Sold, int Rented);
public record SaveUnitRequest(Guid BuildingId, string Number, UnitKind Kind, decimal Area, decimal ListPrice, string? Floor = null);
public record UnitResponse(Guid Id, Guid BuildingId, string BuildingName, string Number, string? Floor, UnitKind Kind, decimal Area, decimal ListPrice,
    UnitState State, decimal? PricePerSquareMetre, string? HolderName);
public record SaveReservationRequest(Guid UnitId, Guid PartnerId, DateOnly Date, DateOnly ExpiresOn, decimal Deposit = 0m, string? Notes = null);
public record ReservationResponse(Guid Id, Guid UnitId, string UnitNumber, Guid PartnerId, string PartnerName, DateOnly Date, DateOnly ExpiresOn, decimal Deposit,
    ReservationState State, string? Notes);
public record InstallmentRequest(DateOnly DueDate, decimal Amount);
// Installments: an explicit plan, or (when empty) DownPayment now and the rest in InstallmentCount equal monthly parts.
public record SaveSaleContractRequest(Guid UnitId, Guid BuyerPartnerId, DateOnly ContractDate, decimal Price, ContractKind Kind = ContractKind.Sale,
    List<InstallmentRequest>? Installments = null, decimal DownPayment = 0m, int InstallmentCount = 0, DateOnly? FirstInstallment = null,
    Guid? ReservationId = null, string? Notes = null);
public record InstallmentResponse(Guid Id, int Number, DateOnly DueDate, decimal Amount, Guid? InvoiceId, string? InvoiceNumber, decimal Open, bool Overdue);
public record SaleContractResponse(Guid Id, string Number, Guid UnitId, string UnitNumber, string BuildingName, Guid BuyerPartnerId, string BuyerName,
    ContractKind Kind, DateOnly ContractDate, decimal Price, ContractState State, string? Notes, decimal Invoiced, decimal Paid, decimal Outstanding,
    decimal Overdue, List<InstallmentResponse> Installments);
public record InvoiceInstallmentsRequest(List<Guid> InstallmentIds, DateOnly? IssueDate = null);

// ---- Rentals ----
public record LeaseMeterRequest(string Name, Guid ItemId, decimal LastReading);
public record SaveLeaseRequest(Guid TenantPartnerId, DateOnly StartDate, decimal Rent, Guid RentItemId, Guid? UnitId = null, string? Property = null,
    DateOnly? EndDate = null, int DueDay = 1, decimal Deposit = 0m, DateOnly? DepositReceivedOn = null, DateOnly? DepositReturnedOn = null, string? Notes = null,
    List<LeaseMeterRequest>? Meters = null);
public record LeaseMeterResponse(Guid Id, string Name, Guid ItemId, string ItemName, decimal LastReading, decimal? PendingReading);
public record LeaseResponse(Guid Id, string Number, Guid? UnitId, string? UnitLabel, string? Property, Guid TenantPartnerId, string TenantName, DateOnly StartDate,
    DateOnly? EndDate, decimal Rent, Guid RentItemId, int DueDay, decimal Deposit, DateOnly? DepositReceivedOn, DateOnly? DepositReturnedOn, LeaseState State,
    string? Notes, DateOnly? LastInvoicedPeriod, decimal Arrears, List<LeaseMeterResponse> Meters);
public record MeterReadingInput(decimal Reading);
public record EndLeaseRequest(DateOnly EndDate);
public record RentRunRequest(DateOnly Month);
public record RentRunResponse(DateOnly Period, List<Guid> InvoiceIds, int Created, int AlreadyInvoiced, int NotRunning);
