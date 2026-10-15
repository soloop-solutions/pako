namespace Pako.Domain.Hr;

public class EmployeePartnerAssignment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid PartnerId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
