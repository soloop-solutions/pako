namespace Pako.Api.Services.Arbk;

public class ArbkNotConfiguredException() : Exception("ARBK lookup is not configured.");

public class ArbkUnavailableException(string message, Exception? inner = null) : Exception(message, inner);
