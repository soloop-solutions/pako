using Microsoft.AspNetCore.Mvc;

namespace Pako.Api.Authorization;

public class RequireCompanyAccessAttribute : TypeFilterAttribute
{
    public RequireCompanyAccessAttribute(bool writeAccess = false, bool adminOnly = false) : base(typeof(CompanyAccessFilter))
    {
        Arguments = new object[] { writeAccess, adminOnly };
    }
}
