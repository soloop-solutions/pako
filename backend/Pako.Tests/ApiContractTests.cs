using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace Pako.Tests;

// The NSwag client only accepts the status codes an action declares: an action that answers 201
// Created without [ProducesResponseType(..., Status201Created)] is generated as "200 only", and the
// web treats every successful create as an error. Read from the controller sources, since a
// return status can't be seen by reflection.
public class ApiContractTests
{
    private static string ControllersDirectory([CallerFilePath] string thisFile = "") =>
        Path.Combine(Path.GetDirectoryName(thisFile)!, "..", "Pako.Api", "Controllers");

    [Fact]
    public void EveryActionAnswering201_DeclaresIt_SoTheGeneratedClientAcceptsIt()
    {
        var missing = new List<string>();
        foreach (var file in Directory.GetFiles(ControllersDirectory(), "*.cs"))
        {
            var source = File.ReadAllText(file).Replace("\r\n", "\n");
            // One chunk per action: from its [Http...] attribute to the next one.
            foreach (var action in Regex.Split(source, @"(?=\n    \[Http)").Skip(1))
            {
                var signature = action.IndexOf("\n    public ", StringComparison.Ordinal);
                if (signature < 0) continue;
                var attributes = action[..signature];
                if (!action[signature..].Contains("Status201Created")) continue;
                if (Regex.IsMatch(attributes, @"ProducesResponseType\(.*Status201Created")) continue;
                var name = Regex.Match(action[signature..], @"public [^(]*?(\w+)\(").Groups[1].Value;
                missing.Add($"{Path.GetFileNameWithoutExtension(file)}.{name}");
            }
        }
        Assert.True(missing.Count == 0, "Actions answering 201 without declaring it: " + string.Join(", ", missing));
    }
}
