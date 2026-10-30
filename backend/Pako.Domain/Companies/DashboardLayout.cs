namespace Pako.Domain.Companies;

// The company's dashboard: which widgets show, in what order, and how each is drawn. One row per
// company, edited by anyone with Settings: Edit. The widget list is stored as JSON because its
// shape is owned by the web catalogue; the API only validates keys and visual types.
public class DashboardLayout
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string WidgetsJson { get; set; } = "[]";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedByUserId { get; set; }
}
