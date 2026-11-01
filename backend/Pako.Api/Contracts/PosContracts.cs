using Pako.Domain.Pos;

namespace Pako.Api.Contracts;

// docs/POS_PLAN.md §12 — the point of sale.

// ---- Setup ----

public record StoreResponse(Guid Id, string Code, string Name, string? Address, int FiscalBranchNumber, string Location,
    Guid WarehouseId, Guid? PriceListId, string? ReceiptHeader, string? ReceiptFooter, bool IsActive, Guid? TipsAccountId = null,
    Guid? TouristTaxItemId = null, string? BookingToken = null);
public record SaveStoreRequest(string Code, string Name, string? Address, int FiscalBranchNumber, string Location,
    Guid WarehouseId, Guid? PriceListId = null, string? ReceiptHeader = null, string? ReceiptFooter = null, bool IsActive = true,
    Guid? TipsAccountId = null, Guid? TouristTaxItemId = null);

// CertificateNotAfter is null until the till has been onboarded with ATK.
public record RegisterResponse(Guid Id, Guid StoreId, string StoreName, string Code, string Name, RegisterProfile Profile,
    FiscalMode FiscalMode, int FiscalPosNumber, string? FiscalizationNumber, Guid CashAccountId, bool IsActive,
    DateTime? CertificateNotAfter, Guid? OpenSessionId);
public record SaveRegisterRequest(Guid StoreId, string Code, string Name, RegisterProfile Profile, FiscalMode FiscalMode,
    int FiscalPosNumber, Guid CashAccountId, string? FiscalizationNumber = null, bool IsActive = true);
// The certificate ATK signed for this till (PEM); the private key never leaves the till.
public record SaveRegisterCertificateRequest(string CertificatePem);

// ---- Sessions ----

public record OpenSessionRequest(decimal OpeningFloat);
public record CashMovementRequest(PosCashMovementKind Kind, decimal Amount, string Reason, Guid CounterpartAccountId, Guid? PartnerId = null);
public record CashMovementResponse(Guid Id, PosCashMovementKind Kind, decimal Amount, string Reason, Guid CounterpartAccountId, DateTime CreatedAt);

// The close: what was counted per payment method (cash included).
public record CloseSessionRequest(List<CountedTenderRequest> Counted);
public record CountedTenderRequest(Guid PaymentMethodId, decimal Counted, string? DifferenceReason = null);

// X (running) or Z (closed) figures of a session — every amount computed by the server.
public record SessionReportResponse(Guid SessionId, string RegisterCode, int Number, PosSessionState State, DateOnly BusinessDate,
    DateTime OpenedAt, DateTime? ClosedAt, decimal OpeningFloat, int Sales, int Returns, int Cancellations,
    decimal GrossSales, decimal Refunds, decimal NetSales, List<ReportTaxRow> Taxes, List<ReportTenderRow> Tenders,
    List<CashMovementResponse> CashMovements, decimal CashExpected, int PendingFiscal, long? FirstCouponId, long? LastCouponId,
    Guid? JournalEntryId);
public record ReportTaxRow(string TaxLetter, decimal TaxRate, decimal Gross, decimal Net, decimal Tax);
public record ReportTenderRow(Guid PaymentMethodId, string Name, decimal Expected, decimal? Counted, decimal? Difference);

public record SessionSummaryResponse(Guid Id, Guid RegisterId, string RegisterCode, int Number, PosSessionState State,
    DateOnly BusinessDate, DateTime OpenedAt, DateTime? ClosedAt, decimal NetSales, Guid? JournalEntryId);

// ---- Orders ----

// What the till sends for one order (sale, return or cancellation). ClientUuid makes a resend
// harmless. Prices are VAT-inclusive; the server recomputes every total with PosPricing.
public record PosOrderRequest(
    Guid ClientUuid,
    Guid SessionId,
    PosOrderKind Kind,
    DateTime OrderedAt,
    List<PosOrderLineRequest> Lines,
    List<PosPaymentRequest> Payments,
    Guid? CustomerId = null,
    Guid? OriginalOrderId = null,
    string? Reason = null,
    bool CreatedOffline = false,
    // SEF registers: the coupon exactly as the till signed and (maybe) sent it.
    PosFiscalRequest? Fiscal = null,
    // P2: coupon codes entered, the loyalty card shown and points to redeem.
    List<string>? CouponCodes = null,
    string? LoyaltyCardNumber = null,
    decimal RedeemPoints = 0m,
    // P2: this sale collects a customer order (layaway, special order).
    Guid? CustomerOrderId = null,
    // P3: this sale pays (part of) a tab.
    Guid? TabId = null,
    // P4: this sale settles an appointment or collects a repair.
    Guid? AppointmentId = null,
    Guid? RepairTicketId = null,
    // P7: the prescription dispensed, the fleet card shown, the online order fiscalised.
    Guid? PrescriptionId = null,
    string? FleetCardNumber = null,
    Guid? ChannelOrderId = null);

