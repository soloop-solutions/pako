using Microsoft.Win32;

namespace Pako.Api.Desktop;

public interface IMachineIdProvider
{
    string GetMachineGuid();
}

public sealed class WindowsMachineIdProvider : IMachineIdProvider
{
    public string GetMachineGuid()
    {
        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
                if (key?.GetValue("MachineGuid") is string guid && guid.Length > 0) return guid;
            }
            catch (Exception)
            {
            }
        }

        return Environment.MachineName;
    }
}
