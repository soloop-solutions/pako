using Pako.Api.Services;

namespace Pako.Tests;

// Client request 2026-11-23: the logo and stamp uploaded through the company profile are stored as
// "/uploads/..." paths, and the invoice PDF must read them from the upload storage.
public class CompanyLogoTests
{
    [Fact]
    public void Bytes_ReadsAnUploadedImageFromTheUploadStorage()
    {
        var root = Path.Combine(Path.GetTempPath(), "pako-logo-" + Guid.NewGuid().ToString("N"));
        var companyId = Guid.NewGuid();
        var dir = Path.Combine(root, "companies", companyId.ToString());
        Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllBytes(Path.Combine(dir, "stamp.png"), new byte[] { 1, 2, 3 });
            var uploads = new UploadStorage(root);

            Assert.Equal(new byte[] { 1, 2, 3 }, CompanyLogo.Bytes($"/uploads/companies/{companyId}/stamp.png", uploads));
            Assert.Null(CompanyLogo.Bytes($"/uploads/companies/{companyId}/missing.png", uploads));
            Assert.Null(CompanyLogo.Bytes("/uploads/../../etc/passwd", uploads));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
