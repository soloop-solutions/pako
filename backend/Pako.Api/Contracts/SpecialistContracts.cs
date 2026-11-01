using Pako.Domain.Pos;

namespace Pako.Api.Contracts;

// docs/POS_PLAN.md P7 — pharmacy, fuel station, auto parts, online channels.

// ---- Pharmacy ----
public record SavePayerRequest(string Name, Guid PartnerId, decimal CoveragePercent, bool IsActive = true);
public record PayerResponse(Guid Id, string Name, Guid PartnerId, string PartnerName, decimal CoveragePercent, bool IsActive);

public record PrescriptionLineRequest(Guid ItemId, decimal Quantity, string? Dosage = null);
public record SavePrescriptionRequest(Guid StoreId, string Number, DateOnly IssuedOn, string Prescriber, string PatientName,
    List<PrescriptionLineRequest> Lines, DateOnly? ValidUntil = null, string? PrescriberLicence = null, string? PatientPersonalNumber = null,
    Guid? PayerId = null, decimal? CoveragePercent = null, string? Notes = null);
public record PrescriptionLineResponse(Guid Id, Guid ItemId, string ItemName, decimal Quantity, decimal Dispensed, decimal Remaining, string? Dosage);
public record PrescriptionResponse(Guid Id, Guid StoreId, string Number, DateOnly IssuedOn, DateOnly? ValidUntil, string Prescriber, string? PrescriberLicence,
    string PatientName, string? PatientPersonalNumber, Guid? PayerId, string? PayerName, Guid? PayerPartnerId, decimal CoveragePercent, PrescriptionState State,
    string? Notes, DateTime CreatedAt, List<PrescriptionLineResponse> Lines);

// One movement of a controlled medicine, with the running balance (company-wide, base units).
public record ControlledRegisterRow(DateOnly Date, string Document, string? Counterparty, string? PrescriptionNumber, string? Patient,
    string? Prescriber, decimal In, decimal Out, decimal Balance);
public record ControlledRegisterResponse(Guid ItemId, string ItemName, DateOnly From, DateOnly To, decimal Opening, List<ControlledRegisterRow> Rows,
    decimal Closing);

// Same active ingredient (or ATC code) — what can be offered instead.
public record SubstituteResponse(Guid ItemId, int Code, string Name, string? AtcCode, string? ActiveIngredient, decimal? Price, decimal OnHand,
    bool IsPrescriptionOnly);

// ---- Fuel station ----
public record SaveTankRequest(Guid StoreId, string Name, Guid ItemId, decimal Capacity, bool IsActive = true);
public record TankResponse(Guid Id, Guid StoreId, string Name, Guid ItemId, string ItemName, decimal Capacity, bool IsActive, decimal? LastDip,
    DateTime? LastDipAt);
public record SaveNozzleRequest(Guid StoreId, int Pump, int Number, Guid TankId, bool IsActive = true);
public record NozzleResponse(Guid Id, Guid StoreId, int Pump, int Number, Guid TankId, string TankName, Guid ItemId, string ItemName, bool IsActive,
    decimal? LastClosing);
public record MeterReadingRequest(Guid NozzleId, decimal Opening, decimal Closing);
public record SaveMeterReadingsRequest(Guid StoreId, DateOnly Date, List<MeterReadingRequest> Readings, Guid? SessionId = null);
public record TankDipRequest(Guid TankId, decimal Volume, decimal Water = 0m, DateTime? MeasuredAt = null);

// Litres pumped by the meters against litres sold at the till, per nozzle and per grade.
public record ForecourtNozzleRow(Guid NozzleId, int Pump, int Number, string ItemName, decimal Pumped, decimal Sold, decimal Difference);
public record ForecourtGradeRow(Guid ItemId, string ItemName, decimal Pumped, decimal Sold, decimal Difference, decimal BookStock, decimal? Dipped,
    decimal? DipDifference);