public record PosOrderLineRequest(Guid? ItemId, string Description, decimal Quantity, decimal UnitPrice, Guid? TaxDefinitionId,
    decimal DiscountAmount = 0m, string? UnitName = null, string? LotNumber = null, Guid? OriginalLineId = null,
    // P2: the cashier confirmed the buyer's age (required for items with a minimum age).
    bool AgeVerified = false,
    // P2: this line sells a gift card (no item): its amount loads the card. Empty = a new number.
    string? GiftCardNumber = null,
    // P2: the serial number (IMEI) of the unit sold, for items that track serials.
    string? SerialNumber = null,
    // P3: the tab line this pays (all or part of its quantity); price and item come from the tab.
    Guid? TabLineId = null,
    // P4: who performed the service (commission); a package this line uses a session of (priced at
    // the package's value per session and paid from it); a membership the line renews (empty: new).
    Guid? StaffUserId = null,
    string? PackageNumber = null,
    string? MembershipNumber = null,
    // P7: the prescription line dispensed (prescription-only medicines); the fuel nozzle that pumped it.
    Guid? PrescriptionLineId = null,
    Guid? NozzleId = null);

public record PosPaymentRequest(Guid PaymentMethodId, decimal Amount, decimal? Tendered = null, string? Reference = null,
    // P3: a tip on top of Amount (not on the coupon).
    decimal Tip = 0m,
    // P7: an on-account tender charged to someone other than the customer — the prescription's
    // payer, the fleet card's company or the courier collecting cash on delivery.
    Guid? PartnerId = null);

public record PosFiscalRequest(long CouponId, string VerificationNo, DateTime IssuedAt, string Details, string Signature, string QrCode,
    int DailyNumber, bool SentToAtk = false, ulong? AtkTransactionNo = null);

public record PosOrderResponse(Guid Id, Guid ClientUuid, string Number, PosOrderKind Kind, PosOrderState State, DateTime OrderedAt,
    string OperatorName, Guid? CustomerId, Guid? OriginalOrderId, decimal Total, decimal TotalTax, decimal TotalDiscount,
    List<PosOrderLineResponse> Lines, List<PosPaymentResponse> Payments, FiscalDocumentResponse? Fiscal, decimal Change,
    // Per VAT letter, as the coupon prints them; the register the order was rung up on.
    List<ReportTaxRow> Taxes, Guid RegisterId,
    // P2: gift cards and store credit this order loaded or spent (balances after), and loyalty.
    List<PosCardResponse>? Cards = null, decimal PointsEarned = 0m, decimal PointsRedeemed = 0m, decimal? PointsBalance = null,
    // P5: event tickets this sale issued (their codes go on the QR).
    List<TicketResponse>? Tickets = null);
public record PosCardResponse(string Number, GiftCardKind Kind, decimal Change, decimal Balance);
public record PosOrderLineResponse(Guid Id, int LineNo, Guid? ItemId, string Description, string Unit, decimal Quantity,
    decimal UnitPrice, decimal DiscountAmount, string TaxLetter, decimal Gross, decimal Net, decimal Tax, decimal? Returnable,
    string? ProgramName = null, string? SerialNumber = null, string? PackageNumber = null, string? MembershipNumber = null);
public record PosPaymentResponse(Guid PaymentMethodId, string Name, decimal Amount, decimal? Tendered, decimal Tip = 0m);
public record FiscalDocumentResponse(FiscalDocumentType Type, long CouponId, int DailyNumber, long? ReferenceCouponId, string VerificationNo,
    DateTime IssuedAt, string QrCode, AtkStatus AtkStatus, ulong? AtkTransactionNo, string? AtkError, DateTime? SendBy);

public record PosOrderSummaryResponse(Guid Id, string Number, PosOrderKind Kind, PosOrderState State, DateTime OrderedAt,
    string RegisterCode, string OperatorName, decimal Total, long? CouponId, AtkStatus? AtkStatus);

