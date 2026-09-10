FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Pako.slnx .
COPY Pako.Api/Pako.Api.csproj Pako.Api/
COPY Pako.Domain/Pako.Domain.csproj Pako.Domain/
COPY Pako.Infrastructure/Pako.Infrastructure.csproj Pako.Infrastructure/
COPY Pako.Localization.Xk/Pako.Localization.Xk.csproj Pako.Localization.Xk/
RUN dotnet restore

COPY . .
RUN dotnet publish Pako.Api/Pako.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000

ENTRYPOINT ["dotnet", "Pako.Api.dll"]