public record ForecourtReconciliationResponse(Guid StoreId, DateOnly Date, List<ForecourtNozzleRow> Nozzles, List<ForecourtGradeRow> Grades);

public record SaveFleetCardRequest(string Number, Guid PartnerId, string? VehiclePlate = null, string? DriverName = null, decimal? LimitPerFill = null,
    bool FuelOnly = true, bool IsActive = true);
public record FleetCardResponse(Guid Id, string Number, Guid PartnerId, string PartnerName, string? VehiclePlate, string? DriverName, decimal? LimitPerFill,
    bool FuelOnly, bool IsActive);

// ---- Auto parts ----
public record CrossReferenceRequest(string Brand, string Number);
public record FitmentRequest(string Make, string Model, int? YearFrom = null, int? YearTo = null, string? Engine = null);
public record SavePartDataRequest(List<CrossReferenceRequest> References, List<FitmentRequest> Fitments);
public record CrossReferenceResponse(Guid Id, string Brand, string Number);
public record FitmentResponse(Guid Id, string Make, string Model, int? YearFrom, int? YearTo, string? Engine);
public record PartDataResponse(Guid ItemId, List<CrossReferenceResponse> References, List<FitmentResponse> Fitments);
// Match: "code", "barcode", "reference" (with the brand and number matched) or "fitment".
public record PartSearchResult(Guid ItemId, int Code, string Name, string Match, string? Brand, string? Number, decimal? Price, decimal OnHand);

// ---- Online channels ----
public record SaveSalesChannelRequest(Guid StoreId, string Name, SalesChannelKind Kind, bool IsActive = true);
public record SalesChannelResponse(Guid Id, Guid StoreId, string Name, SalesChannelKind Kind, string Token, bool IsActive, int OpenOrders);

public record ChannelOrderLineResponse(Guid Id, int LineNo, Guid ItemId, string Description, decimal Quantity, decimal UnitPrice, decimal Total);
public record ChannelOrderResponse(Guid Id, Guid ChannelId, string ChannelName, Guid StoreId, string Number, string ExternalRef, ChannelOrderState State,
    ChannelFulfilment Fulfilment, ChannelPayment Payment, string CustomerName, string? Phone, string? Email, string? Address, string? City, string? Notes,
    decimal Total, decimal ShippingFee, Guid? CourierPartnerId, string? CourierName, string? TrackingNumber, Guid? PosOrderId, string? PosOrderNumber,
    DateOnly? RemittedOn, string? RemittanceRef, DateTime CreatedAt, List<ChannelOrderLineResponse> Lines);
public record ChannelOrderStateRequest(ChannelOrderState State, Guid? CourierPartnerId = null, string? TrackingNumber = null);
public record CodRemittanceRequest(List<Guid> OrderIds, DateOnly RemittedOn, string Reference);
// Cash on delivery the couriers still owe: dispatched or delivered, not yet remitted.
public record CodCourierRow(Guid CourierPartnerId, string CourierName, int Orders, decimal Amount, DateOnly? OldestDispatch);
public record CodReportResponse(List<CodCourierRow> Couriers, List<ChannelOrderResponse> Orders);

// The public channel API (token in the path).
public record PublicCatalogItem(Guid ItemId, int Code, string Name, string Unit, List<string> Barcodes, decimal? Price, decimal Available);
public record PublicChannelOrderLine(Guid ItemId, decimal Quantity, decimal UnitPrice, string? Description = null);
public record PublicChannelOrderRequest(string ExternalRef, string CustomerName, ChannelFulfilment Fulfilment, ChannelPayment Payment,
    List<PublicChannelOrderLine> Lines, string? Phone = null, string? Email = null, string? Address = null, string? City = null, string? Notes = null,
    decimal ShippingFee = 0m);
public record PublicChannelOrderResponse(string Number, string ExternalRef, ChannelOrderState State, decimal Total, string? TrackingNumber);
