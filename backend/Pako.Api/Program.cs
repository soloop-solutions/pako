using Microsoft.AspNetCore.DataProtection;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Localization;
using Microsoft.IdentityModel.Tokens;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Auth;
using Pako.Api.Middleware;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddLocalization(options => options.ResourcesPath = "Resources");
builder.Services.AddControllers(options => options.Filters.Add<Pako.Api.Authorization.ActiveUserFilter>());
builder.Services.Configure<Pako.Api.Auth.PlatformOptions>(builder.Configuration.GetSection(Pako.Api.Auth.PlatformOptions.Section));
builder.Services.AddAuthRateLimit(builder.Configuration.GetValue("Platform:AuthRequestsPerMinute", 30));
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi(options => options.AddDocumentTransformer<Pako.Api.Services.FormFileSchemaTransformer>());
builder.Services.AddPakoInfrastructure(builder.Configuration);
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

const string CorsPolicy = "CorsPolicy";
builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicy, policy =>
        policy.WithOrigins(
                "http://localhost:5173",
                "http://localhost:5180",
                "http://localhost:5181",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:5180",
                "http://127.0.0.1:5181",
                "http://localhost:5174",
                "http://127.0.0.1:5174",
                "https://pakoerp.netlify.app")
            .AllowAnyHeader()
            .AllowAnyMethod());
});

// Identity's password-reset tokens are data-protected. Keys default to the machine's user profile;
// a multi-instance deployment must persist them in one shared place (docs/USER_ACCESS_PLAN.md §5).
builder.Services.AddDataProtection().SetApplicationName("Pako");

builder.Services.AddIdentityCore<AppUser>(options =>
    {
        // docs/USER_ACCESS_PLAN.md §5.
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.Lockout.AllowedForNewUsers = true;
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<PakoDbContext>()
    .AddDefaultTokenProviders();

var jwtSection = builder.Configuration.GetSection("Jwt");
var jwtKey = jwtSection["Key"]
    ?? throw new InvalidOperationException("Missing Jwt:Key. Set it in appsettings, or the Jwt__Key environment variable.");
var jwtIssuer = jwtSection["Issuer"] ?? "Pako";
var jwtAudience = jwtSection["Audience"] ?? "Pako";
var jwtExpiryMinutes = int.TryParse(jwtSection["ExpiryMinutes"], out var minutes) ? minutes : 60;

builder.Services.AddSingleton(new JwtOptions
{
    Key = jwtKey,
    Issuer = jwtIssuer,
    Audience = jwtAudience,
    ExpiryMinutes = jwtExpiryMinutes
});
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<Pako.Api.Services.NumberSeriesService>();
builder.Services.AddScoped<Pako.Api.Authorization.CompanyAccessContext>();
builder.Services.AddScoped<Pako.Api.Services.PayrollRunComposer>();
builder.Services.AddScoped<Pako.Api.Services.LedgerAggregator>();
builder.Services.AddScoped<Pako.Api.Services.TaxReportService>();
builder.Services.AddScoped<Pako.Api.Services.VendorLedgerService>();
builder.Services.AddSingleton<Pako.Api.Services.ActionTokenService>();
builder.Services.AddScoped<Pako.Api.Services.PayrollParameterProvider>();
builder.Services.AddScoped<Pako.Api.Services.PayslipDocumentService>();
builder.Services.AddScoped<Pako.Api.Services.LeaveService>();
builder.Services.AddScoped<Pako.Api.Services.EmployeeLoanService>();
builder.Services.AddScoped<Pako.Api.Services.CommissionService>();
builder.Services.AddScoped<Pako.Api.Services.ExpenseClaimService>();
builder.Services.AddScoped<Pako.Api.Services.FirmPayrollService>();
builder.Services.AddScoped<Pako.Api.Services.TimesheetService>();
builder.Services.AddScoped<Pako.Api.Services.PartnerStatementService>();
builder.Services.AddScoped<Pako.Api.Services.UserAdminService>();
builder.Services.AddScoped<Pako.Api.Services.DashboardService>();
builder.Services.AddScoped<Pako.Api.Services.PlatformAdminService>();
builder.Services.AddScoped<PlatformBootstrap>();

// E7/E8: email outbox + background jobs. Email:Mode=Log (default) never sends; Smtp needs
// Email:Host etc., with the password from the environment (Email__Password).
builder.Services.Configure<Pako.Api.Services.Notifications.EmailOptions>(builder.Configuration.GetSection(Pako.Api.Services.Notifications.EmailOptions.Section));
if (string.Equals(builder.Configuration["Email:Mode"], "Smtp", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddTransient<Pako.Api.Services.Notifications.IEmailSender, Pako.Api.Services.Notifications.SmtpEmailSender>();
}
else
{
    builder.Services.AddTransient<Pako.Api.Services.Notifications.IEmailSender, Pako.Api.Services.Notifications.LogEmailSender>();
}
builder.Services.AddScoped<Pako.Api.Services.Notifications.NotificationOutbox>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.NotificationRenderer>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.NotificationDispatcher>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.JobLockService>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.IScheduledJob, Pako.Api.Services.Notifications.EdiDeadlineReminderJob>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.IScheduledJob, Pako.Api.Services.Notifications.ContractRemindersJob>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.IScheduledJob, Pako.Api.Services.Notifications.LeaveCarryOverJob>();
builder.Services.AddScoped<Pako.Api.Services.Notifications.IScheduledJob, Pako.Api.Services.Notifications.FirmPayrollDigestJob>();
if (builder.Configuration.GetValue("BackgroundJobs:Enabled", true))
{
    builder.Services.AddHostedService<Pako.Api.Services.Notifications.BackgroundJobsHostedService>();
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PakoDbContext>();
    db.Database.Migrate();
    // The first administrator, once per database (docs/PLATFORM_ADMIN.md "First run").
    await scope.ServiceProvider.GetRequiredService<PlatformBootstrap>().RunAsync();
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler();

var supportedCultures = new[] { new CultureInfo("en"), new CultureInfo("sq") };
app.UseRequestLocalization(new RequestLocalizationOptions
{
    DefaultRequestCulture = new RequestCulture("en"),
    SupportedCultures = supportedCultures,
    SupportedUICultures = supportedCultures
});

app.UseHttpsRedirection();

app.UseCors(CorsPolicy);

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
