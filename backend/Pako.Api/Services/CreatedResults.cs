using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Pako.Api.Services;

// A create action that shares its save path with the update: the save answers 200 and the create
// turns it into 201 Created (errors pass through).
public static class CreatedResults
{
    public static ActionResult<T> AsCreated<T>(this ActionResult<T> result) =>
        result.Result is OkObjectResult ok ? new ObjectResult(ok.Value) { StatusCode = StatusCodes.Status201Created } : result;
}