// The basket priced by the server (repo rule: no money math in the browser). Payments optional:
// with them the till learns what is still due and the change to give. With OriginalOrderId the
// lines are a return of that sale, priced as it was sold (discount shared pro rata).
public record PosQuoteRequest(List<PosOrderLineRequest> Lines, List<PosPaymentRequest>? Payments = null, Guid? OriginalOrderId = null,
    List<string>? CouponCodes = null, string? LoyaltyCardNumber = null, decimal RedeemPoints = 0m, Guid? TabId = null,
    // P7: the prescription, fleet card or online order the sale is for (their partners' shares).
    Guid? PrescriptionId = null, string? FleetCardNumber = null, Guid? ChannelOrderId = null);
public record PosQuoteResponse(List<PosQuoteLineResponse> Lines, List<ReportTaxRow> Taxes, decimal Total, decimal TotalTax, decimal TotalDiscount,
    decimal Paid, decimal Remaining, decimal Change, bool CashLimitExceeded,
    // P2: the programs that gave a discount, codes that matched nothing, and the loyalty card.
    List<AppliedProgramResponse>? Programs = null, List<string>? UnknownCodes = null, decimal PointsRedeemed = 0m,
    LoyaltyCardResponse? LoyaltyCard = null,
    // P7: who an on-account tender may charge besides the customer, and the most it may charge each —
    // the prescription's payer its share, the fleet card's company, the courier of a cash-on-delivery order.
    List<PosTenderPartnerResponse>? TenderPartners = null);
public record PosTenderPartnerResponse(Guid PartnerId, string Name, decimal? Max);
// Discount: what promotions, coupons and loyalty took off this line (the cashier's own discount is
// the rest of the line's discount).
public record PosQuoteLineResponse(string TaxLetter, decimal Gross, decimal Net, decimal Tax, decimal ProgramDiscount = 0m, string? ProgramName = null);
public record AppliedProgramResponse(Guid ProgramId, string Name, decimal Discount);

// ---- Catalogue for the till ----

// What the till caches (D11): sellable items with barcodes, price for the store, VAT letter and stock flag.
public record PosCatalogItemResponse(Guid Id, int Code, string Name, string Unit, string? SalesUnit, decimal? SalesUnitFactor,
    List<string> Barcodes, decimal? Price, Guid? TaxDefinitionId, string TaxLetter, decimal TaxRate, bool TracksStock, bool TrackLots,
    Guid? CategoryId, string? Plu = null, bool SellByWeight = false, bool OpenPrice = false, int? MinimumAge = null, Guid? DepositItemId = null,
    bool TrackSerials = false, Guid? VariantOfItemId = null, string? VariantLabel = null,
    // P4: a bookable service (minutes), a package of sessions, a membership plan (days).
    bool IsBookable = false, int? DurationMinutes = null, Guid? PackageServiceItemId = null, int? PackageSessions = null, int? MembershipDays = null,
    // P7 pharmacy: what the till needs to ask for a prescription, offer substitutes and respect the cap.
    string? ActiveIngredient = null, bool IsPrescriptionOnly = false, bool IsControlled = false, decimal? MaxRetailPrice = null);
public record PosTenderResponse(Guid Id, string Name, Domain.Companies.PaymentMethodKind Kind);
public record PosBootstrapResponse(RegisterResponse Register, StoreResponse Store, SessionSummaryResponse? Session,
    List<PosTenderResponse> Tenders, decimal CashLimitB2C, string CompanyName, string? FiscalNumber, string? VatNumber);

// ---- P2: scanning and in-store barcodes ----

// What a scanned code means for the till: the item, and a quantity (weight) or a line price when the
// label carries one (2x barcodes). Match: "barcode", "code", "plu", "weight", "price" or "quantity".
// P7: a GS1 DataMatrix also gives the pack's lot, expiry and serial.
public record PosScanResponse(PosCatalogItemResponse Item, string Match, decimal? Quantity, decimal? UnitPrice, string? LotNumber = null,
    DateOnly? ExpiryDate = null, string? SerialNumber = null);

public record BarcodeRuleResponse(Guid Id, string Prefix, BarcodeRuleKind Kind, int ItemDigits, int ValueDigits, int ValueDecimals, bool IsActive);
public record SaveBarcodeRuleRequest(string Prefix, BarcodeRuleKind Kind, int ItemDigits = 5, int ValueDigits = 5, int ValueDecimals = 3, bool IsActive = true);

