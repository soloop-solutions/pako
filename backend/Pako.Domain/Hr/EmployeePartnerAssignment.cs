namespace Pako.Domain.Hr;

public class EmployeePartnerAssignment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid PartnerId { get; set; }

    // G11: from when commission on this partner belongs to this employee. Null = since before
    // dates were tracked.
    public DateOnly? AssignedFrom { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
