using Microsoft.Extensions.Localization;

namespace Pako.Api.Services;

public class ExportLabels
{
    private const string Prefix = "Export_";

    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ExportLabels(IStringLocalizer<ErrorMessages> localizer)
    {
        _localizer = localizer;
    }

    public string this[string key]
    {
        get
        {
            var localized = _localizer[Prefix + key];
            return localized.ResourceNotFound ? key[(key.LastIndexOf('_') + 1)..] : localized.Value;
        }
    }

    public string Month(int month) => this["Month_" + month];
}
