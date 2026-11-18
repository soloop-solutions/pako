using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Pako.Domain.Desktop;

namespace Pako.Tests.Desktop;

public sealed class LicenseCliInteropTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pako-license-interop-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private static string CliPath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tools", "pako-license", "cli.mjs");
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("tools/pako-license/cli.mjs not found above the test output folder");
    }

    private static (int Code, string Stdout, string Stderr) Node(params string[] args)
    {
        var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(CliPath());
        foreach (var a in args) start.ArgumentList.Add(a);
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();
        return (process.ExitCode, stdout.Result, stderr.Result);
    }

    private byte[] Keygen()
    {
        var (code, stdout, stderr) = Node("keygen", "--out", _dir);
        Assert.True(code == 0, stderr);
        var bytes = Regex.Matches(stdout, "0x([0-9a-f]{2})")
            .Select(m => byte.Parse(m.Groups[1].Value, NumberStyles.HexNumber))
            .ToArray();
        Assert.Equal(32, bytes.Length);
        return bytes;
    }

    [Fact]
    public void CliIssuedKey_IsVerifiedByLicenseVerifier()
    {
        var publicKey = Keygen();
        var machine = MachineCode.Compute("4c4c4544-0042-3510-8052-b4c04f4d3732");

        var (code, stdout, stderr) = Node("issue",
            "--private-key", Path.Combine(_dir, "pako-license-private.pem"),
            "--machine", machine,
            "--customer", "Çelik Ëndrra Sh.p.k.",
            "--expires", "2099-12-31");

        Assert.True(code == 0, stderr);
        var payload = LicenseVerifier.Verify(stdout.Trim(), publicKey);
        Assert.NotNull(payload);
        Assert.Equal(machine, payload!.MachineCode);
        Assert.Equal("Çelik Ëndrra Sh.p.k.", payload.Customer);
        Assert.Equal(new DateTimeOffset(2099, 12, 31, 23, 59, 59, TimeSpan.Zero), payload.ExpiresAt);
        Assert.True(Math.Abs((DateTimeOffset.UtcNow - payload.IssuedAt).TotalMinutes) < 5);

        var record = new DesktopLicenseRecord { TrialStartedAt = DateTimeOffset.UtcNow.AddDays(-30), LastSeenAt = DateTimeOffset.UtcNow, LicenseKey = stdout.Trim() };
        var state = LicenseState.Evaluate(record, machine, DateTimeOffset.UtcNow, publicKey);
        Assert.Equal(LicenseStatus.Licensed, state.Status);
        Assert.Equal(LicenseStatus.ReadOnly, LicenseState.Evaluate(record, "AAAA-AAAA-AAAA-AAAA", DateTimeOffset.UtcNow, publicKey).Status);
    }

    [Fact]
    public void CliIssuedKey_WithoutExpiry_HasNullExpiresAt()
    {
        var publicKey = Keygen();

        var (code, stdout, stderr) = Node("issue",
            "--private-key", Path.Combine(_dir, "pako-license-private.pem"),
            "--machine", "ABCD-EF23-4567-WXYZ",
            "--customer", "Acme");

        Assert.True(code == 0, stderr);
        var payload = LicenseVerifier.Verify(stdout.Trim(), publicKey);
        Assert.NotNull(payload);
        Assert.Null(payload!.ExpiresAt);
    }
}
