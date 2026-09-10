FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY backend/Pako.slnx .
COPY backend/Pako.Api/Pako.Api.csproj Pako.Api/
COPY backend/Pako.Domain/Pako.Domain.csproj Pako.Domain/
COPY backend/Pako.Infrastructure/Pako.Infrastructure.csproj Pako.Infrastructure/
COPY backend/Pako.Localization.Xk/Pako.Localization.Xk.csproj Pako.Localization.Xk/
RUN dotnet restore

COPY backend/ .
RUN dotnet publish Pako.Api/Pako.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000

ENTRYPOINT ["dotnet", "Pako.Api.dll"]