// ---- P2: programs, loyalty, gift cards ----

public record ProgramResponse(Guid Id, string Name, ProgramKind Kind, ProgramRewardKind Reward, bool IsActive, DateOnly? ValidFrom, DateOnly? ValidTo,
    int Days, TimeOnly? TimeFrom, TimeOnly? TimeTo, Guid? StoreId, int Priority, bool Stackable, string? Code, int? MaxUses, int Uses,
    decimal? MinQuantity, decimal? MinAmount, decimal? Percent, decimal? Amount, decimal? Price, int? BuyQuantity, int? GetQuantity,
    decimal? PointsPerEuro, decimal? PointValue, List<Guid> ItemIds, List<Guid> CategoryIds);
public record SaveProgramRequest(string Name, ProgramKind Kind, ProgramRewardKind Reward, bool IsActive = true, DateOnly? ValidFrom = null,
    DateOnly? ValidTo = null, int Days = 0, TimeOnly? TimeFrom = null, TimeOnly? TimeTo = null, Guid? StoreId = null, int Priority = 100,
    bool Stackable = false, string? Code = null, int? MaxUses = null, decimal? MinQuantity = null, decimal? MinAmount = null,
    decimal? Percent = null, decimal? Amount = null, decimal? Price = null, int? BuyQuantity = null, int? GetQuantity = null,
    decimal? PointsPerEuro = null, decimal? PointValue = null, List<Guid>? ItemIds = null, List<Guid>? CategoryIds = null);

public record LoyaltyCardResponse(Guid Id, string Number, string? HolderName, string? Phone, Guid? PartnerId, decimal Points, bool IsActive);
public record SaveLoyaltyCardRequest(string? Number, string? HolderName = null, string? Phone = null, Guid? PartnerId = null, bool IsActive = true);

public record GiftCardResponse(Guid Id, string Number, GiftCardKind Kind, decimal Balance, DateOnly? ExpiresOn, bool IsActive, DateTime CreatedAt,
    List<GiftCardMovementResponse> Movements);
public record GiftCardMovementResponse(Guid? OrderId, string? OrderNumber, decimal Amount, DateTime At);

// P2: what a serial number (IMEI) is — the item, when and on which order it was sold, the warranty.
public record SerialLookupResponse(Guid ItemId, string ItemName, string Serial, Pako.Domain.Inventory.ItemSerialStatus Status, DateTime? SoldAt,
    Guid? OrderId, string? OrderNumber, DateOnly? WarrantyUntil, bool UnderWarranty);

// ---- P2: store reporting and shelf labels ----

public enum PosReportGroup { Day, Hour, Store, Register, Cashier, Item, Category, Tender, Program }

// Sales and returns (VAT-inclusive), net of returns, the VAT and discounts in it; for item and
// category groupings also the cost of goods (as valued when sold) and the margin on the net of VAT.
public record PosSalesReportResponse(DateOnly From, DateOnly To, PosReportGroup GroupBy, List<PosSalesReportRow> Rows, PosSalesReportRow Total);
public record PosSalesReportRow(string Key, string Label, int Orders, decimal Quantity, decimal Sales, decimal Returns, decimal NetSales,
    decimal Tax, decimal Discount, decimal? Cost, decimal? Margin);

// ---- P2: customer orders (layaway, special orders) ----

// Total, deposits paid and what is left are the server's figures.
public record CustomerOrderResponse(Guid Id, string Number, CustomerOrderKind Kind, CustomerOrderState State, Guid CustomerId, string CustomerName,
    Guid StoreId, DateOnly? DueDate, string? Notes, List<CustomerOrderLineResponse> Lines, decimal Total, string DepositCardNumber,
    decimal Deposited, decimal Remaining, DateTime CreatedAt, Guid? CollectedOrderId);
public record CustomerOrderLineResponse(Guid Id, Guid ItemId, string Description, decimal Quantity, decimal UnitPrice, decimal Amount);
// A line's price may be left out: the store's price on the day is used.
public record SaveCustomerOrderRequest(Guid StoreId, CustomerOrderKind Kind, Guid CustomerId, List<SaveCustomerOrderLineRequest> Lines,
    DateOnly? DueDate = null, string? Notes = null);
public record SaveCustomerOrderLineRequest(Guid ItemId, decimal Quantity, decimal? UnitPrice = null, string? Description = null);
// Cancelling pays back the deposits in cash from an open session's drawer.
public record CancelCustomerOrderRequest(string Reason, Guid? SessionId = null);

