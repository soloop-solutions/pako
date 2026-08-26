namespace Pako.Domain.Fiscal;

public class FiscalProviderException : Exception
{
    public FiscalProviderException(string message) : base(message)
    {
    }

    public FiscalProviderException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
