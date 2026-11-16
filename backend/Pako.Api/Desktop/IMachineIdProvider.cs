using Microsoft.Win32;

namespace Pako.Api.Desktop;

public interface IMachineIdProvider
{
    string GetMachineGuid();
}

public sealed class WindowsMachineIdProvider(ILogger<WindowsMachineIdProvider> logger) : IMachineIdProvider
{
    private readonly Lazy<string> _guid = new(() => Read(logger));

    public string GetMachineGuid() => _guid.Value;

    private static string Read(ILogger logger)
    {
        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
                using var key = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
                if (key?.GetValue("MachineGuid") is string guid && guid.Length > 0) return guid;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not read the Windows MachineGuid");
            }
        }

        logger.LogWarning("MachineGuid unavailable; falling back to the machine name for the machine code");
        return Environment.MachineName;
    }
}
