using Microsoft.AspNetCore.Mvc;

namespace Pako.Api.Authorization;

public class RequireFirmAccessAttribute : TypeFilterAttribute
{
    public RequireFirmAccessAttribute(bool adminOnly = false) : base(typeof(FirmAccessFilter))
    {
        Arguments = new object[] { adminOnly };
    }
}