// ---- P3: hospitality ----

public record FloorResponse(Guid Id, Guid StoreId, string Name, int SortOrder, bool IsActive, List<TableResponse> Tables);
public record TableResponse(Guid Id, Guid FloorId, string Name, int Seats, TableShape Shape, int X, int Y, int Width, int Height, bool IsActive, string QrToken);
public record SaveFloorRequest(Guid StoreId, string Name, int SortOrder = 0, bool IsActive = true);
public record SaveTableRequest(Guid FloorId, string Name, int Seats = 4, TableShape Shape = TableShape.Square, int X = 0, int Y = 0,
    int Width = 2, int Height = 2, bool IsActive = true);

// The live floor: every table with its open tab, and the tabs with no table (takeaway, delivery).
public record FloorPlanResponse(List<FloorPlanFloorResponse> Floors, List<TabSummaryResponse> OtherTabs);
public record FloorPlanFloorResponse(Guid Id, string Name, List<FloorPlanTableResponse> Tables);
public record FloorPlanTableResponse(Guid Id, string Name, int Seats, TableShape Shape, int X, int Y, int Width, int Height,
    List<TabSummaryResponse> Tabs);
public record TabSummaryResponse(Guid Id, string Number, string? Name, TabKind Kind, TabState State, Guid? TableId, string? TableName,
    int Covers, string WaiterName, DateTime OpenedAt, decimal Total, decimal Due, int PendingLines, int RequestedLines);

// Gross per line and the tab's totals are the server's; Due is what is still unpaid.
public record TabResponse(Guid Id, string Number, string? Name, TabKind Kind, TabState State, Guid StoreId, Guid? TableId, string? TableName,
    int Covers, string WaiterName, DateTime OpenedAt, string? DeliveryAddress, string? DeliveryPhone, string? DriverName, int PreBillCount,
    List<TabLineResponse> Lines, List<ReportTaxRow> Taxes, decimal Total, decimal Paid, decimal Due,
    // The whole bill's VAT per letter (what a pre-bill shows); Taxes is what is still due.
    List<ReportTaxRow>? BillTaxes = null);
public record TabLineResponse(Guid Id, int LineNo, Guid ItemId, string Description, decimal Quantity, decimal UnitPrice, decimal DiscountAmount,
    decimal Gross, TabLineState State, int? Seat, int Course, string? Note, string? Modifiers, Guid? ParentLineId, Guid? ProductionCenterId,
    DateTime? SentAt, decimal PaidQuantity, decimal Remaining, decimal RemainingGross, string? VoidReason);

public record OpenTabRequest(Guid StoreId, Guid? TableId = null, TabKind Kind = TabKind.DineIn, int Covers = 0, string? Name = null,
    string? DeliveryAddress = null, string? DeliveryPhone = null);
public record UpdateTabRequest(int Covers, string? Name = null, string? DeliveryAddress = null, string? DeliveryPhone = null, string? DriverName = null);
// A price is needed only for open-price items; otherwise the store's price is used.
public record AddTabLinesRequest(List<AddTabLineRequest> Lines);
public record AddTabLineRequest(Guid ItemId, decimal Quantity, decimal? UnitPrice = null, int? Seat = null, int Course = 1, string? Note = null,
    List<Guid>? ModifierIds = null, List<ComboChoiceRequest>? ComboChoices = null, bool AgeVerified = false);
public record ComboChoiceRequest(Guid SlotId, Guid ItemId);
public record UpdateTabLineRequest(decimal Quantity, int? Seat = null, int Course = 1, string? Note = null);
public record VoidTabLineRequest(string Reason);
public record TransferTabRequest(Guid? TableId);
public record MergeTabRequest(Guid FromTabId);
public record MoveTabLinesRequest(List<Guid> LineIds, Guid ToTabId);

// An equal split: what each of N guests pays — the quantity of every open line each part takes
// (the last part takes what rounding leaves) and the part's total.
public record TabSplitResponse(int Ways, List<TabSplitPartResponse> Parts);
public record TabSplitPartResponse(int Part, List<TabSplitLineResponse> Lines, decimal Total);
public record TabSplitLineResponse(Guid TabLineId, decimal Quantity);

// ---- P3: kitchen display ----

