# Bank statement import

Users copy their bank statement into a PAKO Excel template and upload it. PAKO matches each line to the
customer invoice or supplier bill it pays. When the user confirms, PAKO records the payments.

**Scope: bank statements only.**
- Money in pays a posted customer invoice or debit note.
- Money out pays a posted supplier bill.
- Nothing is posted to any other account. A line that pays no document stays **open**: a bank fee, a
  transfer, a salary, a tax.
  - The user enters it by hand (a journal entry) and marks the line **Ignored**.

## Where

**Bank & Cash → Bank statements** (`/bank-statements`, Accounting module).

| Action | Access needed |
| --- | --- |
| See statements | Accounting read |
| Import, choose matches, delete a draft | Accounting write |
| Confirm, record a line later | Accounting approve |

Confirm and record post payments, so they need approve.

## The template

`GET api/companies/{id}/bank-statements/template?bankAccountId=` returns an `.xlsx` in the request
language. The bank account is any active ledger account of sub-type `Bank`. The layout is fixed, so a
file filled in Albanian reads the same as one in English:

| Cell | Content |
| --- | --- |
| A1 | Title |
| H1 (hidden column) | Marker `PAKO-BANK-STATEMENT-1`. Without it the upload is refused: "not the PAKO template". |
| H2 (hidden column) | The bank account id. A template downloaded for another account is refused. |
| B3, B4 | Account name. The IBAN only when the company profile has exactly one. |
| B5, B6 | Period from / to. Optional: the line dates are used when blank. Lines outside the period are refused. |
| B7 | Opening balance, pre-filled with PAKO's current ledger balance of the account. Required. |
| B8 | Closing balance. Required. |
| Row 10 | Headers: Date · Description · Partner (name or fiscal no.) · Reference (invoice/bill no.) · Money in · Money out |
| Row 11 onwards | One bank movement per row, at most 2,000 rows. 20 blank rows in a row end the list. |

A second sheet holds the instructions.

**What the reader accepts:**
- Dates as real Excel dates or `dd.mm.yyyy`, `d.m.yyyy`, `dd/mm/yyyy` or `yyyy-mm-dd`.
- Amounts as numbers or text in any of these forms: `1.234,56`, `1,234.56`, `1234,56`, `1 234,50 €`.
- Exactly one of Money in / Money out per row, and it must be greater than 0.

**Errors:** any row error refuses the whole file and returns every problem with its row number.
Nothing is saved.

## Import → Draft (the preview)

`POST …/bank-statements/import` (multipart: `file`, `bankAccountId`, at most 5 MB) saves a **Draft**
statement and suggests a match for each line. The rules are in `BankStatementMatcher`, which is pure
and unit-tested:

1. **The reference is the document number:** the invoice number or the bill's vendor reference.
   - It can also contain the number as a whole word ("Pagesa fat. 01/2026"), for numbers of 3+
     characters.
   - The document must be of the right kind and still open.
2. **Otherwise, the partner plus the exact amount.**
   - The partner is found by fiscal/VAT number, then exact name, then the only name containing the
     text.
   - The line matches when exactly one open document of that partner has exactly that amount open.
3. **Otherwise, the partner is known:** the status is **Choose**, and the user picks from the partner's
   open documents.
4. **Otherwise: No match.**

Lines are matched in file order and share what is open on each document. Two lines paying the same
invoice never apply more than it has open. Any extra on a line is not posted.

**Duplicate protection:**
- **The same file** is refused, by SHA-256 and a unique `(CompanyId, FileHash)` index.
- **The same movement in another statement** is flagged *Already imported* and starts Ignored. The
  fingerprint is account + date + amounts + reference + the occurrence number within the file. The user
  can reopen the line.

## Review and confirm

- **Balance check:** `GET …/{id}` returns the lines with their status: Ready, Choose, No match, Ignored
  or Paid.
  - `BalanceDifference` = opening + in − out − closing. It must be 0 to confirm.
  - `LedgerOpeningBalance`: PAKO's balance of the account the day before the period. It is shown as a
    warning when it differs from the statement's opening balance.
- **Choosing a match:** `GET …/{id}/lines/{lineId}/candidates?search=` lists the open documents of the
  right kind: the line's partner first, then the closest amount.
  - `PUT …/{id}/lines/{lineId}` takes `{ invoiceId | billId, amount? }` to choose a match, `{ ignore: true }`
    to ignore the line, or `{}` to clear it.
  - The amount defaults to the smaller of the line amount and the open amount.
- **Confirm:** `POST …/{id}/confirm` records each Ready line through `PaymentRecorder`, in one
  transaction.
  - `PaymentRecorder` is the same code as **Record payment** on the invoice or bill: a Bank-journal entry
    (bank against the partner's AR/AP line), posted, then reconciled.
  - The first failure (a lock date, a document paid meanwhile) rolls everything back and names the row.
  - The statement becomes Confirmed, and an audit event `BankStatement / Confirm` is written.
- **Later:** on a Confirmed statement, an open line can still be matched and recorded with
  `POST …/{id}/lines/{lineId}/post`.
- **Delete:** `DELETE …/{id}` deletes a Draft only.

Open amounts come from `BankStatementService.OpenBookAsync`. The rule is the one the invoice and bill
balance endpoints use: the document's own AR (debit) / AP (credit) line, less reconciliations. A test
checks that the two agree after a partial payment.

## Not built yet

These are not built yet:
- **Lines to other accounts** (bank fees, transfers, salaries). This would need an "Account" column and
  a rule for which accounts are allowed.
- **Refunds:** money out to customers against credit notes, and money in from suppliers. Down-payment
  invoices are also not matched yet.
- **The bank's own export** (CSV, CAMT.053, MT940) with column mapping. The bank formats were left out on
  purpose for now.
- **Undoing a confirmed payment.** There is no payment reversal anywhere in PAKO yet.
- **Settlement entries get no journal number**, the same as Record payment (CLAUDE.md hazard 7).
- **Per-user lock exceptions** are not applied to payments, the same as Record payment.
- **Foreign-currency statements.** Amounts are taken in the company currency.
