# Users, roles and the administration dashboard

Status: built on `feat/hr-sys-ado`, 2026-10-30, uncommitted.
- **Tests:** 11 backend tests in `UserAdminTests` plus updated scoping tests, 5 web tests, and
  `scripts/e2e/access.py`, which makes 24 checks over HTTP.
- **Migration:** `AddUserRolesAndInvitations`. It was applied to the dev database, and every
  existing staff login got its converted role.

Still open:
- **Data Protection keys** need one shared persisted store before running more than one API
  instance, or reset links break between instances.
- **SMTP** must be configured before invitation emails go out. Until then, admins copy the link.
- **The "Read only (legacy)" viewer role** stays as it is. Admins can move those users to the
  built-in *Read only* role.

Two choices were made with the product owner:

- **Roles**: one role per user, and the admin builds the roles.
- **Levels**: View / Edit / Approve in each area.

## 1. What the references do

| | QuickBooks Online | Odoo | PAKO (this plan) |
| --- | --- | --- | --- |
| Who manages users | Primary/company admins only | Users with the *Administration: Access Rights* group | Company admins, firm admins, and anyone whose role has **Users: Approve** |
| Unit of permission | User type (Standard all/limited/none, Reports only, Company admin); in Advanced, **custom roles** per area | **Groups per app** (User: own documents / all documents / Administrator), assigned per user | **Roles per company**: one level per area, one role per user |
| Granularity | Areas (sales, expenses, banking, payroll, reports, lists, settings), and View/Create/Edit/Delete in some of them | Model access (read/write/create/unlink), with **record rules** on top | Areas × **None / View / Edit / Approve**, plus a partner scope |
| Record-level limits | "Limited: customers only" or "suppliers only" | Record rules ("own documents", allowed companies) | **Partner scope**: all partners, or only the partners assigned to the user's employee record |
| Payroll privacy | Payroll is its own area; reports-only users never see payroll | Payroll and contracts are a separate app with their own groups | **Payroll is its own area**. Without it, salary and IBAN are hidden on employee records |
| Getting a user in | Emailed invitation; the user creates or links an Intuit account | The admin creates the user; an invitation email sets the password | **Invitation link**, emailed and copyable. The person sets a password or links an existing account |

Sources:
- [QuickBooks user types](https://quickbooks.intuit.com/learn-support/en-us/set-up-users/user-types-in-quickbooks-online/01/186238)
- [QuickBooks custom roles](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/add-manage-custom-roles-quickbooks-online-advanced/L8Ugph7xl_US_en_US)
- [Odoo access rights](https://www.odoo.com/documentation/saas-18.2/applications/general/users/access_rights.html)

## 2. Areas and levels

Levels:
- **View**: read.
- **Edit**: create and change drafts, and delete drafts.
- **Approve**: Edit, plus post, approve or reject, pay, record payments, cancel or reverse, and
  anything that cannot be undone.

| Area | Screens | Approve covers |
| --- | --- | --- |
| Sales | Sales invoices, returns, proforma, customers | Post, record a payment, apply a credit note or down payment, discard |
| Purchases | Bills, purchase returns, vendors | Post, record a payment, apply a credit note, discard |
| Partners | The partner register, partner statement | — |
| Items | The item register | — |
| Accounting | Ledger, journal entries, chart of accounts, cost centers, reconciliation, journals, projects, withholding tax | Post or reverse journal entries, reconcile |
| Reports | Reports, VAT and ATK books, year end | — |
| HR | Employees (except pay data), departments, leave, timesheets, expense claims | Approve or reject leave, expense claims and bank-account changes; approve timesheet months; leave carry-over |
| Payroll | Payroll runs and adjustments, salaries and IBAN, loans, commission, statutory parameters | Approve, post or pay a run; issue or cancel a loan |
| Settings | Company profile, numbering, payment methods, notifications | Lock dates |
| Users | The administration dashboard: users, invitations, roles | Invite, change roles, deactivate, remove |

**My HR** (self-service) is not an area. Anyone linked to an employee record always has it.

Membership roles:
- **Firm admins and accountants** keep full access to their firm's companies.
- **ClientAdmin** shows up as the built-in *Administrator* role: everything, including Users.
- **ClientViewer** is kept for old data and shows as *Read only (legacy)*.
- **Every other company user is `ClientStaff` with a `CompanyRole`.** The employee link is now
  optional.

## 3. Built-in roles (seeded per company, all editable or copyable)

| Role | Sales | Purch. | Partners | Items | Acct. | Reports | HR | Payroll | Settings | Users |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Accountant | Approve | Approve | Edit | Edit | Approve | View | View | Approve | Edit | — |
| Sales | Edit | — | Edit | View | — | View | — | — | — | — |
| Purchasing | — | Edit | Edit | Edit | — | View | — | — | — | — |
| HR officer | — | — | — | — | — | — | Approve | — | — | — |
| Payroll officer | — | — | — | — | — | View | Approve | Approve | — | — |
| Reports only | — | — | — | — | — | View | — | — | — | — |
| Read only | View | View | View | View | View | View | View | — | View | — |
| Employee (self-service only) | — | — | — | — | — | — | — | — | — | — |

## 4. Migration from department permissions

`AddUserRolesAndInvitations` converts every department used by a `ClientStaff` user into a role
named "Department: <name>" with the same levels:
- the department's HR level becomes HR, and also Payroll, because HR used to include payroll;
- Items becomes View;
- Settings and Users become None.

It then assigns that role to those users, so no user loses or gains access. Department
permission columns are no longer read; they stay in the schema, since changes are additive.

## 5. Security rules

- **Changes take effect on the next request.** Every request re-checks the membership:
  deactivating a user or changing their role works at once, without waiting for the token to
  expire.
- **Invitation tokens** are random 256-bit values. Only their SHA-256 hash is stored, and they
  expire after 7 days and work once.
- **Accepting for an existing account** needs that account's password.
- **Password reset** uses ASP.NET Identity reset tokens, and the response is the same whether or
  not the email exists.
- **Lockout**: 5 failed logins lock the account for 15 minutes.
- **Admins can't lock the company out.** The last active administrator can't be deactivated,
  demoted or removed, and an admin can't deactivate themselves.
- **Every user and role change is recorded** in the audit log.
