# Audit trail

Every change to an audited, company-scoped record is written to `audit_entries` automatically, in the
same transaction as the change. Reading it is admin-only (`RequireCompanyAccess(adminOnly: true)`).

## What is captured

`PakoDbContext.SaveChanges[Async]` calls `AuditCapture.Capture` (`Pako.Infrastructure/Audit`) after the
posted-entry immutability checks. It diffs the change tracker and adds one `AuditEntry` per changed
entity; the rows commit with the business change or not at all.

- Actions: `Created`, `Updated`, `Deleted`.
- `Changes` is JSON `[{field, oldValue, newValue}]`, values as invariant strings (enums by name, dates ISO).
- Skipped: unmodified saves, saves whose only changes are ignored fields, shadow properties, primary keys,
  concurrency tokens (`RowVersion`), `byte[]`.
- Redacted to `[redacted]`: any field whose name matches password, passcode, secret, token, apikey,
  credential, securitystamp, concurrencystamp, personalnumber, personalid, nationalid, idnumber, passport,
  a trailing `ssn`, or a `Pin` word (`AuditRedaction`). Salary, IBAN and similar financial fields are
  deliberately audited in clear: the trail is admin-only and recording who changed a salary is its purpose.
- Line tables are folded into the parent: a changed `InvoiceLine` yields an `Updated` row on the `Invoice`
  with a field `Lines` = `added 1, changed 2, removed 1`. Lines of a parent created in the same save add nothing.
  If the parent is not tracked (a line saved with only its foreign key set) the parent's `CompanyId` is
  looked up in the database and the `Updated` row is still written.
- `JournalEntry` postings also get `PostedFromIp` filled from the request (R28); the audit row carries the
  entry's `SourceDocumentId`.
- Semantic events keep using `AuditController.Stage(...)` (`Post`, `Payment`, `Refund`, role changes,
  `LockDateSet`, `HardLockSet`, `LockExceptionGranted`, `LockExceptionRevoked`). They sit beside the
  automatic `Updated` row and get the same chain, user, IP and request id.

## Covered entities

Company (incl. lock dates), Invoice, Bill, JournalEntry, Journal, Account, AccountGroup, Partner, Item,
TaxDefinition, CompanyAccountDefaults, AccountLockException, NumberSeries, PaymentMethod, CompanyBankAccount,
PayrollRun, PayrollAdjustment, Employee, EmployeeContract, EmployeeLoan, Department, StockDocument,
PurchaseOrder, SalesOrder, Reconciliation, CostCenter, Project, Warehouse, PriceList, Membership,
CompanyRole. Line folding: InvoiceLine, BillLine, JournalEntryLine, StockDocumentLine.

Not covered: firm-level memberships (no `CompanyId`), `StatutoryParameter` (firm-scoped), POS, hospitality,
construction and real-estate tables, attachments, and the platform log (`PlatformAuditEntry`, separate).

## Opting an entity in

Put `[Pako.Domain.Shared.Audited]` on the class. It needs a `CompanyId` property (or be `Company`). For a
line table put `[AuditedChild(typeof(Parent), nameof(ParentId))]`. Put `[AuditIgnore]` on counters or
bookkeeping properties that would only add noise (`Journal.SequenceNextNumber`, `JournalEntry.EntryHash`).
No registry, no migration.

## Ambient context

`IAuditContext` (`UserId`, `IpAddress`, `RequestId`, `SourceDocumentId`) is injected into the context;
`HttpAuditContext` fills it from the request. Without it (jobs, seeding, tests) rows are written with a null
user. The IP is the socket address: the API has no forwarded-headers handling, so behind a proxy it is the
proxy's address until that is configured.

## Tamper evidence

Each company has its own chain: `SequenceNumber` 1..n, `PrevHash`, `EntryHash = sha256(prevHash +
canonical fields)` (`AuditHashChain`). A save takes `pg_advisory_xact_lock` on the company, reads the last
link, and chains the new rows, so concurrent saves serialise per company and unique index
`(CompanyId, SequenceNumber)` is the backstop. The lock lasts to the end of the transaction, so a long
posting transaction holds back other writers to the same company's trail.

- App guard: modifying or deleting an `AuditEntry` through the context throws `AuditEntryImmutableException`.
- DB guard: trigger `trg_audit_entries_append_only` rejects `UPDATE` and `DELETE`. It does not stop
  `TRUNCATE` or a superuser disabling it; the chain catches either afterwards, except removal of the newest rows.
- Rows written before this feature have no sequence; `verify` reports them as `unchainedCount`.

## Endpoints

`api/companies/{companyId}/audit`, all admin-only. Filters on all list endpoints: `entityType`, `entityId`,
`userId`, `action`, `from`, `to` (inclusive UTC days), `search` (entity, action, field values, IP, request id,
user name or email).

| Route | Returns |
| --- | --- |
| `GET /` | `AuditEntryResponse[]` (`page`, `pageSize` max 200) |
| `GET /paged` | `PaginatedResponse<AuditEntryResponse>` |
| `GET /{id}` | `AuditEntryDetailResponse` (entry, parsed `fields`, `prevHash`) |
| `GET /verify` | `AuditVerifyResponse`: `valid`, `checkedCount`, `unchainedCount`, first broken sequence, id and reason (`SequenceGap`, `PrevHashMismatch`, `EntryHashMismatch`) |
| `GET /export` | Excel, language-aware via `ExportLabels`, 400 JSON when the range is inverted or over 20 000 rows |

Fixtures: `apps/web/src/mocks/audit-*.json`.

## Retention

Nothing is purged. The trail grows with every save of an audited entity. Any archiving must keep the chain
intact (export, then anchor the last hash somewhere outside the database); the append-only trigger has to be
lifted deliberately for that, which is the point.

## Known limits

- Tail truncation is undetectable: deleting the newest rows leaves a valid chain. Anchor the last hash
  outside the database to close this.
- `TRUNCATE`, or a superuser disabling `trg_audit_entries_append_only`, bypasses the DB guard. Removal in
  the middle breaks the chain and `verify` finds it; removal at the end does not.
- Rows written before this feature have no sequence. `verify` reports them as `unchainedCount` and `valid`
  stays true: they are not proven, only not contradicted.
- The advisory lock lasts until the transaction ends. When a caller wraps several saves in an ambient
  transaction, the company's lock is held for all of it. Two such transactions touching the same companies
  in different order can deadlock on other locks; within one save companies are locked in ascending order.
- The IP is the socket address. Behind a proxy it is the proxy's address until forwarded headers are
  configured, which is a deployment decision not made yet.
- Bulk seeding or import writes one audit row per entity, so a large import grows the trail by the same
  number of rows and holds the company lock for its transaction.
