using System.Text;
using System.Text.Json;
using Pako.Domain.Desktop;

namespace Pako.Tests.Desktop;

public class LicenseVerifierTests
{
    private static readonly DateTimeOffset Issued = new(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Verify_AcceptsKeySignedByPrivateKey()
    {
        var keys = new LicenseTestKeys();
        var payload = new LicensePayload("AAAA-BBBB-CCCC-DDDD", "Acme", Issued, Issued.AddYears(1));

        var result = LicenseVerifier.Verify(keys.Issue(payload), keys.PublicKey);

        Assert.NotNull(result);
        Assert.Equal("AAAA-BBBB-CCCC-DDDD", result!.MachineCode);
        Assert.Equal("Acme", result.Customer);
        Assert.Equal(Issued.AddYears(1), result.ExpiresAt);
    }

    [Fact]
    public void Verify_RejectsTamperedPayload()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload("AAAA-BBBB-CCCC-DDDD", "Acme", Issued, null));
        var signature = key.Split('.')[1];
        var forged = JsonSerializer.SerializeToUtf8Bytes(new LicensePayload("ZZZZ-ZZZZ-ZZZZ-ZZZZ", "Acme", Issued, null));

        Assert.Null(LicenseVerifier.Verify(LicenseTestKeys.Encode(forged) + "." + signature, keys.PublicKey));
    }

    [Fact]
    public void Verify_RejectsWrongKey()
    {
        var signer = new LicenseTestKeys();
        var other = new LicenseTestKeys();
        var key = signer.Issue(new LicensePayload("AAAA-BBBB-CCCC-DDDD", "Acme", Issued, null));

        Assert.Null(LicenseVerifier.Verify(key, other.PublicKey));
    }

    [Theory]
    [InlineData("")]
    [InlineData("nodothere")]
    [InlineData("!!!.???")]
    [InlineData("a.b.c")]
    [InlineData(".")]
    public void Verify_RejectsGarbage(string key)
    {
        var keys = new LicenseTestKeys();

        Assert.Null(LicenseVerifier.Verify(key, keys.PublicKey));
    }

    [Fact]
    public void Verify_RejectsOversizedKey()
    {
        var keys = new LicenseTestKeys();

        Assert.Null(LicenseVerifier.Verify(new string('A', 4097), keys.PublicKey));
    }

    [Fact]
    public void Verify_RejectsTruncatedSignature()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload("AAAA-BBBB-CCCC-DDDD", "Acme", Issued, null));
        var parts = key.Split('.');

        Assert.Null(LicenseVerifier.Verify(parts[0] + "." + parts[1][..(parts[1].Length / 2)], keys.PublicKey));
    }

    [Fact]
    public void Verify_RejectsSignedNonJson()
    {
        var keys = new LicenseTestKeys();

        Assert.Null(LicenseVerifier.Verify(keys.Sign(Encoding.UTF8.GetBytes("not json")), keys.PublicKey));
    }

    [Fact]
    public void MachineCode_IsStableAndGrouped()
    {
        var a = MachineCode.Compute("guid-1");

        Assert.Equal(a, MachineCode.Compute("guid-1"));
        Assert.NotEqual(a, MachineCode.Compute("guid-2"));
        Assert.Matches("^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$", a);
    }
}
