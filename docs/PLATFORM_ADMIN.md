# Platform administration

Status: built on `feat/hr-sys-ado`, 2026-10-30, uncommitted.
- **Migration:** `AddPlatformAdministration`.
- **Tests:** 6 backend tests in `PlatformAdminTests`, plus web tests in `pages/platform/PlatformAdmin.test.tsx` and
  `pages/CompanySelect.test.tsx`.

The level above every company. A **platform administrator** runs PAKO itself. Company administrators,
by contrast, manage one company's users (see `USER_ACCESS_PLAN.md`).

## First run: the first administrator

`PlatformBootstrap` runs on API startup, after migrations. While the database has no active platform
administrator, it creates the account in `Platform:BootstrapAdmin` (`Email` and `Password`). If that
email already has an account, it is promoted and its password is never changed. As soon as any
administrator exists it does nothing, so it runs once per database and can't be used to take over a
working installation.
- **Development:** `appsettings.Development.json` sets `test@test.com` / `Test123!`, so everyone who
  pulls the code can sign in as an administrator.
- **Production:** the base `appsettings.json` leaves it empty. Set `Platform__BootstrapAdmin__Email` and
  `Platform__BootstrapAdmin__Password` as environment variables for the first start, sign in, change the
  password, then remove them.

## Who is a platform administrator

`AppUser.IsPlatformAdmin`:
- **First run:** see above (`Platform:BootstrapAdmin`).
- **Configuration:** any account listed in `Platform:AdminEmails` becomes an administrator the next time it
  signs in, and can't be demoted from the panel. The list is empty by default.
- **From the panel:** an administrator can appoint others under **Users**. An administrator can't disable
  their own account or remove their own rights.

The panel is at `/platform`, opened from the company list. Every `api/platform/*` endpoint checks
`IsPlatformAdmin` against the database on each request; the token is never trusted for this.

## No self-registration

- **Request an account:** "Register" is replaced by **Request an account** (`/request-account`, which calls
  `POST api/auth/account-requests`). The form asks for name, email, phone, city, firm, NRB, how many companies,
  and a message.
- **No account probing:** the reply is the same whether or not the email is already known.
- **Approval:** this creates the login, with no password and the company limit the administrator chooses. It
  emails a set-password link, which uses the same reset link as "forgot password" and is also shown to copy.
- **Rejection:** records the reason.
- **Configuration:** `Platform:AllowSelfRegistration` is `false` by default, so `POST api/auth/register` returns
  403. It is `true` only in `appsettings.Development.json`, because the e2e and demo-seed scripts register
  throwaway users.
- **Company invitations:** these still create accounts. That is deliberate, since a company admin vouches for
  their own staff. Invited people get a company limit of 0.

## Company limits

`AppUser.CompanyLimit`:
- **Meaning:** how many companies a person may create. `null` means no limit; platform administrators have no
  limit.
- **Counting:** `Company.CreatedByUserId` records the creator, and archived companies still count.
- **Enforcement:** `POST api/companies` refuses the next company with 403 `CompanyLimitReached`. The company
  list shows "2 of 3 companies used" and disables **New company** at the limit.
- **Existing data:** existing users have no limit. Existing companies were attributed to their earliest
  company administrator, or for a firm's company to the firm's earliest administrator.

## Modules per company

`Company.EnabledModules` is a flag set (`AppModule`):
- **Switchable:** Sales, Purchases, Accounting & bank, Reports, HR, and Payroll. Payroll needs HR.
- **Always on:** dashboard, partners, items, settings and users.
- **API:** a switched-off module is refused by `CompanyAccessFilter` with 403 `ModuleDisabled`.
- **Access levels:** `CompanyAccessContext.LevelFor` returns None for it, so menus, dashboard widgets and buttons
  disappear exactly as they do for a role without that area. "My HR" goes with the HR module.
- **Data:** nothing is deleted. Switching a module back on brings everything back.
- **Existing companies:** these kept every module.

## Disabling an account

`AppUser.IsDisabled`:
- **Sign-in:** refused (403 `AccountDisabled`).
- **Open sessions:** the global `ActiveUserFilter` refuses every request from a disabled account with 401, so it
  takes effect at once.
- **Data:** the person's companies and data stay.

## Usage overview

`GET api/platform/overview` returns:
- **Totals:** users, accountants, companies, pending requests, invoices in the last 30 days, and users signed in
  during the last 30 days.
- **One row per accountant:** an accountant is anyone allowed to create companies, or who has created some. The
  row covers the companies they created:
  - companies against their limit;
  - team members;
  - posted invoices, in total and in the last 30 days;
  - bills, employees and payroll runs;
  - last sign-in and last activity.
- **Drill-down:** clicking a row shows that accountant's companies and lets the administrator change their limit.

## Security hardening (audit, 2026-10-30)

- **Copyable links:** invitation and password-reset links are shown to the admin who created them only while
  email is not really sent (`Email:Mode=Log`). With SMTP they reach only the person they are for.
- **Company password resets:** a company admin may reset only staff who belong to that company alone. Never
  another administrator, a platform administrator, or someone with access to other companies.
- **Administrator addresses:** an invitation can't create the account for an address in `Platform:AdminEmails`.
- **Joining with an existing account:** this respects lockout and disabled accounts.
- **Sign-in on a locked account:** the answer is "locked" only when the password is right, so locking can't
  reveal which accounts exist.
- **Rate limiting:** the anonymous account endpoints (sign in, register, invitations, reset, account requests)
  are limited to `Platform:AuthRequestsPerMinute` (default 30) per client address.
- **Audit trail:** reading it needs company administrator rights.
- **Search and the invoice timeline:** these follow the caller's areas, the company's modules and the partner
  scope.
- **Disabled modules:** checked only after membership, so an outsider can't probe a company's modules.
- **Company limit:** the check holds a per-user lock, so parallel requests can't overshoot it.

## Activity (platform audit trail)

Every change made in the panel is written to `platform_audit_entries` in the same save as the change
itself:
- approving or rejecting an account request;
- changing a user's limit, disabled flag or administrator rights;
- switching a company's modules.

Each entry records who, when, the target (email or company name at the time), and the before and after
values. The **Activity** tab lists them, newest first (`GET api/platform/audit`). Entries are never
updated or deleted.

## Lists

Users, account requests and companies are paged on the server (`?page=&pageSize=&search=`, using the
standard `{ items, total, page, pageSize }` shape). Page, page size and search live in the URL. The tab
badge uses `GET api/platform/account-requests/pending-count`.

## Administrators from configuration

An administrator listed in `Platform:AdminEmails` is re-appointed at every sign-in, so the panel refuses
to remove their rights (`PlatformAdminFromConfig`). Remove them from the configuration instead.

## Not done yet

- **Email alerts:** administrators aren't notified of new requests; the panel shows a pending count.
