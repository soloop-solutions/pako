using Microsoft.AspNetCore.Mvc;
using Pako.Domain.Hr;

namespace Pako.Api.Authorization;

// module: the role area a ClientStaff user needs (AccessModule.None = general reference data,
// read-only for staff). Level: View by default, Edit with writeAccess, Approve with approve (post,
// approve/reject, pay, cancel — docs/USER_ACCESS_PLAN.md §2). adminOnly = user management.
// Full-access memberships (firm, company admin) pass every level.
public class RequireCompanyAccessAttribute : TypeFilterAttribute
{
    public RequireCompanyAccessAttribute(bool writeAccess = false, bool adminOnly = false, AccessModule module = AccessModule.None, bool approve = false)
        : base(typeof(CompanyAccessFilter))
    {
        Arguments = new object[] { writeAccess, adminOnly, module, approve };
    }
}
