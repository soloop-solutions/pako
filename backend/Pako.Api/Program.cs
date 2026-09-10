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
builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddPakoInfrastructure(builder.Configuration);
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

const string CorsPolicy = "CorsPolicy";
builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicy, policy =>
        policy.WithOrigins(
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "https://pakoerp.netlify.app")
            .AllowAnyHeader()
            .AllowAnyMethod());
});

builder.Services.AddIdentityCore<AppUser>()
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

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