public record KitchenTicketResponse(Guid Id, Guid TabId, Guid? ProductionCenterId, string? ProductionCenterName, int Number, bool IsStorno,
    KitchenTicketState State, string TabLabel, string WaiterName, DateTime CreatedAt, DateTime? StartedAt, DateTime? ReadyAt, DateTime? DoneAt,
    List<KitchenTicketLineResponse> Lines);
public record KitchenTicketLineResponse(Guid TabLineId, string Description, decimal Quantity, string? Modifiers, string? Note, int? Seat, int Course);
public record KitchenTicketStateRequest(KitchenTicketState State);

// ---- P3: menu setup ----

public record ProductionCenterResponse(Guid Id, Guid? StoreId, string Name, ProductionCenterKind Kind, string? PrinterName, bool IsActive);
public record SaveProductionCenterRequest(string Name, ProductionCenterKind Kind, Guid? StoreId = null, string? PrinterName = null, bool IsActive = true);

public record ModifierGroupResponse(Guid Id, string Name, int MinSelect, int MaxSelect, bool IsActive, List<ModifierResponse> Modifiers, List<Guid> ItemIds);
public record ModifierResponse(Guid Id, string Name, decimal PriceDelta, Guid? IngredientItemId, decimal? IngredientQuantity, int SortOrder, bool IsActive);
// Modifiers are matched by id; one without an id is added; one left out is switched off.
public record SaveModifierGroupRequest(string Name, int MinSelect, int MaxSelect, List<SaveModifierRequest> Modifiers, List<Guid>? ItemIds = null,
    bool IsActive = true);
public record SaveModifierRequest(Guid? Id, string Name, decimal PriceDelta = 0m, Guid? IngredientItemId = null, decimal? IngredientQuantity = null,
    int SortOrder = 0, bool IsActive = true);

public record ComboSlotResponse(Guid Id, string Name, int MinSelect, int MaxSelect, int SortOrder, List<ComboChoiceResponse> Choices);
public record ComboChoiceResponse(Guid ItemId, decimal PriceDelta);
public record SaveComboRequest(List<SaveComboSlotRequest> Slots);
public record SaveComboSlotRequest(string Name, int MinSelect, int MaxSelect, List<ComboChoiceResponse> Choices);

// What the till needs to take restaurant orders: which items offer which modifier groups, the
// combos' slots, and each item's production centre.
public record PosMenuResponse(List<ModifierGroupResponse> ModifierGroups, Dictionary<Guid, List<ComboSlotResponse>> Combos,
    Dictionary<Guid, Guid> ProductionCenters, List<ProductionCenterResponse> Centers);

// ---- P3: QR menu (anonymous, by the table's printed code) ----

public record PublicMenuResponse(string StoreName, string TableName, List<PublicMenuItemResponse> Items, List<ModifierGroupResponse> ModifierGroups);
public record PublicMenuItemResponse(Guid Id, string Name, string? Description, decimal Price, string? CategoryName);
public record PublicOrderRequest(List<PublicOrderLineRequest> Lines, string? Note = null);
public record PublicOrderLineRequest(Guid ItemId, decimal Quantity, List<Guid>? ModifierIds = null, string? Note = null);

// ---- P3: usage variance ----

// Per ingredient over a period: what the till's recipes issued (theoretical use), what counts found
// missing (negative) or over, what was written off, and the shortage as a share of the use.
public record UsageVarianceResponse(DateOnly From, DateOnly To, List<UsageVarianceRow> Rows);
public record UsageVarianceRow(Guid ItemId, string Name, string Unit, decimal Theoretical, decimal CountDifference, decimal WrittenOff,
    decimal? VariancePercent, decimal CountDifferenceValue);

// ---- P3: staff on a shared till ----

public record SetPosPinRequest(string Pin);
public record PosPinSignInRequest(string Pin);
// Send Token as the X-Pos-Operator header with orders and tabs.
public record PosOperatorResponse(Guid UserId, string Name, string Token, DateTime ExpiresAt);

// What each waiter took in a session, and their cash hand-over.
public record WaiterSummaryResponse(Guid WaiterUserId, string WaiterName, int Orders, decimal NetSales, decimal Cash, decimal OtherTenders,
    decimal Tips, decimal CashExpected, WaiterSettlementResponse? Settlement);
public record WaiterSettlementResponse(Guid Id, decimal Expected, decimal Handed, decimal Difference, string? Reason, DateTime CreatedAt);
public record SettleWaiterRequest(Guid WaiterUserId, decimal Handed, string? Reason = null);

// ---- P4: services ----

