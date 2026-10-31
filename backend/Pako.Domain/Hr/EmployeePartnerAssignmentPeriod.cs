namespace Pako.Domain.Hr;

// G11: an assignment that has ended. EmployeePartnerAssignment holds only the current ones (it is
// the partner-scoping security boundary and stays exactly that); ended ones move here so
// commission can follow a partner that changed hands mid-month.
public class EmployeePartnerAssignmentPeriod
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid PartnerId { get; set; }

    // Null = assigned before dates were tracked.
    public DateOnly? AssignedFrom { get; set; }
    public DateOnly AssignedTo { get; set; }
}
