using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Controllers;

namespace Pako.Tests;

// A4 (v2 release): "there is no DELETE endpoint today" was an accident of nobody having written
// one, not a guarantee — this makes it one. A plain route-absence test can't fail today, but it
// exists to fail the moment anyone adds an [HttpDelete] action to either controller without
// noticing this guarantee. Corrections go through a return (A1/A2) or JournalEntry.Reverse()
// storno; an unposted, never-numbered Draft may be discarded via the dedicated POST .../discard
// action instead (see InvoicesController.Discard/BillsController.Discard), never a DELETE verb.
public class NoDeletionGuaranteeTests
{
    [Fact]
    public void InvoicesController_HasNoDeleteRoute()
    {
        AssertNoHttpDeleteAction(typeof(InvoicesController));
    }

    [Fact]
    public void BillsController_HasNoDeleteRoute()
    {
        AssertNoHttpDeleteAction(typeof(BillsController));
    }

    private static void AssertNoHttpDeleteAction(Type controllerType)
    {
        var hasDeleteAction = controllerType
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Any(m => m.GetCustomAttributes<HttpDeleteAttribute>().Any());

        Assert.False(hasDeleteAction,
            $"{controllerType.Name} must not expose an HTTP DELETE action — corrections go through a return or a storno, never deletion.");
    }
}