public record ResourceResponse(Guid Id, Guid StoreId, string Name, ResourceKind Kind, Guid? UserId, string? Color, bool IsActive,
    List<ResourceHoursResponse> Hours, List<Guid> ServiceItemIds);
public record ResourceHoursResponse(int Day, TimeOnly From, TimeOnly To);
public record SaveResourceRequest(Guid StoreId, string Name, ResourceKind Kind, List<ResourceHoursResponse> Hours, List<Guid> ServiceItemIds,
    Guid? UserId = null, string? Color = null, bool IsActive = true);

// Times are UTC; the calendar shows them in Kosovo time.
public record AppointmentResponse(Guid Id, string Number, Guid StoreId, Guid ItemId, string ServiceName, Guid ResourceId, string ResourceName,
    DateTime Start, DateTime End, AppointmentState State, AppointmentSource Source, Guid? CustomerId, string CustomerName, string? Phone, string? Email,
    string? Notes, string? DepositCardNumber, decimal Deposited, decimal? Price, Guid? PosOrderId);
public record SaveAppointmentRequest(Guid StoreId, Guid ItemId, Guid ResourceId, DateTime Start, string CustomerName, Guid? CustomerId = null,
    string? Phone = null, string? Email = null, string? Notes = null);
public record AppointmentStateRequest(AppointmentState State, string? Reason = null);
// Free start times for a service on a day (per resource), in UTC.
public record AvailabilityResponse(DateOnly Date, int DurationMinutes, List<AvailabilityResourceResponse> Resources);
public record AvailabilityResourceResponse(Guid ResourceId, string Name, List<DateTime> Starts);

public record PackageResponse(Guid Id, string Number, Guid ServiceItemId, string ServiceName, string? HolderName, string? Phone, int SessionsTotal,
    int SessionsUsed, int SessionsLeft, decimal UnitValue, DateOnly? ExpiresOn, bool IsActive);
public record MembershipResponse(Guid Id, string Number, Guid PlanItemId, string PlanName, string? HolderName, string? Phone, DateOnly StartsOn,
    DateOnly EndsOn, MembershipState State, bool ActiveToday, int FrozenDays);
public record SaveMembershipHolderRequest(string? HolderName, string? Phone, Guid? CustomerId = null);
public record FreezeMembershipRequest(int Days);

public record RepairTicketResponse(Guid Id, string Number, Guid StoreId, RepairState State, Guid? CustomerId, string CustomerName, string? Phone,
    string? Email, string Device, string? SerialOrPlate, string Problem, string? Accessories, Guid? TechnicianUserId, string? Notes,
    List<RepairTicketLineResponse> Lines, decimal EstimateTotal, DateTime CreatedAt, DateTime? ApprovedAt, DateTime? ReadyAt, Guid? CollectedOrderId);
public record RepairTicketLineResponse(Guid Id, Guid ItemId, string Description, decimal Quantity, decimal UnitPrice, decimal Amount);
public record SaveRepairTicketRequest(Guid StoreId, string CustomerName, string Device, string Problem, Guid? CustomerId = null, string? Phone = null,
    string? Email = null, string? SerialOrPlate = null, string? Accessories = null, Guid? TechnicianUserId = null, string? Notes = null,
    List<SaveRepairTicketLineRequest>? Lines = null);
public record SaveRepairTicketLineRequest(Guid ItemId, decimal Quantity, decimal? UnitPrice = null, string? Description = null);
public record RepairStateRequest(RepairState State);

// ---- P4: online booking (anonymous, by the store's booking link) ----

public record PublicBookingResponse(string StoreName, string? Address, List<PublicBookingServiceResponse> Services);
public record PublicBookingServiceResponse(Guid ItemId, string Name, string? Description, int DurationMinutes, decimal? Price,
    List<PublicBookingResourceResponse> Resources);
public record PublicBookingResourceResponse(Guid Id, string Name);
public record PublicBookRequest(Guid ItemId, DateTime Start, string Name, string Phone, Guid? ResourceId = null, string? Email = null, string? Notes = null);
public record PublicBookedResponse(string Number, DateTime Start, DateTime End, string ResourceName);

// ---- P5: hotel ----

public record RoomTypeResponse(Guid Id, Guid StoreId, string Name, int Capacity, Guid RateItemId, decimal? Rate, bool IsActive, List<RoomResponse> Rooms,
    string? RateItemName = null);
