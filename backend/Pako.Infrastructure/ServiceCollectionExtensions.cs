using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pako.Domain.Invoicing;
using Pako.Domain.Payroll;
using Pako.Domain.Tax;

namespace Pako.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPakoInfrastructure(
        this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "Missing ConnectionStrings:Default. Set it in appsettings, or the ConnectionStrings__Default environment variable.");

        services.AddDbContext<PakoDbContext>(options => options.UseNpgsql(connectionString));
        services.AddScoped<ITaxComputationService, TaxComputationService>();
        services.AddScoped<IPayrollCalculationService, PayrollCalculationService>();
        services.AddScoped<IDocumentNumberService, DocumentNumberService>();

        return services;
    }
}
