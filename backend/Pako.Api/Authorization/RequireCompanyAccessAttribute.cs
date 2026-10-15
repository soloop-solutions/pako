using Microsoft.AspNetCore.Mvc;
using Pako.Domain.Hr;

namespace Pako.Api.Authorization;

// module: which department permission a ClientStaff user needs for this action (AccessModule.None
// = general reference data, read-only for staff). Ignored for every other membership role.
public class RequireCompanyAccessAttribute : TypeFilterAttribute
{
    public RequireCompanyAccessAttribute(bool writeAccess = false, bool adminOnly = false, AccessModule module = AccessModule.None)
        : base(typeof(CompanyAccessFilter))
    {
        Arguments = new object[] { writeAccess, adminOnly, module };
    }
}