public record RoomResponse(Guid Id, Guid RoomTypeId, string Number, string? Floor, RoomState State, bool IsActive);
public record SaveRoomTypeRequest(Guid StoreId, string Name, int Capacity, Guid RateItemId, bool IsActive = true);
public record SaveRoomRequest(Guid RoomTypeId, string Number, string? Floor = null, bool IsActive = true);
public record RoomStateRequest(RoomState State);

public record HotelBookingResponse(Guid Id, string Number, Guid StoreId, Guid RoomTypeId, string RoomTypeName, Guid? RoomId, string? RoomNumber,
    DateOnly Arrival, DateOnly Departure, int Nights, int Adults, int Children, HotelBookingState State, string GuestName, string? Phone, string? Email,
    Guid? CompanyPartnerId, string? Channel, decimal NightlyRate, string? Notes, string? DepositCardNumber, decimal Deposited, Guid? FolioTabId,
    DateOnly? PostedThrough, List<HotelGuestResponse> Guests, string? CompanyPartnerName = null);
public record HotelGuestResponse(Guid Id, string FullName, string? Nationality, string? DocumentType, string? DocumentNumber, DateOnly? BirthDate, bool IsPrimary);
public record SaveHotelBookingRequest(Guid StoreId, Guid RoomTypeId, DateOnly Arrival, DateOnly Departure, string GuestName, int Adults = 1, int Children = 0,
    Guid? RoomId = null, string? Phone = null, string? Email = null, Guid? CompanyPartnerId = null, string? Channel = null, decimal? NightlyRate = null,
    string? Notes = null);
public record SaveHotelGuestsRequest(List<HotelGuestResponse> Guests);
public record HotelInvoiceRequest(List<Guid> TabLineIds);
// The rooms of a store with their bookings over a period (the reservation chart).
public record HotelCalendarResponse(List<HotelCalendarRoomResponse> Rooms, List<HotelBookingResponse> Unassigned);
public record HotelCalendarRoomResponse(Guid RoomId, string Number, Guid RoomTypeId, string RoomTypeName, RoomState State, List<HotelBookingResponse> Bookings);
public record GuestRegisterRow(string BookingNumber, string RoomNumber, DateOnly Arrival, DateOnly Departure, string FullName, string? Nationality,
    string? DocumentType, string? DocumentNumber, DateOnly? BirthDate);

// ---- P5: venues and events ----

public record VenueResponse(Guid Id, Guid StoreId, string Name, int Capacity, bool IsActive);
public record SaveVenueRequest(Guid StoreId, string Name, int Capacity, bool IsActive = true);
public record EventBookingResponse(Guid Id, string Number, Guid StoreId, Guid VenueId, string VenueName, DateOnly Date, TimeOnly? From, TimeOnly? To,
    EventBookingState State, Guid? CustomerId, string CustomerName, string? Phone, Guid? PackageItemId, decimal? PricePerGuest, int GuestsEstimated,
    int? GuestsFinal, string? BanquetNotes, string? Notes, string? DepositCardNumber, decimal Deposited, Guid? TabId);
public record SaveEventBookingRequest(Guid StoreId, Guid VenueId, DateOnly Date, string CustomerName, int GuestsEstimated, TimeOnly? From = null,
    TimeOnly? To = null, Guid? CustomerId = null, string? Phone = null, Guid? PackageItemId = null, decimal? PricePerGuest = null,
    string? BanquetNotes = null, string? Notes = null);
public record EventBookingStateRequest(EventBookingState State);
public record FinalGuestsRequest(int Guests);

// ---- P5: ticketed events ----

public record TicketedEventResponse(Guid Id, Guid StoreId, string Name, DateTime StartsAt, int Capacity, bool IsActive, int Sold, int Used,
    List<EventTicketTypeResponse> TicketTypes);
public record EventTicketTypeResponse(Guid ItemId, int? Quota, int Sold, string? ItemName = null);
public record SaveTicketedEventRequest(Guid StoreId, string Name, DateTime StartsAt, int Capacity, List<SaveEventTicketTypeRequest> TicketTypes, bool IsActive = true);
public record SaveEventTicketTypeRequest(Guid ItemId, int? Quota = null);
public record TicketResponse(string Code, string EventName, DateTime StartsAt, string TicketType, TicketState State);
public record ScanTicketRequest(string Code);
// Valid (now used), AlreadyUsed (when) or Invalid (unknown, cancelled or another event's).
public record ScanTicketResponse(string Result, string? TicketType, DateTime? UsedAt);

