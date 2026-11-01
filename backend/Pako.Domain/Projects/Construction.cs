namespace Pako.Domain.Projects;

// docs/ERP_VERTICALS_PLAN.md §1 (POS_PLAN P8) — construction, phase 1. A site is a contract with a
// client, carried on a ledger Project so every cost and revenue line tagged with it adds up per
// site. Cost codes budget the work; the bill of quantities (BoQ) prices it; progress bills
// (situacione) certify cumulative quantities and become invoices; materials leave the warehouse to
// the site on site-issue documents. Percentage of completion is cost-to-cost.
public enum SiteState
{
    Tender,
    Active,
    Completed,
    Closed,
}

public class ConstructionSite
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    // The ledger project every document of the site is tagged with.
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid ClientPartnerId { get; set; }
    public string? Address { get; set; }
    // Net of VAT.
    public decimal ContractValue { get; set; }
    // Share of each progress bill the client holds back until handover (0–100).
    public decimal RetentionPercent { get; set; }
    public decimal RetentionReleased { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public SiteState State { get; set; }
    // The item progress bills are invoiced as (its revenue account and VAT code).
    public Guid BillingItemId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<CostCode> CostCodes { get; set; } = new();
    public List<BoqLine> Boq { get; set; } = new();
}

public class CostCode
{
    public Guid Id { get; set; }
    public Guid SiteId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    // Budgeted cost, net of VAT.
    public decimal Budget { get; set; }
}

// A priced line of the bill of quantities (paramasë): quantity × unit price, net.
public class BoqLine
{
    public Guid Id { get; set; }
    public Guid SiteId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public int SortOrder { get; set; }
}

public enum ProgressBillState
{
    Draft,
    // Signed off by the client's supervisor; invoiced from here.
    Approved,
    Invoiced,
}

// A progress bill (situacion): the quantities done to date per BoQ line. This period is the
// cumulative less the last approved bill's.
public class ProgressBill
{
    public Guid Id { get; set; }
    public Guid SiteId { get; set; }
    public int Number { get; set; }
    public DateOnly PeriodTo { get; set; }
    public ProgressBillState State { get; set; }
    // Set when approved: this period's amount (net) and the retention held from it.
    public decimal Amount { get; set; }
    public decimal Retention { get; set; }
    public Guid? InvoiceId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ProgressBillLine> Lines { get; set; } = new();
}

public class ProgressBillLine
{
    public Guid Id { get; set; }
    public Guid ProgressBillId { get; set; }
    public Guid BoqLineId { get; set; }
    public decimal CumulativeQuantity { get; set; }
    // Set when approved.
    public decimal PreviousQuantity { get; set; }
    public decimal Amount { get; set; }
}
