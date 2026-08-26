# @pako/shared

Bridge package between the .NET backend's OpenAPI spec and the TypeScript frontend/mobile apps.
Will eventually hold:

- `src/generated/api-client.ts` — an NSwag-generated TypeScript client for `Pako.Api`. Currently a
  stub (`export {}`) so `apps/web` can import from `@pako/shared` without erroring.
- `src/schemas/*` — Zod schemas for request/response validation, hand-written and kept close to
  (but not required to exactly match) the backend's DTOs. `ledger.ts` has a starting set for the
  Ledger module (`Account`, `JournalEntry`, `JournalEntryLine`).

## Generating the real API client

Live and verified working (2026-08-26). To regenerate after backend contract changes:

1. Run `Pako.Api` locally (`dotnet run --launch-profile http` from `backend/Pako.Api/`, or it's
   often already running in the background during dev) so its OpenAPI JSON is being served. Per
   root `CLAUDE.md`, `Pako.Api` uses the built-in `Microsoft.AspNetCore.OpenApi` (not
   Swashbuckle), serving OpenAPI 3.1 JSON at `/openapi/v1.json`. The `http` launch profile in
   `Properties/launchSettings.json` binds `http://localhost:5248` — **not** the `5001`/`https`
   guessed here originally; use plain `http://127.0.0.1:5248` to avoid the ASP.NET Core dev
   HTTPS-cert trust prompt entirely.
2. From this package, run: `pnpm generate:api-client`

No global `dotnet tool install --global NSwag.ConsoleCore` is actually required — the `nswag` npm
devDependency ships its own bundled .NET runtime binaries
(`node_modules/nswag/bin/binaries/Net80`) and runs standalone. (A global `NSwag.ConsoleCore` tool
also works identically if already installed, e.g. via `nswag openapi2tsclient ...` directly on
PATH — both were verified to produce the same output against the live spec.)

That script runs:

```
nswag openapi2tsclient /input:http://127.0.0.1:5248/openapi/v1.json /output:src/generated/api-client.ts /template:Fetch /className:PakoApiClient /generateClientClasses:true /generateDtoTypes:true /typeStyle:Interface /dateTimeType:String /nullValue:Undefined
```

**Known gap**: `Pako.Api`'s built-in `Microsoft.AspNetCore.OpenApi` does not emit enum member
names (no `x-enumNames`/`x-enum-varnames` extension the way Swashbuckle does), so
`AccountType`/`AccountSubType`/`JournalType` all generate as plain `number` in the TS client, not
string literal unions. `apps/web` hand-maintains label maps for these
(`src/lib/ledger-enums.ts`) that must be kept in sync with the C# enum member order in
`Pako.Domain/Ledger/*.cs` by hand — regenerating the client does not catch a reordering. If this
becomes painful, look at NSwag's `/generateEnumMappingDescription` or switching enum serialization
to strings on the backend (`JsonStringEnumConverter`) rather than maintaining the mapping by hand.

Notes on the flags:

- `/template:Fetch` — generates a client on top of the native `fetch` API, no framework-specific
  runtime dependency (Angular/Axios/jQuery templates would pull in deps we don't want here).
- `/typeStyle:Interface` — plain TS interfaces for DTOs rather than classes, cheaper to import.
- `/dateTimeType:String` — keep dates as ISO strings; parse at the call site rather than forcing a
  `Date` object through serialization boundaries.
- `/nullValue:Undefined` — nullable C# properties become `T | undefined` rather than `T | null`.

`Pako.Api` lives in this monorepo at `backend/Pako.sln` (ASP.NET Core / .NET 10, see
`backend/CLAUDE.md`). A running-localhost `/input:` URL is the simplest approach and what's
documented above; if generation ever needs to run without the API up, NSwag can also point
`/input:` at a build-time OpenAPI JSON file on disk instead, once that project's build output
path is known.

Once generation is wired up for real, update `src/index.ts`'s re-export and drop the TODO
comments.
