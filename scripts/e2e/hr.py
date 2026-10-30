#!/usr/bin/env python3
"""HR module end-to-end check against a running API (docs/HR_MASTER_PLAN.md §5).

Drives every HR feature through real HTTP — auth filters, the Self access module, multipart
uploads, PDF/ZIP files, the outbox — with fresh users and a fresh company each run, so it is safe
to repeat against a dev database. Standard library only.

    python3 scripts/e2e/hr.py                       # API at http://127.0.0.1:5248
    PAKO_API=http://host:port python3 scripts/e2e/hr.py
    PAKO_E2E_WAIT_MAIL=1 python3 scripts/e2e/hr.py  # also wait (≤ 90 s) for the outbox to send

Exits non-zero on the first failed check.
"""

import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import date

API = os.environ.get("PAKO_API", "http://127.0.0.1:5248").rstrip("/")
RUN = uuid.uuid4().hex[:8]
PASSWORD = "E2e-Passw0rd!"
CHECKS = 0

# Enums travel as numbers (no string enum converter in Pako.Api).
CLIENT_STAFF = 4
FULL_TIME = 0
ACCESS_NONE, ACCESS_READ, ACCESS_WRITE = 0, 1, 2
KIND_OVERTIME = 1
LOAN_ADVANCE = 0
BASIS_INVOICED = 0
BANK = 1


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status
        self.body = body


def call(method, path, token=None, body=None, raw=False, files=None):
    headers = {"Accept-Language": "en"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for name, (filename, content, content_type) in files.items():
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                f"Content-Type: {content_type}\r\n\r\n".encode() + content + b"\r\n")
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            if raw:
                return payload, response.headers.get("Content-Type", "")
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


def expect_status(status, fn, message):
    try:
        fn()
    except ApiError as error:
        check(error.status == status, f"{message} (got {error.status})")
        return
    check(False, f"{message} (call succeeded)")


def user(name):
    email = f"{name}.{RUN}@e2e.test"
    call("POST", "/api/auth/register", body={"email": email, "password": PASSWORD})
    auth = call("POST", "/api/auth/login", body={"email": email, "password": PASSWORD})
    return email, auth["token"]


