using System.Reflection;
using Pako.Api.Contracts;

namespace Pako.Tests;

public class ContractOpenApiSchemaTests
{
    [Fact]
    public void ContractRecords_HaveNoNonNullableStructDefaults_BreaksOpenApiSchemaGeneration()
    {
        var offenders = new List<string>();
        var types = typeof(ReportLine).Assembly.GetTypes()
            .Where(t => t.IsPublic && t.Namespace == typeof(ReportLine).Namespace);

        foreach (var type in types)
        {
            foreach (var ctor in type.GetConstructors())
            {
                foreach (var p in ctor.GetParameters())
                {
                    var t = p.ParameterType;
                    if (!p.HasDefaultValue || !t.IsValueType || Nullable.GetUnderlyingType(t) is not null) continue;
                    if (t.IsPrimitive || t.IsEnum || t == typeof(decimal)) continue;
                    offenders.Add($"{type.Name}.{p.Name} ({t.Name})");
                }
            }
        }

        Assert.True(offenders.Count == 0, "Non-nullable struct defaults break /openapi/v1.json: " + string.Join(", ", offenders.Distinct()));
    }
}
