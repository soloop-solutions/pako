#!/usr/bin/env python3
"""Users, roles and invitations end-to-end check (docs/USER_ACCESS_PLAN.md) against a running API.

An admin invites a user with a role, the user accepts and works within it (Edit drafts, but not
Approve/post), the admin upgrades the role, deactivates and reactivates the user, and resets
their password. Fresh users and company each run. Standard library only.

    python3 scripts/e2e/access.py                  # API at http://127.0.0.1:5248
    PAKO_API=http://host:port python3 scripts/e2e/access.py
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
RUN = uuid.uuid4().hex[:8]
PASSWORD = "E2e-Passw0rd!"
CHECKS = 0
APPROVE, EDIT, VIEW, NONE = 3, 2, 1, 0


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status


def call(method, path, token=None, body=None):
    headers = {"Accept-Language": "en", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, f"{method} {path}: " + error.read().decode(errors="replace")) from None


def check(condition, message):
    global CHECKS
    if not condition:
        print(f"FAIL  {message}")
        sys.exit(1)
    CHECKS += 1
    print(f"ok    {message}")


def status_of(fn):
    try:
        fn()
        return 200
    except ApiError as error:
        return error.status


def token_from(url, name="token"):
    return urllib.parse.parse_qs(urllib.parse.urlparse(url).query)[name][0]


def main():
    print(f"PAKO access e2e against {API} (run {RUN})")
    admin_email = f"admin.{RUN}@e2e.test"
    call("POST", "/api/auth/register", body={"email": admin_email, "password": PASSWORD})
    admin = call("POST", "/api/auth/login", body={"email": admin_email, "password": PASSWORD})["token"]
    company = call("POST", "/api/companies", admin, {"name": f"Access Co {RUN}", "enabledProfiles": 17})
    c = f"/api/companies/{company['id']}"

    roles = {r["builtInKey"]: r for r in call("GET", f"{c}/admin/roles", admin)}
    check({"accountant", "sales", "purchasing", "hr", "payroll", "reports", "readonly", "employee"} <= set(roles),
          "built-in roles are seeded")
    check(roles["sales"]["levels"]["sales"] == EDIT and roles["accountant"]["levels"]["sales"] == APPROVE,
          "Sales role edits sales; Accountant approves")

    # ---- Invite → accept ----
    clerk_email = f"clerk.{RUN}@e2e.test"
    invited = call("POST", f"{c}/admin/invitations", admin,
                   {"email": clerk_email, "fullName": "Cleo Clerk", "administrator": False, "roleId": roles["sales"]["id"]})
    token = token_from(invited["inviteUrl"])
    check(invited["user"]["status"] == "Invited", "invitation created with a link")
    info = call("GET", f"/api/auth/invitations/{urllib.parse.quote(token)}")
    check(info["email"] == clerk_email and not info["accountExists"], "the link shows who is invited and to which company")
    clerk = call("POST", "/api/auth/invitations/accept", body={"token": token, "fullName": None, "password": PASSWORD})["token"]
    check(status_of(lambda: call("POST", "/api/auth/invitations/accept", body={"token": token, "password": PASSWORD})) == 400,
          "the link works only once")

    access = call("GET", f"{c}/my-access", clerk)
    check(access["roleName"] == roles["sales"]["name"] and not access["canManageUsers"], "the clerk works under the Sales role")

    # ---- Edit vs Approve ----
    partner = call("POST", f"{c}/partners", admin, {"name": f"Customer {RUN}", "taxNumber": None, "isCustomer": True,
                                                     "isVendor": False, "fiscalNumber": "81" + RUN[:7].translate(str.maketrans("abcdef", "123456"))})
    s18 = next(t for t in call("GET", f"{c}/taxes", admin) if t.get("code") == "S18")
    today = date.today().isoformat()
    draft = call("POST", f"{c}/invoices", clerk, {"partnerId": partner["id"], "issueDate": today, "dueDate": today,
                                                  "lines": [{"description": "e2e", "quantity": 1, "unitPrice": 118, "taxDefinitionId": s18["id"], "revenueAccountId": None}]})
    check(draft["state"] == "Draft", "Edit: the clerk drafts an invoice")
    check(status_of(lambda: call("POST", f"{c}/invoices/{draft['id']}/post", clerk)) == 403, "…but can't post it (needs Approve)")
    check(status_of(lambda: call("GET", f"{c}/payroll-runs", clerk)) == 403, "no Payroll area: payroll is refused")
    check(status_of(lambda: call("GET", f"{c}/admin/users", clerk)) == 403, "no Users area: the dashboard is refused")
    check(status_of(lambda: call("POST", f"{c}/admin/invitations", clerk,
                                 {"email": "x@e2e.test", "administrator": True})) == 403, "a clerk can't invite an administrator")

    # ---- Change role: takes effect on the next request ----
    clerk_row = next(u for u in call("GET", f"{c}/admin/users", admin) if u["email"] == clerk_email)
    call("PUT", f"{c}/admin/users/{clerk_row['membershipId']}", admin,
         {"administrator": False, "roleId": roles["accountant"]["id"], "employeeId": None})
    posted = call("POST", f"{c}/invoices/{draft['id']}/post", clerk)
    check(posted["state"] == "Posted", "after the switch to Accountant, the same login posts — no re-login")

    # ---- Custom role ----
    levels = {k: NONE for k in roles["reports"]["levels"]}
    levels.update({"reports": VIEW, "users": VIEW})
    custom = call("POST", f"{c}/admin/roles", admin, {"name": f"Auditor {RUN}", "description": "e2e",
                                                      "levels": levels, "partnerScope": 0})
    call("PUT", f"{c}/admin/users/{clerk_row['membershipId']}", admin, {"administrator": False, "roleId": custom["id"], "employeeId": None})
    check(status_of(lambda: call("GET", f"{c}/admin/users", clerk)) == 200, "custom role with Users: View sees the dashboard")
    check(status_of(lambda: call("POST", f"{c}/invoices/{draft['id']}/discard", clerk)) == 403, "…and nothing it wasn't given")
    check(status_of(lambda: call("DELETE", f"{c}/admin/roles/{custom['id']}", admin)) == 400, "a role in use can't be deleted")

    # ---- Deactivate / reactivate ----
    call("POST", f"{c}/admin/users/{clerk_row['membershipId']}/deactivate", admin)
    check(status_of(lambda: call("GET", f"{c}/reports/debt-aging", clerk)) == 403, "deactivated: refused on the very next request")
    check(all(x["id"] != company["id"] for x in call("GET", "/api/companies", clerk)), "…and the company leaves their list")
    call("POST", f"{c}/admin/users/{clerk_row['membershipId']}/activate", admin)
    check(status_of(lambda: call("GET", f"{c}/admin/users", clerk)) == 200, "reactivated: access is back")

    # ---- Guards ----
    me_row = next(u for u in call("GET", f"{c}/admin/users", admin) if u["isYou"])
    check(status_of(lambda: call("POST", f"{c}/admin/users/{me_row['membershipId']}/deactivate", admin)) == 400,
          "an admin can't deactivate themself")
    check(status_of(lambda: call("PUT", f"{c}/admin/users/{me_row['membershipId']}", admin,
                                 {"administrator": False, "roleId": roles["reports"]["id"], "employeeId": None})) == 400,
          "the last administrator can't be demoted")

    # ---- Password reset by the admin, then lockout ----
    reset = call("POST", f"{c}/admin/users/{clerk_row['membershipId']}/password-reset", admin)
    reset_token = token_from(reset["resetUrl"])
    call("POST", "/api/auth/reset-password", body={"email": clerk_email, "token": reset_token, "newPassword": "N3w-" + PASSWORD})
    check(status_of(lambda: call("POST", "/api/auth/login", body={"email": clerk_email, "password": PASSWORD})) == 401,
          "after the reset the old password is refused")
    check(call("POST", "/api/auth/login", body={"email": clerk_email, "password": "N3w-" + PASSWORD})["token"], "…and the new one works")
    for _ in range(5):
        status_of(lambda: call("POST", "/api/auth/login", body={"email": clerk_email, "password": "wrong"}))
    check(status_of(lambda: call("POST", "/api/auth/login", body={"email": clerk_email, "password": "N3w-" + PASSWORD})) == 423,
          "five wrong passwords lock the account")
    check(status_of(lambda: call("POST", "/api/auth/forgot-password", body={"email": f"nobody.{RUN}@e2e.test"})) == 200,
          "forgot-password answers the same for unknown addresses")

    print(f"\nAll {CHECKS} checks passed.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