def main():
    today = date.today()
    # A closed past month keeps the run clear of "future period" rules and of lock dates.
    month = date(today.year - 1, 9, 1)
    month_end = date(today.year - 1, 9, 30)
    m = month.isoformat()

    print(f"PAKO HR e2e against {API} (run {RUN})")

    # ---- Setup: a firm, a client company, HR admin, a manager and a staff member ----
    admin_email, admin = user("hr-admin")
    firm = call("POST", "/api/firms", admin, {"name": f"E2E Firm {RUN}"})
    # Core + Payroll profiles (CompanyProfile flags 1 | 16): payroll accounts are seeded only with Payroll.
    company = call("POST", "/api/companies", admin, {"name": f"E2E Co {RUN}", "firmId": firm["id"], "enabledProfiles": 17})
    c = f"/api/companies/{company['id']}"
    check(company["firmId"] == firm["id"], "company created under the firm")

    no_hr = {"sales": ACCESS_READ, "purchases": ACCESS_NONE, "partners": ACCESS_READ, "accounting": ACCESS_NONE,
             "reports": ACCESS_NONE, "hr": ACCESS_NONE}
    dept = call("POST", f"{c}/departments", admin, {
        "code": "OPS", "name": "Operations", "parentId": None, "managerEmployeeId": None, "costCenterId": None,
        "permissions": no_hr, "partnerScope": 1, "isActive": True})

    def employee(first, salary, **extra):
        body = {"firstName": first, "lastName": "E2e", "personalNumber": extra.pop("pn", None), "email": extra.pop("email", None),
                "hireDate": f"{today.year - 2}-01-01", "jobTitle": "Analyst", "departmentId": dept["id"],
                "monthlyGrossSalary": salary, "isPrimaryEmployer": True, "pensionExempt": False, "isActive": True}
        body.update(extra)
        return call("POST", f"{c}/employees", admin, body)

    manager_email, manager_token = user("manager")
    staff_email, staff_token = user("staff")
    manager = employee("Mira", 1500, email=manager_email, pn="1000000001")
    staff = employee("Arta", 1000, email=staff_email, pn="1000000002", managerId=manager["id"],
                     receivePayslipsByEmail=True, preferredLanguage="en")
    other = employee("Blerim", 900, pn="1000000003")
    call("POST", f"{c}/members", admin, {"email": manager_email, "role": CLIENT_STAFF, "employeeId": manager["id"]})
    call("POST", f"{c}/members", admin, {"email": staff_email, "role": CLIENT_STAFF, "employeeId": staff["id"]})
    call("POST", f"{c}/employees/{staff['id']}/contracts", admin, {
        "startDate": f"{today.year - 2}-01-01", "endDate": None, "monthlyGrossSalary": 1000, "employmentType": FULL_TIME,
        "weeklyHours": 40, "jobTitle": "Analyst", "notes": None, "probationEndDate": f"{today.year - 2}-03-31"})

    # ---- F9 self-service access ----
    access = call("GET", f"{c}/my-access", staff_token)
    check(access["linkedEmployeeId"] == staff["id"], "my-access exposes the linked employee")
    check(access["modules"]["hr"] == ACCESS_NONE, "staff department grants no HR access")
    expect_status(403, lambda: call("GET", f"{c}/employees", staff_token), "staff without HR access can't list employees")
    profile = call("GET", f"{c}/me/profile", staff_token)
    check(profile["name"] == "Arta E2e", "staff reads own profile through me/*")
    check(call("GET", f"{c}/my-access", manager_token)["isTeamManager"] is True, "the manager is recognised as a team manager")

    # IBAN change waits for HR.
    profile = call("PUT", f"{c}/me/profile", staff_token, {
        "phone": "+383 44 000 111", "address": None, "iban": "XK27 1701 0000 0000 0012", "bankName": "E2E Bank",
        "receivePayslipsByEmail": True, "preferredLanguage": "en"})
    check(profile["phone"] == "+383 44 000 111" and profile["pendingBankChange"] is not None, "phone saved, IBAN change pending")
    change = call("GET", f"{c}/employee-profile-changes", admin)[0]
    call("POST", f"{c}/employee-profile-changes/{change['id']}/approve", admin)
    check(call("GET", f"{c}/me/profile", staff_token)["iban"] == "XK271701000000000012", "HR approval applies the new IBAN")

    # ---- Leave: request → manager approves ----
    types = call("GET", f"{c}/me/leave/types", staff_token)
    annual = next(t for t in types if (t["defaultAnnualDays"] or 0) > 0)
    leave = call("POST", f"{c}/me/leave/requests", staff_token, {
        "leaveTypeId": annual["id"], "startDate": f"{today.year}-12-01", "endDate": f"{today.year}-12-02", "reason": "e2e"})
    check(leave["state"] == "Pending", "staff files a leave request")
    expect_status(403, lambda: call("POST", f"{c}/me/team/leave/{leave['id']}/approve", staff_token),
                  "an employee can't approve their own leave")
    approved = call("POST", f"{c}/me/team/leave/{leave['id']}/approve", manager_token)
    check(approved["state"] == "Approved", "the direct manager approves it")

    # ---- G10 advance ----
    bank = next(p for p in call("GET", f"{c}/payment-methods", admin) if p["kind"] == BANK)
    loan = call("POST", f"{c}/employee-loans", admin, {
        "employeeId": staff["id"], "kind": LOAN_ADVANCE, "principal": 150, "issuedOn": (month.replace(day=5)).isoformat(),
        "installmentAmount": 100, "firstPeriod": m, "cashOrBankAccountId": bank["ledgerAccountId"], "notes": "e2e"})
    check(loan["outstanding"] == 150 and loan["disbursementJournalEntryId"], "advance issued and posted")

    # ---- G11 commission on a posted invoice ----
    partner = call("POST", f"{c}/partners", admin, {"name": f"Customer {RUN}", "taxNumber": None, "isCustomer": True, "isVendor": False,
                                                   "fiscalNumber": "8" + RUN[:8].translate(str.maketrans("abcdef", "123456"))})
    plan = call("POST", f"{c}/commission-plans", admin, {"name": "E2E 3%", "basis": BASIS_INVOICED, "rate": 0.03, "minThreshold": None})
    staff_full = call("GET", f"{c}/employees/{staff['id']}", admin)
    staff_full.update({"commissionPlanId": plan["id"], "receivePayslipsByEmail": True})
    call("PUT", f"{c}/employees/{staff['id']}", admin, staff_full)
    call("PUT", f"{c}/employees/{staff['id']}/partners", admin, {"partnerIds": [partner["id"]], "effectiveFrom": f"{today.year - 1}-01-01"})
    s18 = next(t for t in call("GET", f"{c}/taxes", admin) if t.get("code") == "S18")
    invoice = call("POST", f"{c}/invoices", admin, {
        "partnerId": partner["id"], "issueDate": month.replace(day=10).isoformat(), "dueDate": month_end.isoformat(),
        # 1,180 VAT-inclusive at 18% (prices are gross by default): net 1,000. Default revenue account.
        "lines": [{"description": "e2e", "quantity": 1, "unitPrice": 1180, "taxDefinitionId": s18["id"], "revenueAccountId": None}]})
    call("POST", f"{c}/invoices/{invoice['id']}/post", admin)
    results = call("POST", f"{c}/payroll-adjustments/calculate-commissions", admin, {"period": m})
    mine = next(r for r in results if r["employeeId"] == staff["id"])
    check(mine["basis"] == 1000 and mine["amount"] == 30, "commission = 3% of the posted invoice's net")

    # ---- G12 timesheet overtime ----
    call("POST", f"{c}/time-entries", admin, {"employeeId": staff["id"], "date": month.replace(day=14).isoformat(),
                                               "hours": 10, "kind": KIND_OVERTIME, "note": "e2e"})
    summary = call("POST", f"{c}/time-entries/approve-month", admin, {"month": m, "employeeId": None})
    check(summary[0]["overtime"] == 10, "approved month turns 10 h into an overtime adjustment")

    # ---- H13 expense claim with a receipt ----
    options = call("GET", f"{c}/me/expense-claims/options", staff_token)
    expense_account = options["accounts"][0]["id"]
    claim = call("POST", f"{c}/me/expense-claims", staff_token, {"title": "E2E trip", "lines": [{
        "date": month.replace(day=3).isoformat(), "description": "Taxi", "expenseAccountId": expense_account, "amount": 40,
        "taxDefinitionId": None, "supplierName": "Taxi Co", "supplierFiscalNumber": None}]})
    receipt = call("POST", f"{c}/me/expense-claims/{claim['id']}/receipts", staff_token,
                   files={"File": ("receipt.pdf", b"%PDF-1.4\n%e2e\n", "application/pdf")})
    check(receipt["fileName"] == "receipt.pdf", "receipt uploaded (multipart)")
    call("POST", f"{c}/me/expense-claims/{claim['id']}/submit", staff_token)
    claim = call("POST", f"{c}/me/team/expense-claims/{claim['id']}/approve", manager_token, {"note": "ok"})
    check(claim["stage"] == "BillDraft" and claim["billId"], "manager approval drafts the purchase bill")
    call("POST", f"{c}/bills/{claim['billId']}/post", admin)
    claim = call("POST", f"{c}/expense-claims/{claim['id']}/reimburse-via-payroll", admin, {"period": m})
    check(claim["payrollReimbursementPeriod"] == m, "posted claim scheduled for payroll")

    # ---- Payroll run: everything lands on the payslip ----
    run = call("POST", f"{c}/payroll-runs", admin, {"periodStart": m, "periodEnd": month_end.isoformat()})
    slip = next(l for l in run["lines"] if l["employeeId"] == staff["id"])
    kinds = {a["kind"] for a in slip["adjustments"]}  # PayrollAdjustmentKind: 3 = Overtime
    check(slip["reimbursementAmount"] == 40, "reimbursement on the slip, outside gross")
    check(slip["loanRepaymentAmount"] == 100, "advance installment deducted")
    check(slip["bonusAmount"] == 30, "commission included as a bonus")
    check(3 in kinds, "overtime adjustment (from the timesheet) consumed by the run")
    call("POST", f"{c}/payroll-runs/{run['id']}/approve", admin)
    run = call("POST", f"{c}/payroll-runs/{run['id']}/post", admin)
    check(run["state"] == "Posted", "run posted")

    # ---- D6 documents ----
    pdf, content_type = call("GET", f"{c}/payroll-runs/{run['id']}/payslips/{slip['id']}/pdf", admin, raw=True)
    check(pdf.startswith(b"%PDF") and "pdf" in content_type, "HR downloads the payslip PDF")
    archive, _ = call("GET", f"{c}/payroll-runs/{run['id']}/payslips/zip", admin, raw=True)
    check(len(zipfile.ZipFile(io.BytesIO(archive)).namelist()) == len(run["lines"]), "ZIP holds one PDF per payslip")

    my_slips = call("GET", f"{c}/me/payslips", staff_token)
    check([s["lineId"] for s in my_slips] == [slip["id"]], "staff sees only their own posted payslip")
    my_pdf, _ = call("GET", f"{c}/me/payslips/{slip['id']}/pdf", staff_token, raw=True)
    check(my_pdf.startswith(b"%PDF"), "staff downloads their own payslip PDF")
    other_line = next(l for l in run["lines"] if l["employeeId"] == other["id"])
    expect_status(404, lambda: call("GET", f"{c}/me/payslips/{other_line['id']}", staff_token),
                  "another employee's payslip is invisible (404)")

    loan = call("GET", f"{c}/employee-loans/{loan['id']}", admin)
    check(loan["outstanding"] == 50, "loan balance reduced by the posted installment")
    claim = call("GET", f"{c}/expense-claims/{claim['id']}", admin)
    check(claim["stage"] == "Reimbursed", "posting the run settles the claim's bill")

    # ---- I14 firm overview, J15 partner statement ----
    overview = call("GET", f"/api/firms/{firm['id']}/payroll-overview?month={m}", admin)
    row = next(r for r in overview["companies"] if r["companyId"] == company["id"])
    check(row["status"] == "Done", "firm overview shows the client as posted")
    statement = call("GET", f"{c}/partners/{partner['id']}/statement?from={month.isoformat()}&to={month_end.isoformat()}", admin)
    check(statement["closingBalance"] > 0, "partner statement shows the invoice balance")

    # ---- E7/E8 outbox ----
    log = call("GET", f"{c}/notifications/log?pageSize=200", admin)["items"]
    templates = {n["template"] for n in log}
    for template in ("LeaveSubmitted", "LeaveDecided", "PayslipReady", "StaffInvitation", "ProfileChangeRequested",
                     "ExpenseClaimSubmitted", "ExpenseClaimDecided"):
        check(template in templates, f"outbox queued {template}")

    if os.environ.get("PAKO_E2E_WAIT_MAIL"):
        deadline = time.time() + 90
        while time.time() < deadline:
            log = call("GET", f"{c}/notifications/log?pageSize=200", admin)["items"]
            if all(n["state"] != "Pending" for n in log):
                break
            time.sleep(5)
        check(all(n["state"] == "Sent" for n in log), "background dispatcher sent every queued email")

    print(f"\nAll {CHECKS} checks passed.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        print(f"FAIL  unexpected API error: {error}")
        sys.exit(1)
