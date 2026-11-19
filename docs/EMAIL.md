# Email delivery

Every email PAKO sends goes through one pipeline, and in production through **one HTTP email API:
[Resend](https://resend.com)**.
This covers invitations, password resets, payslips with PDF, leave, expense and profile-change alerts,
contract, probation and EDI reminders, portal orders, appointment and repair notices, invoices to
customers, and the test email.

```
business change ──(same SaveChanges)──▶ NotificationOutbox ──▶ notifications table
BackgroundJobsHostedService ──▶ NotificationDispatcher (claim: FOR UPDATE SKIP LOCKED, 5-min lease)
   ──▶ NotificationRenderer (resx Email_{Template}_Subject/_Body, row's culture)
   ──▶ attachments (PayslipLine → payslip PDF, Invoice → invoice PDF)
   ──▶ IEmailSender: ApiEmailSender | SmtpEmailSender | LogEmailSender
```

## Configuration

Set these as environment variables. Never put the API key in a committed file.

| Variable | Value |
| --- | --- |
| `Email__Mode` | `Api` in production. `Log` (the default) only writes mail to the log. `Smtp` is still supported. |
| `Email__Api__Url` | Optional. Defaults to Resend's `https://api.resend.com/emails`. |
| `Email__Api__ApiKey` | The Resend API key (`re_…`), with "Sending access" on the PAKO domain. Sent as `Authorization: Bearer <key>`. |
| `Email__Api__AuthHeader` | Optional. Set e.g. `X-Api-Key` to send the raw key in that header instead. |
| `Email__Api__TimeoutSeconds` | Optional, default 15. |
| `Email__FromAddress` | The no-reply address on the PAKO domain, e.g. `no-reply@<pako domain>`. The domain must be verified in Resend. |
| `Email__FromName` | Default `PAKO`. |
| `Email__AppBaseUrl` | The web app's https URL. Links in emails (invitations, resets, portal) point there. `http://localhost`/`127.0.0.1` is accepted for local testing only. |

The API **refuses to start** in `Api` or `Smtp` mode when the configuration can't work: no URL or key,
a non-https URL, a `.local` sender, or a non-https `AppBaseUrl`. The error names each problem. A broken
deploy fails loudly instead of queueing mail that never leaves.

There is **no Reply-To**. Customer emails name the company in the subject and body and tell the reader
to contact the company directly.

The desktop app (`apps/desktop/src/api.ts`) stays in `Log` mode.

### The request PAKO sends

One POST per recipient, in Resend's
[send-email](https://resend.com/docs/api-reference/emails/send-email) shape. `ApiEmailSender.Payload` is the
only place that knows it:

```json
{
  "from": "PAKO <no-reply@…>",
  "to": ["customer@example.com"],
  "subject": "…",
  "html": "…",
  "text": "…",
  "attachments": [{ "filename": "invoice-01-2026.pdf", "content": "<base64>" }]
}
```

The `Idempotency-Key` header carries the notification id. Resend keeps it for 24 h, so a retry after a
timeout can't send twice. Resend refuses a reused key with a *different* body
(`409 invalid_idempotent_request`). For that reason the invoice and payslip PDFs carry fixed metadata
dates and render to the same bytes on every attempt. Keep it that way: don't print "generated at <now>"
into an emailed PDF.

### What the answer means

| Answer | Treated as | Result |
| --- | --- | --- |
| 2xx | sent | `Sent` |
| 408, 429 (rate limit, daily quota), 5xx, timeout, network error | temporary | retried after 1, 2, 4, 8, 16 min, then `Failed` after 6 attempts |
| other 4xx: 400/422 invalid field or attachment, 401/403 bad key, unverified domain, monthly quota | permanent (`PermanentEmailFailure`) | `Failed` at once with Resend's reason |
| attachments over 10 MB, invoice deleted | permanent | `Failed` at once |

A failed row keeps its `LastError`. **Settings → Notifications** lists it, and **Retry** puts it back in
the queue. On an invoice, the "Sent" list shows each email's state and offers Retry.

## Checking the setup

- **Settings → Notifications → Send test email** sends to the signed-in admin's own address
  (`POST api/companies/{id}/notifications/test`). It goes out at once, not through the queue, and shows
  the provider's answer.
- Platform admins: `POST api/platform/email/test` with `{ "to": "…" }`.

## Domain authentication (SPF / DKIM / DMARC)

In Resend, go to **Domains → Add domain** and add the DNS records it lists to the PAKO domain. They are:
- a DKIM TXT record;
- SPF records, an MX and a TXT, on the `send.` subdomain.

Wait until the domain shows **Verified**. Until then Resend refuses the From address (`403`), and PAKO
marks those emails Failed with that reason.

Then add DMARC yourself: a `_dmarc.<domain>` TXT record. Start with `p=none; rua=mailto:…` to watch
reports, then tighten it to `quarantine`.

Before the domain is verified you can still try the setup with `Email__FromAddress=onboarding@resend.dev`.
Resend then delivers only to the address of the Resend account itself.

## Invoices by email

- `GET api/companies/{id}/invoices/{invoiceId}/pdf` (Sales read) and
  `GET api/portal/companies/{id}/invoices/{invoiceId}/pdf` (the customer's own posted documents) return
  the PDF.
  - Rendered by `InvoicePdfRenderer` from `InvoiceDocumentService`, the same amounts as the invoice
    screen.
- `POST api/companies/{id}/invoices/{invoiceId}/email` (Sales write) takes
  `{ to?: string[], message?: string, culture?: "sq" | "en" }`.
  - Posted documents only.
  - `to` defaults to the customer's email.
  - At most 5 recipients; the message is at most 2000 characters.
  - Queues template `InvoiceSent` with `AttachmentKind = "Invoice"`. The PDF is rendered at send time
    in the email's language.
  - Audit-staged as `Invoice / Email`.
- `GET …/invoices/{invoiceId}/emails` and `POST …/emails/{emailId}/retry` give the history and the
  retry.
- `InvoiceSent` and `TestEmail` are user-initiated, so they are not in `CompanyConfigurable` and can't
  be switched off.

## Not built yet

These are not built yet:
- bounce and complaint webhooks (Resend's `email.bounced` / `email.complained`);
- per-company senders;
- automatic or scheduled invoice sending;
- statement-of-account emails.
