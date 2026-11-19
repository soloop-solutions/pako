--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: enforce_journal_entry_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.enforce_journal_entry_balance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_debit numeric(18,2);
    total_credit numeric(18,2);
BEGIN
    IF NEW."State" = 'Posted' THEN
        SELECT COALESCE(SUM("Debit"), 0), COALESCE(SUM("Credit"), 0)
        INTO total_debit, total_credit
        FROM journal_entry_lines
        WHERE "JournalEntryId" = NEW."Id";

        IF total_debit <> total_credit THEN
            RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', NEW."Id", total_debit, total_credit;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: enforce_reconciliation_line_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.enforce_reconciliation_line_capacity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    line_amount numeric(18,2);
    total_reconciled numeric(18,2);
BEGIN
    SELECT CASE WHEN "Debit" <> 0 THEN "Debit" ELSE "Credit" END
    INTO line_amount
    FROM journal_entry_lines
    WHERE "Id" = NEW."JournalEntryLineId"
    FOR UPDATE;

    SELECT COALESCE(SUM("Amount"), 0)
    INTO total_reconciled
    FROM reconciliations
    WHERE "JournalEntryLineId" = NEW."JournalEntryLineId";

    IF total_reconciled > line_amount THEN
        RAISE EXCEPTION 'Journal entry line % has amount %, but % would be reconciled against it in total', NEW."JournalEntryLineId", line_amount, total_reconciled;
    END IF;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AspNetUserClaims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public."AspNetUserClaims" (
    "Id" integer NOT NULL,
    "UserId" uuid NOT NULL,
    "ClaimType" text,
    "ClaimValue" text
);


--
-- Name: AspNetUserClaims_Id_seq; Type: SEQUENCE; Schema: public; Owner: -
--



--
-- Name: AspNetUserLogins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public."AspNetUserLogins" (
    "LoginProvider" text NOT NULL,
    "ProviderKey" text NOT NULL,
    "ProviderDisplayName" text,
    "UserId" uuid NOT NULL
);


--
-- Name: AspNetUserTokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public."AspNetUserTokens" (
    "UserId" uuid NOT NULL,
    "LoginProvider" text NOT NULL,
    "Name" text NOT NULL,
    "Value" text
);


--
-- Name: AspNetUsers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public."AspNetUsers" (
    "Id" uuid NOT NULL,
    "UserName" character varying(256),
    "NormalizedUserName" character varying(256),
    "Email" character varying(256),
    "NormalizedEmail" character varying(256),
    "EmailConfirmed" boolean NOT NULL,
    "PasswordHash" text,
    "SecurityStamp" text,
    "ConcurrencyStamp" text,
    "PhoneNumber" text,
    "PhoneNumberConfirmed" boolean NOT NULL,
    "TwoFactorEnabled" boolean NOT NULL,
    "LockoutEnd" timestamp with time zone,
    "LockoutEnabled" boolean NOT NULL,
    "AccessFailedCount" integer NOT NULL,
    "FullName" text,
    "LastLoginAt" timestamp with time zone,
    "CompanyLimit" integer,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "IsDisabled" boolean DEFAULT false NOT NULL,
    "IsPlatformAdmin" boolean DEFAULT false NOT NULL
);


--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: account_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.account_groups (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(256) NOT NULL,
    "CodePrefixStart" character varying(32) NOT NULL,
    "CodePrefixEnd" character varying(32) NOT NULL,
    "ParentGroupId" uuid
);


--
-- Name: account_lock_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.account_lock_exceptions (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "LockDateField" integer NOT NULL,
    "LockDate" date NOT NULL,
    "Reason" character varying(512) NOT NULL,
    "EndsAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "GrantedByUserId" uuid NOT NULL,
    "RevokedAt" timestamp with time zone,
    "RevokedByUserId" uuid
);


--
-- Name: account_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.account_requests (
    "Id" uuid NOT NULL,
    "FullName" character varying(200) NOT NULL,
    "Email" character varying(256) NOT NULL,
    "Phone" character varying(50),
    "FirmName" character varying(256),
    "BusinessNumber" character varying(50),
    "City" character varying(100),
    "RequestedCompanies" integer NOT NULL,
    "Message" character varying(2000),
    "Status" character varying(16) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "DecidedAt" timestamp with time zone,
    "DecidedByUserId" uuid,
    "DecisionNote" character varying(1000),
    "UserId" uuid
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.accounts (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(32) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "AccountType" integer NOT NULL,
    "AccountSubType" integer NOT NULL,
    "ParentAccountId" uuid,
    "IsReconcilable" boolean NOT NULL,
    "CitDeductibility" integer,
    "CitLimitRule" character varying(512),
    "Class" integer,
    "DefaultVatCode" character varying(16),
    "Group" integer,
    "IsActive" boolean DEFAULT true NOT NULL,
    "IsControl" boolean DEFAULT false NOT NULL,
    "IsPostable" boolean DEFAULT true NOT NULL,
    "NameSq" character varying(256),
    "NormalBalance" integer,
    "Profiles" integer DEFAULT 0 NOT NULL,
    "Statement" integer,
    "Subledger" integer,
    "ValidFrom" date,
    "ValidTo" date,
    "CreatedAt" timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    "CashFlowCategory" integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_accounts_code_class_group CHECK ((("Class" IS NULL) OR ("Group" IS NULL) OR (("left"(("Code")::text, 1) = ("Class")::text) AND ("left"(("Code")::text, 2) = lpad(("Group")::text, 2, '0'::text)))))
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.attachments (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "OwnerType" integer NOT NULL,
    "OwnerId" uuid NOT NULL,
    "FileName" character varying(256) NOT NULL,
    "ContentType" character varying(128) NOT NULL,
    "SizeBytes" bigint NOT NULL,
    "Content" bytea NOT NULL,
    "UploadedAtUtc" timestamp with time zone NOT NULL,
    "UploadedByUserId" uuid NOT NULL
);


--
-- Name: audit_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.audit_entries (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EntityType" text NOT NULL,
    "EntityId" text NOT NULL,
    "Action" text NOT NULL,
    "UserId" text,
    "OccurredAtUtc" timestamp with time zone NOT NULL,
    "Changes" text
);


--
-- Name: bill_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bill_lines (
    "Id" uuid NOT NULL,
    "BillId" uuid NOT NULL,
    "Description" character varying(512) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "ExpenseAccountId" uuid NOT NULL,
    "DiscountPercent" numeric DEFAULT 0.0 NOT NULL,
    "ItemId" uuid,
    "ExpiryDate" date,
    "LotNumber" character varying(64),
    "PurchaseOrderLineId" uuid,
    "UnitFactor" numeric(18,4) DEFAULT 1.0 NOT NULL,
    "UnitName" character varying(32),
    "CostCodeId" uuid
);


--
-- Name: bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bills (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "VendorReference" character varying(128),
    "IssueDate" date NOT NULL,
    "DueDate" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "JournalEntryId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL,
    "DocumentType" integer DEFAULT 0 NOT NULL,
    "OriginalBillId" uuid,
    "InternalNotes" character varying(1000),
    "PriceMode" integer DEFAULT 0 NOT NULL,
    "WarehouseId" uuid,
    "ProjectId" uuid
);


--
-- Name: commission_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.commission_plans (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(128) NOT NULL,
    "Basis" character varying(16) NOT NULL,
    "Rate" numeric(9,6) NOT NULL,
    "MinThreshold" numeric(18,2),
    "IsActive" boolean NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.companies (
    "Id" uuid NOT NULL,
    "Name" character varying(256) NOT NULL,
    "AccountingLockDate" date,
    "TaxLockDate" date,
    "FirmId" uuid,
    "NextInvoiceNumber" integer DEFAULT 0 NOT NULL,
    "NextCreditNoteNumber" integer DEFAULT 0 NOT NULL,
    "NextDebitNoteNumber" integer DEFAULT 0 NOT NULL,
    "NextDownPaymentNumber" integer DEFAULT 0 NOT NULL,
    "EnabledProfiles" integer DEFAULT 1 NOT NULL,
    "FunctionalCurrency" character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    "NextProformaNumber" integer DEFAULT 0 NOT NULL,
    "NextSalesReturnNumber" integer DEFAULT 0 NOT NULL,
    "IsVatRegistered" boolean DEFAULT true NOT NULL,
    "AllowNumberOverride" boolean DEFAULT false NOT NULL,
    "HardLockDate" date,
    "PurchaseLockDate" date,
    "SaleLockDate" date,
    "AddressLine2" character varying(512),
    "BankAccountHolder" character varying(256),
    "BankName" character varying(256),
    "BusinessActivity" character varying(256),
    "BusinessNumber" character varying(50),
    "Country" character varying(100),
    "Description" character varying(2000),
    "DocumentFooter" character varying(2000),
    "Email" character varying(256),
    "FiscalNumber" character varying(50),
    "Iban" character varying(50),
    "LegalForm" integer,
    "Municipality" character varying(256),
    "PaymentInstructions" character varying(2000),
    "Phone" character varying(50),
    "PostalCode" character varying(20),
    "StreetAddress" character varying(512),
    "SwiftBic" character varying(20),
    "TradingName" character varying(256),
    "VatNumber" character varying(50),
    "VatRegistrationDate" date,
    "Website" character varying(256),
    "ArchivedAt" timestamp with time zone,
    "IsArchived" boolean DEFAULT false NOT NULL,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "CreatedByUserId" uuid,
    "EnabledModules" integer DEFAULT 63 NOT NULL,
    "LogoUrl" character varying(512),
    "StampUrl" character varying(512),
    "BusinessType" integer DEFAULT 0 NOT NULL,
    "EnabledFeatures" bigint DEFAULT 8191 NOT NULL
);


--
-- Name: company_account_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.company_account_defaults (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ReceivableAccountId" uuid NOT NULL,
    "PayableAccountId" uuid NOT NULL,
    "RevenueAccountId" uuid NOT NULL,
    "ExpenseAccountId" uuid NOT NULL,
    "CustomerDepositsAccountId" uuid NOT NULL,
    "SalaryExpenseAccountId" uuid,
    "PitPayableAccountId" uuid,
    "PensionPayableAccountId" uuid,
    "NetPayPayableAccountId" uuid,
    "ReverseChargeInputVatAccountId" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    "ReverseChargeOutputVatAccountId" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    "BonusExpenseAccountId" uuid,
    "EmployerPensionExpenseAccountId" uuid,
    "EmployerPensionPayableAccountId" uuid,
    "PayrollDeductionsAccountId" uuid,
    "EmployeeAdvancesAccountId" uuid
);


--
-- Name: company_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "BankName" character varying(256) NOT NULL,
    "AccountHolder" character varying(256),
    "Iban" character varying(50),
    "SwiftBic" character varying(20),
    "IsDefault" boolean DEFAULT false NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: company_notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.company_notification_settings (
    "CompanyId" uuid NOT NULL,
    "Template" character varying(64) NOT NULL,
    "Enabled" boolean NOT NULL
);


--
-- Name: company_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.company_roles (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Description" character varying(300),
    "BuiltInKey" character varying(32),
    "SalesAccess" character varying(8) NOT NULL,
    "PurchasesAccess" character varying(8) NOT NULL,
    "PartnersAccess" character varying(8) NOT NULL,
    "ItemsAccess" character varying(8) NOT NULL,
    "AccountingAccess" character varying(8) NOT NULL,
    "ReportsAccess" character varying(8) NOT NULL,
    "HrAccess" character varying(8) NOT NULL,
    "PayrollAccess" character varying(8) NOT NULL,
    "SettingsAccess" character varying(8) NOT NULL,
    "UsersAccess" character varying(8) NOT NULL,
    "PartnerScope" character varying(16) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "InventoryAccess" character varying(8) DEFAULT 'None'::character varying NOT NULL,
    "PosAccess" character varying(8) DEFAULT 'None'::character varying NOT NULL
);


--
-- Name: construction_boq_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.construction_boq_lines (
    "Id" uuid NOT NULL,
    "SiteId" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Description" character varying(500) NOT NULL,
    "Unit" character varying(20) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: construction_cost_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.construction_cost_codes (
    "Id" uuid NOT NULL,
    "SiteId" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Name" character varying(160) NOT NULL,
    "Budget" numeric(18,2) NOT NULL
);


--
-- Name: construction_progress_bill_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.construction_progress_bill_lines (
    "Id" uuid NOT NULL,
    "ProgressBillId" uuid NOT NULL,
    "BoqLineId" uuid NOT NULL,
    "CumulativeQuantity" numeric(18,4) NOT NULL,
    "PreviousQuantity" numeric(18,4) NOT NULL,
    "Amount" numeric(18,2) NOT NULL
);


--
-- Name: construction_progress_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.construction_progress_bills (
    "Id" uuid NOT NULL,
    "SiteId" uuid NOT NULL,
    "Number" integer NOT NULL,
    "PeriodTo" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Retention" numeric(18,2) NOT NULL,
    "InvoiceId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: construction_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.construction_sites (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ProjectId" uuid NOT NULL,
    "Name" character varying(160) NOT NULL,
    "ClientPartnerId" uuid NOT NULL,
    "Address" character varying(300),
    "ContractValue" numeric(18,2) NOT NULL,
    "RetentionPercent" numeric(5,2) NOT NULL,
    "RetentionReleased" numeric(18,2) NOT NULL,
    "StartDate" date,
    "EndDate" date,
    "State" character varying(16) NOT NULL,
    "BillingItemId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: cost_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.cost_centers (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(16) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "NameEn" character varying(256) NOT NULL,
    "Profile" integer DEFAULT 0 NOT NULL
);


--
-- Name: dashboard_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "WidgetsJson" jsonb NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "UpdatedByUserId" uuid
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.departments (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(16) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "ParentId" uuid,
    "ManagerEmployeeId" uuid,
    "CostCenterId" uuid,
    "IsActive" boolean NOT NULL,
    "SalesAccess" character varying(8) NOT NULL,
    "PurchasesAccess" character varying(8) NOT NULL,
    "PartnersAccess" character varying(8) NOT NULL,
    "AccountingAccess" character varying(8) NOT NULL,
    "ReportsAccess" character varying(8) NOT NULL,
    "HrAccess" character varying(8) NOT NULL,
    "PartnerScope" character varying(16) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: document_edit_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document_edit_audits (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "DocumentId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Timestamp" timestamp with time zone NOT NULL,
    "OldDueDate" date,
    "NewDueDate" date,
    "OldInternalNotes" character varying(1000),
    "NewInternalNotes" character varying(1000)
);


--
-- Name: document_number_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.document_number_audits (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "DocumentId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Timestamp" timestamp with time zone NOT NULL,
    "OldNumber" character varying(64),
    "NewNumber" character varying(64)
);


--
-- Name: employee_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employee_contracts (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date,
    "MonthlyGrossSalary" numeric(18,2) NOT NULL,
    "EmploymentType" character varying(16) NOT NULL,
    "WeeklyHours" numeric(5,2) NOT NULL,
    "JobTitle" character varying(128),
    "Notes" character varying(1024),
    "CreatedAt" timestamp with time zone NOT NULL,
    "ProbationEndDate" date
);


--
-- Name: employee_loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employee_loans (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Principal" numeric(18,2) NOT NULL,
    "IssuedOn" date NOT NULL,
    "InstallmentAmount" numeric(18,2) NOT NULL,
    "FirstPeriod" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "Notes" character varying(512),
    "DisbursementJournalEntryId" uuid,
    "CancellationJournalEntryId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: employee_partner_assignment_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employee_partner_assignment_periods (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "AssignedFrom" date,
    "AssignedTo" date NOT NULL
);


--
-- Name: employee_partner_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employee_partner_assignments (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "AssignedFrom" date
);


--
-- Name: employee_profile_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employee_profile_changes (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "NewIban" character varying(34) NOT NULL,
    "NewBankName" character varying(128),
    "PreviousIban" character varying(34),
    "PreviousBankName" character varying(128),
    "State" character varying(16) NOT NULL,
    "RequestedByUserId" uuid NOT NULL,
    "RequestedAt" timestamp with time zone NOT NULL,
    "DecidedByUserId" uuid,
    "DecidedAt" timestamp with time zone
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.employees (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(256) NOT NULL,
    "MonthlyGrossSalary" numeric(18,2) NOT NULL,
    "IsActive" boolean NOT NULL,
    "Address" character varying(512),
    "BankName" character varying(128),
    "BirthDate" date,
    "DepartmentId" uuid,
    "Email" character varying(256),
    "FirstName" character varying(128),
    "HireDate" date,
    "Iban" character varying(34),
    "IsPrimaryEmployer" boolean DEFAULT true NOT NULL,
    "JobTitle" character varying(128),
    "LastName" character varying(128),
    "ManagerId" uuid,
    "PensionExempt" boolean DEFAULT false NOT NULL,
    "PersonalNumber" character varying(16),
    "Phone" character varying(64),
    "TerminationDate" date,
    "UserId" uuid,
    "PreferredLanguage" character varying(8) DEFAULT 'sq'::character varying NOT NULL,
    "ReceivePayslipsByEmail" boolean DEFAULT false NOT NULL,
    "CommissionPlanId" uuid
);


--
-- Name: expense_claim_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.expense_claim_lines (
    "Id" uuid NOT NULL,
    "ExpenseClaimId" uuid NOT NULL,
    "Date" date NOT NULL,
    "Description" character varying(256) NOT NULL,
    "ExpenseAccountId" uuid NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "SupplierName" character varying(200),
    "SupplierFiscalNumber" character varying(32)
);


--
-- Name: expense_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.expense_claims (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Title" character varying(200) NOT NULL,
    "State" character varying(16) NOT NULL,
    "SubmittedAt" timestamp with time zone,
    "DecidedByUserId" uuid,
    "DecidedAt" timestamp with time zone,
    "DecisionNote" character varying(512),
    "BillId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: firms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.firms (
    "Id" uuid NOT NULL,
    "Name" character varying(256) NOT NULL
);


--
-- Name: fiscal_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.fiscal_documents (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "RegisterId" uuid NOT NULL,
    "OrderId" uuid NOT NULL,
    "Type" character varying(16) NOT NULL,
    "CouponId" bigint NOT NULL,
    "DailyNumber" integer NOT NULL,
    "ReferenceCouponId" bigint,
    "VerificationNo" character varying(16) NOT NULL,
    "IssuedAt" timestamp with time zone NOT NULL,
    "PosCouponDetails" text NOT NULL,
    "Signature" character varying(256) NOT NULL,
    "QrCode" text NOT NULL,
    "AtkStatus" character varying(16) NOT NULL,
    "AtkTransactionNo" numeric(20,0),
    "AtkError" character varying(1000),
    "SentAt" timestamp with time zone,
    "Attempts" integer NOT NULL,
    "SendBy" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.invoice_lines (
    "Id" uuid NOT NULL,
    "InvoiceId" uuid NOT NULL,
    "Description" character varying(512) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "RevenueAccountId" uuid NOT NULL,
    "DiscountPercent" numeric DEFAULT 0.0 NOT NULL,
    "ItemId" uuid,
    "ExpiryDate" date,
    "LotNumber" character varying(64),
    "UnitFactor" numeric(18,4) DEFAULT 1.0 NOT NULL,
    "UnitName" character varying(32),
    "DeliveryLineId" uuid,
    "SalesOrderLineId" uuid
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.invoices (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "InvoiceNumber" character varying(64),
    "IssueDate" date NOT NULL,
    "DueDate" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "JournalEntryId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL,
    "DocumentType" integer DEFAULT 0 NOT NULL,
    "OriginalInvoiceId" uuid,
    "GraceDays" integer,
    "PaymentTermDays" integer,
    "PriceMode" integer DEFAULT 0 NOT NULL,
    "InternalNotes" character varying(1000),
    "WarehouseId" uuid,
    "ProjectId" uuid
);


--
-- Name: item_attribute_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_attribute_values (
    "Id" uuid NOT NULL,
    "AttributeId" uuid NOT NULL,
    "Value" character varying(60) NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: item_attributes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_attributes (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: item_barcodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_barcodes (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Barcode" character varying(64) NOT NULL
);


--
-- Name: item_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_categories (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "InventoryAccountId" uuid,
    "CogsAccountId" uuid,
    "RevenueAccountId" uuid,
    "ExpenseAccountId" uuid,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: item_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_costs (
    "ItemId" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "AverageCost" numeric(18,6) NOT NULL,
    "Value" numeric(18,2) NOT NULL,
    "LastMoveDate" date
);


--
-- Name: item_cross_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_cross_references (
    "Id" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Brand" character varying(60) NOT NULL,
    "Number" character varying(60) NOT NULL,
    "Normalized" character varying(60) NOT NULL
);


--
-- Name: item_fitments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_fitments (
    "Id" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Make" character varying(60) NOT NULL,
    "Model" character varying(60) NOT NULL,
    "YearFrom" integer,
    "YearTo" integer,
    "Engine" character varying(60)
);


--
-- Name: item_recipe_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_recipe_lines (
    "Id" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "IngredientItemId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "WastePercent" numeric(9,4) NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: item_serials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_serials (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Serial" character varying(64) NOT NULL,
    "Status" character varying(16) NOT NULL,
    "SoldOrderId" uuid,
    "SoldAt" timestamp with time zone,
    "WarrantyUntil" date,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: item_variant_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.item_variant_values (
    "ItemId" uuid NOT NULL,
    "AttributeValueId" uuid NOT NULL
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.items (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" integer NOT NULL,
    "Name" character varying(256) NOT NULL,
    "Unit" character varying(32) NOT NULL,
    "DefaultTaxDefinitionId" uuid,
    "DefaultRevenueAccountId" uuid,
    "DefaultExpenseAccountId" uuid,
    "DefaultUnitPrice" numeric(18,2),
    "DefaultInventoryAccountId" uuid,
    "Type" integer DEFAULT 0 NOT NULL,
    "Description" text,
    "CategoryId" uuid,
    "MinimumStock" numeric(18,4),
    "TrackInventory" boolean DEFAULT false NOT NULL,
    "PurchaseUnit" character varying(32),
    "PurchaseUnitFactor" numeric(18,4),
    "SalesUnit" character varying(32),
    "SalesUnitFactor" numeric(18,4),
    "TrackLots" boolean DEFAULT false NOT NULL,
    "ActiveIngredient" character varying(200),
    "AgencyCommissionPercent" numeric(5,2),
    "AgencyPartnerId" uuid,
    "AtcCode" character varying(10),
    "BufferMinutes" integer,
    "DepositItemId" uuid,
    "DurationMinutes" integer,
    "IsBookable" boolean DEFAULT false NOT NULL,
    "IsControlled" boolean DEFAULT false NOT NULL,
    "IsPrescriptionOnly" boolean DEFAULT false NOT NULL,
    "IsVariantTemplate" boolean DEFAULT false NOT NULL,
    "MaxRetailPrice" numeric(18,4),
    "MembershipDays" integer,
    "MinimumAge" integer,
    "OpenPrice" boolean DEFAULT false NOT NULL,
    "PackageServiceItemId" uuid,
    "PackageSessions" integer,
    "PackageValidDays" integer,
    "Plu" character varying(6),
    "ProductionCenterId" uuid,
    "SellByWeight" boolean DEFAULT false NOT NULL,
    "TrackSerials" boolean DEFAULT false NOT NULL,
    "VariantOfItemId" uuid,
    "WarrantyMonths" integer
);


--
-- Name: job_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.job_locks (
    "Name" character varying(64) NOT NULL,
    "LastRunOn" date,
    "LastRunAt" timestamp with time zone
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.journal_entries (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "JournalId" uuid NOT NULL,
    "Date" date NOT NULL,
    "Reference" character varying(256),
    "State" character varying(16) NOT NULL,
    "SequenceNumber" character varying(64),
    "PostedAtUtc" timestamp with time zone,
    "EntryHash" character varying(128),
    "PrevHash" character varying(128),
    "SecureSequenceNumber" bigint,
    "PostedByUserId" uuid,
    "PostedFromIp" text,
    "SourceDocumentId" uuid,
    "Remarks" character varying(1024),
    "Description" text
);


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
    "Id" uuid NOT NULL,
    "JournalEntryId" uuid NOT NULL,
    "AccountId" uuid NOT NULL,
    "PartnerId" uuid,
    "Debit" numeric(18,2) NOT NULL,
    "Credit" numeric(18,2) NOT NULL,
    "Description" character varying(512),
    "TaxId" uuid,
    "ReconciledFlag" boolean NOT NULL,
    "ReconciliationId" uuid,
    "ExchangeRate" numeric(18,6),
    "OriginalAmount" numeric(18,2),
    "OriginalCurrency" character varying(3),
    "AnalyticDistribution" jsonb,
    "EmployeeId" uuid,
    "ProjectId" uuid
);


--
-- Name: journals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.journals (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Type" integer NOT NULL,
    "Code" character varying(16) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "DefaultDebitAccountId" uuid,
    "DefaultCreditAccountId" uuid,
    "SequencePrefix" text NOT NULL,
    "SequenceNextNumber" integer NOT NULL,
    "SequencePadding" integer NOT NULL
);


--
-- Name: leave_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.leave_allocations (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "LeaveTypeId" uuid NOT NULL,
    "Year" integer NOT NULL,
    "Days" numeric(6,2) NOT NULL,
    "CarriedOverDays" numeric(6,2),
    "CarriedOverExpiresOn" date,
    "HasCustomDays" boolean DEFAULT true NOT NULL
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.leave_requests (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "LeaveTypeId" uuid NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date NOT NULL,
    "Days" numeric(6,2) NOT NULL,
    "Reason" character varying(512),
    "State" character varying(16) NOT NULL,
    "DecidedByUserId" uuid,
    "DecidedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: leave_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.leave_types (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(16) NOT NULL,
    "Name" character varying(128) NOT NULL,
    "DefaultAnnualDays" numeric(6,2),
    "PayPercent" numeric(5,2) NOT NULL,
    "IsActive" boolean NOT NULL,
    "CarryOverExpiryMonth" integer,
    "CarryOverMaxDays" numeric(6,2)
);


--
-- Name: lot_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.lot_balances (
    "LotId" uuid NOT NULL,
    "LocationId" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL
);


--
-- Name: lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.lots (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Number" character varying(64) NOT NULL,
    "ExpiryDate" date,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.memberships (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "FirmId" uuid,
    "CompanyId" uuid,
    "Role" character varying(32) NOT NULL,
    "CompanyRoleId" uuid,
    "CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "IsActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT ck_memberships_scope CHECK (((("FirmId" IS NOT NULL) AND ("CompanyId" IS NULL) AND (("Role")::text = ANY ((ARRAY['FirmAdmin'::character varying, 'FirmAccountant'::character varying])::text[]))) OR (("CompanyId" IS NOT NULL) AND ("FirmId" IS NULL) AND (("Role")::text = ANY ((ARRAY['ClientAdmin'::character varying, 'ClientViewer'::character varying, 'ClientStaff'::character varying])::text[])))))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notifications (
    "Id" uuid NOT NULL,
    "CompanyId" uuid,
    "RecipientEmail" character varying(256) NOT NULL,
    "Template" character varying(64) NOT NULL,
    "Culture" character varying(8) NOT NULL,
    "PayloadJson" jsonb NOT NULL,
    "AttachmentKind" character varying(32),
    "AttachmentRefId" uuid,
    "State" character varying(16) NOT NULL,
    "Attempts" integer NOT NULL,
    "NextAttemptAt" timestamp with time zone NOT NULL,
    "LockedUntil" timestamp with time zone,
    "LastError" character varying(1000),
    "CreatedAt" timestamp with time zone NOT NULL,
    "SentAt" timestamp with time zone
);


--
-- Name: number_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.number_series (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "DocumentType" character varying(32) NOT NULL,
    "Year" integer NOT NULL,
    "Pattern" character varying(64) NOT NULL
);


--
-- Name: partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.partners (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(256) NOT NULL,
    "TaxNumber" character varying(64),
    "IsCustomer" boolean NOT NULL,
    "IsVendor" boolean NOT NULL,
    "FiscalNumber" character varying(64),
    "IsVatRegistered" boolean DEFAULT false NOT NULL,
    "CreditLimit" numeric(18,2),
    "PayableAccountId" uuid,
    "PaymentTermDays" integer,
    "ReceivableAccountId" uuid,
    "EmployeeId" uuid,
    "OverdueBlockDays" integer,
    "PriceListId" uuid
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.payment_methods (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(128) NOT NULL,
    "Kind" integer NOT NULL,
    "LedgerAccountId" uuid NOT NULL
);


--
-- Name: payroll_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Period" date NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Description" character varying(256),
    "Hours" numeric(8,2),
    "RateMultiplier" numeric(6,4),
    "Amount" numeric(18,2) NOT NULL,
    "PayrollRunId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL,
    "CommissionBasisAmount" numeric(18,2),
    "CommissionPlanId" uuid,
    "EmployeeLoanId" uuid,
    "ExpenseClaimId" uuid,
    "FromTimesheet" boolean DEFAULT false NOT NULL
);


--
-- Name: payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.payroll_runs (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PeriodStart" date NOT NULL,
    "PeriodEnd" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "JournalEntryId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL,
    "ApprovedAt" timestamp with time zone,
    "ApprovedByUserId" uuid,
    "Notes" character varying(1024),
    "PaidOn" date,
    "PaymentJournalEntryId" uuid,
    "ParametersSnapshot" jsonb
);


--
-- Name: payslip_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.payslip_lines (
    "Id" uuid NOT NULL,
    "PayrollRunId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "GrossSalary" numeric(18,2) NOT NULL,
    "PitAmount" numeric(18,2) NOT NULL,
    "EmployeePensionAmount" numeric(18,2) NOT NULL,
    "EmployerPensionAmount" numeric(18,2) NOT NULL,
    "NetPay" numeric(18,2) NOT NULL,
    "BaseSalary" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "BonusAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "CostCenterId" uuid,
    "DeductionsAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "DepartmentId" uuid,
    "IsPrimaryEmployer" boolean DEFAULT true NOT NULL,
    "OtherAdditionsAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "PaidDays" numeric(6,2) DEFAULT 0.0 NOT NULL,
    "WorkingDays" numeric(6,2) DEFAULT 0.0 NOT NULL,
    "LoanRepaymentAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "ReimbursementAmount" numeric(18,2) DEFAULT 0.0 NOT NULL
);


--
-- Name: platform_audit_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.platform_audit_entries (
    "Id" uuid NOT NULL,
    "OccurredAtUtc" timestamp with time zone NOT NULL,
    "ActorUserId" uuid NOT NULL,
    "Action" character varying(32) NOT NULL,
    "TargetType" character varying(32) NOT NULL,
    "TargetId" uuid NOT NULL,
    "TargetLabel" character varying(256) NOT NULL,
    "Details" jsonb
);


--
-- Name: pos_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_appointments (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "ItemId" uuid NOT NULL,
    "ResourceId" uuid NOT NULL,
    "Start" timestamp with time zone NOT NULL,
    "End" timestamp with time zone NOT NULL,
    "State" character varying(16) NOT NULL,
    "Source" character varying(16) NOT NULL,
    "CustomerId" uuid,
    "CustomerName" character varying(120) NOT NULL,
    "Phone" character varying(40),
    "Email" character varying(256),
    "Notes" character varying(500),
    "DepositCardId" uuid,
    "PosOrderId" uuid,
    "ReminderSentAt" timestamp with time zone,
    "CancelReason" character varying(256),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_barcode_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_barcode_rules (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Prefix" character varying(2) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "ItemDigits" integer NOT NULL,
    "ValueDigits" integer NOT NULL,
    "ValueDecimals" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_cash_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_cash_movements (
    "Id" uuid NOT NULL,
    "SessionId" uuid NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Reason" character varying(256) NOT NULL,
    "CounterpartAccountId" uuid NOT NULL,
    "PartnerId" uuid,
    "CreatedByUserId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_channel_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_channel_order_lines (
    "Id" uuid NOT NULL,
    "ChannelOrderId" uuid NOT NULL,
    "LineNo" integer NOT NULL,
    "ItemId" uuid NOT NULL,
    "Description" character varying(512) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL
);


--
-- Name: pos_channel_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_channel_orders (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ChannelId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(20) NOT NULL,
    "ExternalRef" character varying(64) NOT NULL,
    "State" character varying(20) NOT NULL,
    "Fulfilment" character varying(20) NOT NULL,
    "Payment" character varying(20) NOT NULL,
    "CustomerName" character varying(120) NOT NULL,
    "Phone" character varying(40),
    "Email" character varying(200),
    "Address" character varying(300),
    "City" character varying(80),
    "Notes" character varying(1000),
    "Total" numeric(18,2) NOT NULL,
    "ShippingFee" numeric(18,2) NOT NULL,
    "CourierPartnerId" uuid,
    "TrackingNumber" character varying(60),
    "PosOrderId" uuid,
    "RemittedOn" date,
    "RemittanceRef" character varying(60),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_combo_choices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_combo_choices (
    "Id" uuid NOT NULL,
    "SlotId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "PriceDelta" numeric(18,4) NOT NULL
);


--
-- Name: pos_combo_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_combo_slots (
    "Id" uuid NOT NULL,
    "ComboItemId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "MinSelect" integer NOT NULL,
    "MaxSelect" integer NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: pos_customer_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_customer_order_lines (
    "Id" uuid NOT NULL,
    "CustomerOrderId" uuid NOT NULL,
    "LineNo" integer NOT NULL,
    "ItemId" uuid NOT NULL,
    "Description" character varying(256) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL
);


--
-- Name: pos_customer_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_customer_orders (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "State" character varying(16) NOT NULL,
    "CustomerId" uuid NOT NULL,
    "DueDate" date,
    "Notes" character varying(500),
    "DepositCardId" uuid NOT NULL,
    "CollectedOrderId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_event_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_event_bookings (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "VenueId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "Date" date NOT NULL,
    "From" time without time zone,
    "To" time without time zone,
    "State" character varying(16) NOT NULL,
    "CustomerId" uuid,
    "CustomerName" character varying(120) NOT NULL,
    "Phone" character varying(40),
    "PackageItemId" uuid,
    "PricePerGuest" numeric(18,4),
    "GuestsEstimated" integer NOT NULL,
    "GuestsFinal" integer,
    "BanquetNotes" character varying(4000),
    "Notes" character varying(1000),
    "DepositCardId" uuid,
    "TabId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_event_ticket_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_event_ticket_types (
    "Id" uuid NOT NULL,
    "EventId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Quota" integer
);


--
-- Name: pos_fleet_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_fleet_cards (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "PartnerId" uuid NOT NULL,
    "VehiclePlate" character varying(20),
    "DriverName" character varying(120),
    "LimitPerFill" numeric(18,2),
    "FuelOnly" boolean NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_floors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_floors (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "SortOrder" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_fuel_nozzles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_fuel_nozzles (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Pump" integer NOT NULL,
    "Number" integer NOT NULL,
    "TankId" uuid NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_fuel_tanks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_fuel_tanks (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "ItemId" uuid NOT NULL,
    "Capacity" numeric(18,2) NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_gift_card_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_gift_card_movements (
    "Id" uuid NOT NULL,
    "GiftCardId" uuid NOT NULL,
    "OrderId" uuid,
    "Amount" numeric(18,2) NOT NULL,
    "At" timestamp with time zone NOT NULL
);


--
-- Name: pos_gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_gift_cards (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Balance" numeric(18,2) NOT NULL,
    "ExpiresOn" date,
    "PartnerId" uuid,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_hotel_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_hotel_bookings (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "RoomTypeId" uuid NOT NULL,
    "RoomId" uuid,
    "Arrival" date NOT NULL,
    "Departure" date NOT NULL,
    "Adults" integer NOT NULL,
    "Children" integer NOT NULL,
    "State" character varying(16) NOT NULL,
    "GuestName" character varying(120) NOT NULL,
    "Phone" character varying(40),
    "Email" character varying(256),
    "CompanyPartnerId" uuid,
    "Channel" character varying(40),
    "NightlyRate" numeric(18,4) NOT NULL,
    "Notes" character varying(500),
    "DepositCardId" uuid,
    "FolioTabId" uuid,
    "PostedThrough" date,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_hotel_guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_hotel_guests (
    "Id" uuid NOT NULL,
    "BookingId" uuid NOT NULL,
    "FullName" character varying(120) NOT NULL,
    "Nationality" character varying(60),
    "DocumentType" character varying(40),
    "DocumentNumber" character varying(60),
    "BirthDate" date,
    "IsPrimary" boolean NOT NULL
);


--
-- Name: pos_item_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_item_modifier_groups (
    "ItemId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "SortOrder" integer NOT NULL
);


--
-- Name: pos_kitchen_ticket_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_kitchen_ticket_lines (
    "Id" uuid NOT NULL,
    "TicketId" uuid NOT NULL,
    "TabLineId" uuid NOT NULL,
    "Description" character varying(256) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "Modifiers" character varying(500),
    "Note" character varying(256),
    "Seat" integer,
    "Course" integer NOT NULL
);


--
-- Name: pos_kitchen_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_kitchen_tickets (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "TabId" uuid NOT NULL,
    "ProductionCenterId" uuid,
    "Number" integer NOT NULL,
    "IsStorno" boolean NOT NULL,
    "State" character varying(16) NOT NULL,
    "TabLabel" character varying(80) NOT NULL,
    "WaiterName" character varying(120) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "StartedAt" timestamp with time zone,
    "ReadyAt" timestamp with time zone,
    "DoneAt" timestamp with time zone
);


--
-- Name: pos_loyalty_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_loyalty_cards (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "HolderName" character varying(120),
    "Phone" character varying(40),
    "PartnerId" uuid,
    "Points" numeric(18,4) NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_memberships (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "PlanItemId" uuid NOT NULL,
    "CustomerId" uuid,
    "HolderName" character varying(120),
    "Phone" character varying(40),
    "StartsOn" date NOT NULL,
    "EndsOn" date NOT NULL,
    "State" character varying(16) NOT NULL,
    "FrozenFrom" date,
    "FrozenDays" integer NOT NULL,
    "LastOrderId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_meter_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_meter_readings (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "NozzleId" uuid NOT NULL,
    "Date" date NOT NULL,
    "SessionId" uuid,
    "Opening" numeric(18,3) NOT NULL,
    "Closing" numeric(18,3) NOT NULL,
    "UserId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_modifier_groups (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "MinSelect" integer NOT NULL,
    "MaxSelect" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_modifiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_modifiers (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "PriceDelta" numeric(18,4) NOT NULL,
    "IngredientItemId" uuid,
    "IngredientQuantity" numeric(18,4),
    "SortOrder" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_order_lines (
    "Id" uuid NOT NULL,
    "OrderId" uuid NOT NULL,
    "LineNo" integer NOT NULL,
    "ItemId" uuid,
    "Description" character varying(256) NOT NULL,
    "Unit" character varying(32) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitFactor" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL,
    "DiscountAmount" numeric(18,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "TaxLetter" character varying(1) NOT NULL,
    "TaxRate" numeric(9,4) NOT NULL,
    "Gross" numeric(18,2) NOT NULL,
    "Net" numeric(18,2) NOT NULL,
    "Tax" numeric(18,2) NOT NULL,
    "RevenueAccountId" uuid NOT NULL,
    "LotNumber" character varying(64),
    "AgeVerified" boolean NOT NULL,
    "ProgramDiscount" numeric(18,2) NOT NULL,
    "ProgramId" uuid,
    "GiftCardNumber" character varying(40),
    "SerialNumber" character varying(64),
    "TabLineId" uuid,
    "ModifierIds" character varying(800),
    "StaffUserId" uuid,
    "PackageNumber" character varying(40),
    "MembershipNumber" character varying(40),
    "PrescriptionLineId" uuid,
    "NozzleId" uuid,
    "AgencyPartnerId" uuid,
    "AgencyCommission" numeric(18,2) NOT NULL,
    "OriginalLineId" uuid,
    "CostValue" numeric(18,2) NOT NULL,
    "CostCorrection" numeric(18,2) NOT NULL,
    "CostReplay" numeric(18,2) NOT NULL
);


--
-- Name: pos_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_orders (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ClientUuid" uuid NOT NULL,
    "SessionId" uuid NOT NULL,
    "RegisterId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Number" character varying(40) NOT NULL,
    "OrderedAt" timestamp with time zone NOT NULL,
    "OperatorUserId" uuid NOT NULL,
    "OperatorName" character varying(120) NOT NULL,
    "CustomerId" uuid,
    "OriginalOrderId" uuid,
    "Reason" character varying(256),
    "InvoiceId" uuid,
    "Total" numeric(18,2) NOT NULL,
    "TotalTax" numeric(18,2) NOT NULL,
    "TotalDiscount" numeric(18,2) NOT NULL,
    "CreatedOffline" boolean NOT NULL,
    "CouponCodes" character varying(200),
    "LoyaltyCardId" uuid,
    "TabId" uuid,
    "AppointmentId" uuid,
    "RepairTicketId" uuid,
    "PrescriptionId" uuid,
    "FleetCardId" uuid,
    "ChannelOrderId" uuid,
    "PointsEarned" numeric(18,4) NOT NULL,
    "PointsRedeemed" numeric(18,4) NOT NULL,
    "ReceivedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_packages (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "ServiceItemId" uuid NOT NULL,
    "CustomerId" uuid,
    "HolderName" character varying(120),
    "Phone" character varying(40),
    "SessionsTotal" integer NOT NULL,
    "SessionsUsed" integer NOT NULL,
    "UnitValue" numeric(18,4) NOT NULL,
    "ExpiresOn" date,
    "SoldOrderId" uuid NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_payers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_payers (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "PartnerId" uuid NOT NULL,
    "CoveragePercent" numeric(5,2) NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_payments (
    "Id" uuid NOT NULL,
    "OrderId" uuid NOT NULL,
    "PaymentMethodId" uuid NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Tendered" numeric(18,2),
    "Reference" character varying(128),
    "Tip" numeric(18,2) NOT NULL,
    "PartnerId" uuid
);


--
-- Name: pos_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_pins (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "PinHash" character varying(200) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_prescription_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_prescription_lines (
    "Id" uuid NOT NULL,
    "PrescriptionId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "Dispensed" numeric(18,4) NOT NULL,
    "Dosage" character varying(200)
);


--
-- Name: pos_prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_prescriptions (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "IssuedOn" date NOT NULL,
    "ValidUntil" date,
    "Prescriber" character varying(120) NOT NULL,
    "PrescriberLicence" character varying(40),
    "PatientName" character varying(120) NOT NULL,
    "PatientPersonalNumber" character varying(20),
    "PayerId" uuid,
    "CoveragePercent" numeric(5,2) NOT NULL,
    "State" character varying(20) NOT NULL,
    "Notes" character varying(1000),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_production_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_production_centers (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid,
    "Name" character varying(60) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "PrinterName" character varying(120),
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_program_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_program_targets (
    "Id" uuid NOT NULL,
    "ProgramId" uuid NOT NULL,
    "ItemId" uuid,
    "CategoryId" uuid
);


--
-- Name: pos_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_programs (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Reward" character varying(24) NOT NULL,
    "IsActive" boolean NOT NULL,
    "ValidFrom" date,
    "ValidTo" date,
    "Days" integer NOT NULL,
    "TimeFrom" time without time zone,
    "TimeTo" time without time zone,
    "StoreId" uuid,
    "Priority" integer NOT NULL,
    "Stackable" boolean NOT NULL,
    "Code" character varying(40),
    "MaxUses" integer,
    "Uses" integer NOT NULL,
    "MinQuantity" numeric(18,4),
    "MinAmount" numeric(18,2),
    "Percent" numeric(9,4),
    "Amount" numeric(18,2),
    "Price" numeric(18,4),
    "BuyQuantity" integer,
    "GetQuantity" integer,
    "PointsPerEuro" numeric(18,4),
    "PointValue" numeric(18,4)
);


--
-- Name: pos_registers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_registers (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Name" character varying(120) NOT NULL,
    "Profile" character varying(16) NOT NULL,
    "FiscalMode" character varying(16) NOT NULL,
    "FiscalPosNumber" integer NOT NULL,
    "FiscalizationNumber" character varying(64),
    "CertificatePem" text,
    "CertificateThumbprint" character varying(64),
    "CertificateNotAfter" timestamp with time zone,
    "CashAccountId" uuid NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_repair_ticket_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_repair_ticket_lines (
    "Id" uuid NOT NULL,
    "TicketId" uuid NOT NULL,
    "LineNo" integer NOT NULL,
    "ItemId" uuid NOT NULL,
    "Description" character varying(256) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL
);


--
-- Name: pos_repair_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_repair_tickets (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Number" character varying(40) NOT NULL,
    "State" character varying(20) NOT NULL,
    "CustomerId" uuid,
    "CustomerName" character varying(120) NOT NULL,
    "Phone" character varying(40),
    "Email" character varying(256),
    "Device" character varying(160) NOT NULL,
    "SerialOrPlate" character varying(64),
    "Problem" character varying(1000) NOT NULL,
    "Accessories" character varying(500),
    "TechnicianUserId" uuid,
    "Notes" character varying(1000),
    "ApprovedAt" timestamp with time zone,
    "ReadyAt" timestamp with time zone,
    "CollectedOrderId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_resource_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_resource_hours (
    "Id" uuid NOT NULL,
    "ResourceId" uuid NOT NULL,
    "Day" integer NOT NULL,
    "From" time without time zone NOT NULL,
    "To" time without time zone NOT NULL
);


--
-- Name: pos_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_resources (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "UserId" uuid,
    "Color" character varying(16),
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_room_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_room_types (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Capacity" integer NOT NULL,
    "RateItemId" uuid NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_rooms (
    "Id" uuid NOT NULL,
    "RoomTypeId" uuid NOT NULL,
    "Number" character varying(20) NOT NULL,
    "Floor" character varying(20),
    "State" character varying(16) NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_sales_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_sales_channels (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "Kind" character varying(20) NOT NULL,
    "Token" character varying(64) NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_service_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_service_resources (
    "ItemId" uuid NOT NULL,
    "ResourceId" uuid NOT NULL
);


--
-- Name: pos_session_tenders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_session_tenders (
    "Id" uuid NOT NULL,
    "SessionId" uuid NOT NULL,
    "PaymentMethodId" uuid NOT NULL,
    "Expected" numeric(18,2) NOT NULL,
    "Counted" numeric(18,2) NOT NULL,
    "Difference" numeric(18,2) NOT NULL,
    "DifferenceReason" character varying(256)
);


--
-- Name: pos_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_sessions (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "RegisterId" uuid NOT NULL,
    "Number" integer NOT NULL,
    "State" character varying(16) NOT NULL,
    "OpenedByUserId" uuid NOT NULL,
    "OpenedAt" timestamp with time zone NOT NULL,
    "OpeningFloat" numeric(18,2) NOT NULL,
    "ClosedByUserId" uuid,
    "ClosedAt" timestamp with time zone,
    "BusinessDate" date NOT NULL,
    "JournalEntryId" uuid,
    "ZReportJson" jsonb
);


--
-- Name: pos_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_stores (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Name" character varying(120) NOT NULL,
    "Address" character varying(256),
    "FiscalBranchNumber" integer NOT NULL,
    "Location" character varying(120) NOT NULL,
    "WarehouseId" uuid NOT NULL,
    "PriceListId" uuid,
    "ReceiptHeader" character varying(500),
    "ReceiptFooter" character varying(500),
    "TipsAccountId" uuid,
    "BookingToken" character varying(40),
    "TouristTaxItemId" uuid,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_tab_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_tab_lines (
    "Id" uuid NOT NULL,
    "TabId" uuid NOT NULL,
    "LineNo" integer NOT NULL,
    "ItemId" uuid NOT NULL,
    "Description" character varying(256) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL,
    "DiscountAmount" numeric(18,2) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Seat" integer,
    "Course" integer NOT NULL,
    "Note" character varying(256),
    "Modifiers" character varying(500),
    "ModifierIds" character varying(800),
    "ParentLineId" uuid,
    "ProductionCenterId" uuid,
    "SentAt" timestamp with time zone,
    "VoidReason" character varying(256),
    "VoidedByUserId" uuid,
    "PaidQuantity" numeric(18,4) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_tables (
    "Id" uuid NOT NULL,
    "FloorId" uuid NOT NULL,
    "Name" character varying(30) NOT NULL,
    "Seats" integer NOT NULL,
    "Shape" character varying(16) NOT NULL,
    "X" integer NOT NULL,
    "Y" integer NOT NULL,
    "Width" integer NOT NULL,
    "Height" integer NOT NULL,
    "QrToken" character varying(40) NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_tabs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_tabs (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "TableId" uuid,
    "Number" character varying(40) NOT NULL,
    "Name" character varying(120),
    "Kind" character varying(16) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Covers" integer NOT NULL,
    "WaiterUserId" uuid NOT NULL,
    "WaiterName" character varying(120) NOT NULL,
    "DeliveryAddress" character varying(256),
    "DeliveryPhone" character varying(40),
    "DriverName" character varying(120),
    "PreBillCount" integer NOT NULL,
    "OpenedAt" timestamp with time zone NOT NULL,
    "ClosedAt" timestamp with time zone
);


--
-- Name: pos_tank_dips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_tank_dips (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "TankId" uuid NOT NULL,
    "MeasuredAt" timestamp with time zone NOT NULL,
    "Volume" numeric(18,2) NOT NULL,
    "Water" numeric(18,2) NOT NULL,
    "UserId" uuid NOT NULL
);


--
-- Name: pos_ticketed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_ticketed_events (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "StartsAt" timestamp with time zone NOT NULL,
    "Capacity" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_tickets (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EventId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Code" character varying(40) NOT NULL,
    "OrderId" uuid NOT NULL,
    "State" character varying(16) NOT NULL,
    "UsedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: pos_venues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_venues (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "StoreId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Capacity" integer NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: pos_waiter_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pos_waiter_settlements (
    "Id" uuid NOT NULL,
    "SessionId" uuid NOT NULL,
    "WaiterUserId" uuid NOT NULL,
    "WaiterName" character varying(120) NOT NULL,
    "Expected" numeric(18,2) NOT NULL,
    "Handed" numeric(18,2) NOT NULL,
    "Difference" numeric(18,2) NOT NULL,
    "Reason" character varying(256),
    "CreatedByUserId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: price_change_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.price_change_lines (
    "Id" uuid NOT NULL,
    "PriceChangeId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "NewPrice" numeric(18,4) NOT NULL,
    "OldPrice" numeric(18,4),
    "Quantity" numeric(18,4),
    "Difference" numeric(18,2),
    "MinQuantity" numeric(18,4) DEFAULT 0.0 NOT NULL
);


--
-- Name: price_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.price_changes (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PriceListId" uuid NOT NULL,
    "State" character varying(16) NOT NULL,
    "Number" character varying(64),
    "Date" date NOT NULL,
    "Notes" character varying(2000),
    "PostedByUserId" uuid,
    "PostedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: price_list_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.price_list_prices (
    "Id" uuid NOT NULL,
    "PriceListId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Price" numeric(18,4) NOT NULL,
    "ValidFrom" date NOT NULL,
    "PriceChangeId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "MinQuantity" numeric(18,4) DEFAULT 0.0 NOT NULL
);


--
-- Name: price_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.price_lists (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "WarehouseId" uuid,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "IsCustomerList" boolean DEFAULT false NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.projects (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(32) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "IsActive" boolean NOT NULL
);


--
-- Name: public_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.public_holidays (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Date" date NOT NULL,
    "Name" character varying(128) NOT NULL
);


--
-- Name: purchase_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
    "Id" uuid NOT NULL,
    "PurchaseOrderId" uuid NOT NULL,
    "ItemId" uuid,
    "Description" character varying(512) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "SortOrder" integer NOT NULL
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "Number" character varying(64),
    "Date" date NOT NULL,
    "ExpectedDate" date,
    "WarehouseId" uuid,
    "State" character varying(16) NOT NULL,
    "VendorReference" character varying(128),
    "Notes" character varying(2000),
    "CreatedAt" timestamp with time zone NOT NULL,
    "CreatedByUserId" uuid,
    "ConfirmedAt" timestamp with time zone,
    "ClosedAt" timestamp with time zone
);


--
-- Name: re_buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_buildings (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "ProjectId" uuid NOT NULL,
    "Name" character varying(160) NOT NULL,
    "Address" character varying(300),
    "SaleItemId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: re_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_installments (
    "Id" uuid NOT NULL,
    "ContractId" uuid NOT NULL,
    "Number" integer NOT NULL,
    "DueDate" date NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "InvoiceId" uuid
);


--
-- Name: re_lease_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_lease_invoices (
    "Id" uuid NOT NULL,
    "LeaseId" uuid NOT NULL,
    "Period" date NOT NULL,
    "InvoiceId" uuid NOT NULL
);


--
-- Name: re_lease_meters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_lease_meters (
    "Id" uuid NOT NULL,
    "LeaseId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "ItemId" uuid NOT NULL,
    "LastReading" numeric(18,3) NOT NULL,
    "PendingReading" numeric(18,3)
);


--
-- Name: re_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_leases (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Number" character varying(20) NOT NULL,
    "UnitId" uuid,
    "Property" character varying(300),
    "TenantPartnerId" uuid NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date,
    "Rent" numeric(18,2) NOT NULL,
    "RentItemId" uuid NOT NULL,
    "DueDay" integer NOT NULL,
    "Deposit" numeric(18,2) NOT NULL,
    "DepositReceivedOn" date,
    "DepositReturnedOn" date,
    "State" character varying(16) NOT NULL,
    "Notes" character varying(2000),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: re_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_reservations (
    "Id" uuid NOT NULL,
    "UnitId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "Date" date NOT NULL,
    "ExpiresOn" date NOT NULL,
    "Deposit" numeric(18,2) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Notes" character varying(1000)
);


--
-- Name: re_sale_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_sale_contracts (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "UnitId" uuid NOT NULL,
    "BuyerPartnerId" uuid NOT NULL,
    "Number" character varying(20) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "ContractDate" date NOT NULL,
    "Price" numeric(18,2) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Notes" character varying(2000),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: re_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.re_units (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "BuildingId" uuid NOT NULL,
    "Number" character varying(20) NOT NULL,
    "Floor" character varying(10),
    "Kind" character varying(16) NOT NULL,
    "Area" numeric(10,2) NOT NULL,
    "ListPrice" numeric(18,2) NOT NULL,
    "State" character varying(16) NOT NULL
);


--
-- Name: receipt_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.receipt_matches (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "BillId" uuid NOT NULL,
    "BillLineId" uuid NOT NULL,
    "ReceiptLineId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "Value" numeric(18,2) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.reconciliations (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "InvoiceId" uuid,
    "BillId" uuid,
    "JournalEntryLineId" uuid NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "ReconciledAt" timestamp with time zone NOT NULL,
    CONSTRAINT ck_reconciliations_scope CHECK (((("InvoiceId" IS NOT NULL) AND ("BillId" IS NULL)) OR (("BillId" IS NOT NULL) AND ("InvoiceId" IS NULL))))
);


--
-- Name: route_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.route_visits (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "RouteId" uuid,
    "PartnerId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Date" date NOT NULL,
    "CheckInAt" timestamp with time zone NOT NULL,
    "CheckOutAt" timestamp with time zone,
    "Latitude" double precision,
    "Longitude" double precision,
    "AccuracyMeters" double precision,
    "Outcome" character varying(16) NOT NULL,
    "Collected" numeric(18,2) NOT NULL,
    "Notes" character varying(1000)
);


--
-- Name: sales_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sales_order_lines (
    "Id" uuid NOT NULL,
    "SalesOrderId" uuid NOT NULL,
    "ItemId" uuid,
    "Description" character varying(512) NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitName" character varying(32),
    "UnitFactor" numeric(18,4) NOT NULL,
    "UnitPrice" numeric(18,4) NOT NULL,
    "DiscountPercent" numeric(5,2) NOT NULL,
    "TaxDefinitionId" uuid,
    "SortOrder" integer NOT NULL
);


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sales_orders (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "State" character varying(16) NOT NULL,
    "QuoteNumber" character varying(64),
    "Number" character varying(64),
    "Date" date NOT NULL,
    "ValidUntil" date,
    "DeliveryDate" date,
    "WarehouseId" uuid,
    "CustomerReference" character varying(128),
    "DeliveryAddress" character varying(500),
    "Notes" character varying(2000),
    "RouteVisitId" uuid,
    "BlockOverriddenByUserId" uuid,
    "BlockOverrideReason" character varying(500),
    "CreatedAt" timestamp with time zone NOT NULL,
    "CreatedByUserId" uuid,
    "QuotedAt" timestamp with time zone,
    "ConfirmedAt" timestamp with time zone,
    "ClosedAt" timestamp with time zone
);


--
-- Name: sales_route_stops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sales_route_stops (
    "Id" uuid NOT NULL,
    "RouteId" uuid NOT NULL,
    "PartnerId" uuid NOT NULL,
    "Sequence" integer NOT NULL,
    "Notes" character varying(500)
);


--
-- Name: sales_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sales_routes (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(120) NOT NULL,
    "UserId" uuid,
    "WarehouseId" uuid,
    "Days" integer NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: statutory_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.statutory_parameters (
    "Id" uuid NOT NULL,
    "FirmId" uuid NOT NULL,
    "Key" character varying(64) NOT NULL,
    "EffectiveFrom" date NOT NULL,
    "Value" numeric(18,4) NOT NULL,
    "Source" character varying(256),
    "CreatedByUserId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: stock_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_balances (
    "ItemId" uuid NOT NULL,
    "LocationId" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL
);


--
-- Name: stock_document_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_document_lines (
    "Id" uuid NOT NULL,
    "StockDocumentId" uuid NOT NULL,
    "ItemId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitCost" numeric(18,6),
    "BookQuantity" numeric(18,4),
    "Difference" numeric(18,4),
    "Note" character varying(500),
    "AllowanceAfter" numeric(18,2),
    "Amount" numeric(18,2),
    "AverageCost" numeric(18,6),
    "ExpiryDate" date,
    "LotNumber" character varying(64),
    "PurchaseOrderLineId" uuid,
    "CostCodeId" uuid,
    "SalesOrderLineId" uuid
);


--
-- Name: stock_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_documents (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Type" character varying(16) NOT NULL,
    "State" character varying(16) NOT NULL,
    "Number" character varying(64),
    "Date" date NOT NULL,
    "WarehouseId" uuid NOT NULL,
    "DestinationWarehouseId" uuid,
    "Reason" character varying(16),
    "AtkNoticeDate" date,
    "Notes" character varying(2000),
    "JournalEntryId" uuid,
    "PostedByUserId" uuid,
    "PostedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "PartnerId" uuid,
    "SiteId" uuid
);


--
-- Name: stock_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_locations (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "WarehouseId" uuid,
    "Name" character varying(120) NOT NULL,
    "Usage" character varying(16) NOT NULL
);


--
-- Name: stock_move_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_move_lots (
    "Id" uuid NOT NULL,
    "StockMoveId" uuid NOT NULL,
    "LotId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL
);


--
-- Name: stock_moves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_moves (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Sequence" bigint NOT NULL,
    "Date" date NOT NULL,
    "ItemId" uuid NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "FromLocationId" uuid NOT NULL,
    "ToLocationId" uuid NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitCost" numeric(18,6) NOT NULL,
    "Value" numeric(18,2) NOT NULL,
    "ValueDelta" numeric(18,2) NOT NULL,
    "Correction" numeric(18,2) NOT NULL,
    "QtyAfter" numeric(18,4) NOT NULL,
    "AvgCostAfter" numeric(18,6) NOT NULL,
    "ValueAfter" numeric(18,2) NOT NULL,
    "SourceType" character varying(16) NOT NULL,
    "SourceId" uuid NOT NULL,
    "SourceLineId" uuid,
    "Reference" character varying(64),
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: stock_moves_Sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--



--
-- Name: stock_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.stock_settings (
    "CompanyId" uuid NOT NULL,
    "CostMethod" character varying(16) NOT NULL,
    "CostMethodSince" date,
    "NegativeStock" character varying(8) NOT NULL,
    "DefaultWarehouseId" uuid,
    "UpdatedAt" timestamp with time zone NOT NULL
);


--
-- Name: tax_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.tax_definitions (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Name" character varying(256) NOT NULL,
    "Rate" numeric(5,4) NOT NULL,
    "Type" integer NOT NULL,
    "Scope" integer NOT NULL,
    "IsActive" boolean NOT NULL,
    "AtkBook" integer,
    "Code" character varying(16),
    "DeductiblePercent" numeric(5,2),
    "Direction" integer,
    "IsReverseCharge" boolean DEFAULT false NOT NULL
);


--
-- Name: tax_repartition_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.tax_repartition_lines (
    "Id" uuid NOT NULL,
    "TaxDefinitionId" uuid NOT NULL,
    "Percentage" numeric(5,2) NOT NULL,
    "AccountId" uuid NOT NULL,
    "Tag" character varying(64)
);


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.time_entries (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Date" date NOT NULL,
    "Hours" numeric(5,2) NOT NULL,
    "Kind" character varying(16) NOT NULL,
    "Source" character varying(16) NOT NULL,
    "Note" character varying(256),
    "ApprovedByUserId" uuid,
    "ApprovedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: user_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_favorites (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "EntityType" character varying(50) NOT NULL,
    "EntityId" uuid NOT NULL,
    "IsPinned" boolean DEFAULT false NOT NULL,
    "IsSuppressed" boolean DEFAULT false NOT NULL,
    "SelectionCount" integer DEFAULT 0 NOT NULL,
    "LastSelectedAtUtc" timestamp with time zone,
    "CreatedAtUtc" timestamp with time zone NOT NULL
);


--
-- Name: user_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_invitations (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Email" character varying(256) NOT NULL,
    "FullName" character varying(160),
    "TokenHash" character varying(64) NOT NULL,
    "Role" character varying(32) NOT NULL,
    "CompanyRoleId" uuid,
    "EmployeeId" uuid,
    "InvitedByUserId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    "AcceptedAt" timestamp with time zone,
    "RevokedAt" timestamp with time zone
);


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.warehouses (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Name" character varying(120) NOT NULL,
    "Address" character varying(256),
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "DriverUserId" uuid,
    "IsVan" boolean DEFAULT false NOT NULL
);


--
-- Name: withholding_tax_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.withholding_tax_entries (
    "Id" uuid NOT NULL,
    "CompanyId" uuid NOT NULL,
    "Year" integer NOT NULL,
    "PersonalNumber" character varying(50) NOT NULL,
    "Name" character varying(256) NOT NULL,
    "GrossInterest" numeric(18,2) NOT NULL,
    "PropertyRights" numeric(18,2) NOT NULL,
    "LotteryWinnings" numeric(18,2) NOT NULL,
    "GrossRent" numeric(18,2) NOT NULL,
    "NonResidentEntertainer" numeric(18,2) NOT NULL,
    "NonResidentServices" numeric(18,2) NOT NULL,
    "NonEntrepreneur" numeric(18,2) NOT NULL,
    "RentalAreaM2" numeric(18,2),
    "MonthlyGrossRent" numeric(18,2),
    "Country" character varying(100) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL
);


--
-- Data for Name: AspNetUserClaims; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: AspNetUserLogins; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: AspNetUserTokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: AspNetUsers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: __EFMigrationsHistory; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: account_groups; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: account_lock_exceptions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: account_requests; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: attachments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: audit_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bill_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: commission_plans; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: company_account_defaults; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: company_bank_accounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: company_notification_settings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: company_roles; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: construction_boq_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: construction_cost_codes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: construction_progress_bill_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: construction_progress_bills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: construction_sites; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cost_centers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dashboard_layouts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: document_edit_audits; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: document_number_audits; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employee_contracts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employee_loans; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employee_partner_assignment_periods; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employee_partner_assignments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employee_profile_changes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: expense_claim_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: expense_claims; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: firms; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: fiscal_documents; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_attribute_values; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_attributes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_barcodes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_categories; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_costs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_cross_references; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_fitments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_recipe_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_serials; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: item_variant_values; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: job_locks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: journal_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: journal_entry_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: journals; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: leave_allocations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: leave_requests; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: leave_types; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: lot_balances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: lots; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: memberships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: number_series; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: partners; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: payment_methods; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: payroll_adjustments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: payroll_runs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: payslip_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: platform_audit_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_appointments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_barcode_rules; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_cash_movements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_channel_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_channel_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_combo_choices; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_combo_slots; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_customer_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_customer_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_event_bookings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_event_ticket_types; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_fleet_cards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_floors; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_fuel_nozzles; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_fuel_tanks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_gift_card_movements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_gift_cards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_hotel_bookings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_hotel_guests; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_item_modifier_groups; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_kitchen_ticket_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_kitchen_tickets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_loyalty_cards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_memberships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_meter_readings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_modifier_groups; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_modifiers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_packages; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_payers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_payments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_pins; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_prescription_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_prescriptions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_production_centers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_program_targets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_programs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_registers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_repair_ticket_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_repair_tickets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_resource_hours; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_resources; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_room_types; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_rooms; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_sales_channels; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_service_resources; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_session_tenders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_sessions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_stores; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_tab_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_tables; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_tabs; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_tank_dips; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_ticketed_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_tickets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_venues; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pos_waiter_settlements; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: price_change_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: price_changes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: price_list_prices; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: price_lists; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: public_holidays; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_buildings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_installments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_lease_invoices; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_lease_meters; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_leases; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_reservations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_sale_contracts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: re_units; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: receipt_matches; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: reconciliations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: route_visits; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sales_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sales_orders; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sales_route_stops; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sales_routes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: statutory_parameters; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_balances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_document_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_documents; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_locations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_move_lots; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_moves; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_settings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tax_definitions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tax_repartition_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: time_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_favorites; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_invitations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: warehouses; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: withholding_tax_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: AspNetUserClaims_Id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--



--
-- Name: stock_moves_Sequence_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--



--
-- Name: AspNetUserClaims PK_AspNetUserClaims; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: AspNetUserLogins PK_AspNetUserLogins; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: AspNetUserTokens PK_AspNetUserTokens; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: AspNetUsers PK_AspNetUsers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: account_groups PK_account_groups; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: account_lock_exceptions PK_account_lock_exceptions; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: account_requests PK_account_requests; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: accounts PK_accounts; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: attachments PK_attachments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: audit_entries PK_audit_entries; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bill_lines PK_bill_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bills PK_bills; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: commission_plans PK_commission_plans; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: companies PK_companies; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_account_defaults PK_company_account_defaults; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_bank_accounts PK_company_bank_accounts; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_notification_settings PK_company_notification_settings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_roles PK_company_roles; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_boq_lines PK_construction_boq_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_cost_codes PK_construction_cost_codes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bill_lines PK_construction_progress_bill_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bills PK_construction_progress_bills; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_sites PK_construction_sites; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: cost_centers PK_cost_centers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: dashboard_layouts PK_dashboard_layouts; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: departments PK_departments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: document_edit_audits PK_document_edit_audits; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: document_number_audits PK_document_number_audits; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_contracts PK_employee_contracts; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_loans PK_employee_loans; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_partner_assignment_periods PK_employee_partner_assignment_periods; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_partner_assignments PK_employee_partner_assignments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_profile_changes PK_employee_profile_changes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employees PK_employees; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: expense_claim_lines PK_expense_claim_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: expense_claims PK_expense_claims; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: firms PK_firms; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: fiscal_documents PK_fiscal_documents; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoice_lines PK_invoice_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoices PK_invoices; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_attribute_values PK_item_attribute_values; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_attributes PK_item_attributes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_barcodes PK_item_barcodes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_categories PK_item_categories; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_costs PK_item_costs; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_cross_references PK_item_cross_references; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_fitments PK_item_fitments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_recipe_lines PK_item_recipe_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_serials PK_item_serials; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_variant_values PK_item_variant_values; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items PK_items; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: job_locks PK_job_locks; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: journal_entries PK_journal_entries; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: journal_entry_lines PK_journal_entry_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: journals PK_journals; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_allocations PK_leave_allocations; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_requests PK_leave_requests; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_types PK_leave_types; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lot_balances PK_lot_balances; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lots PK_lots; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: memberships PK_memberships; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: notifications PK_notifications; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: number_series PK_number_series; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: partners PK_partners; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payment_methods PK_payment_methods; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payroll_adjustments PK_payroll_adjustments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payroll_runs PK_payroll_runs; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payslip_lines PK_payslip_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: platform_audit_entries PK_platform_audit_entries; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments PK_pos_appointments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_barcode_rules PK_pos_barcode_rules; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_cash_movements PK_pos_cash_movements; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_order_lines PK_pos_channel_order_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_orders PK_pos_channel_orders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_combo_choices PK_pos_combo_choices; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_combo_slots PK_pos_combo_slots; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_order_lines PK_pos_customer_order_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders PK_pos_customer_orders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings PK_pos_event_bookings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_ticket_types PK_pos_event_ticket_types; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fleet_cards PK_pos_fleet_cards; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_floors PK_pos_floors; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_nozzles PK_pos_fuel_nozzles; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_tanks PK_pos_fuel_tanks; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_card_movements PK_pos_gift_card_movements; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_cards PK_pos_gift_cards; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings PK_pos_hotel_bookings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_guests PK_pos_hotel_guests; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_item_modifier_groups PK_pos_item_modifier_groups; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_ticket_lines PK_pos_kitchen_ticket_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_tickets PK_pos_kitchen_tickets; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_loyalty_cards PK_pos_loyalty_cards; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_memberships PK_pos_memberships; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_meter_readings PK_pos_meter_readings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_modifier_groups PK_pos_modifier_groups; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_modifiers PK_pos_modifiers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines PK_pos_order_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders PK_pos_orders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_packages PK_pos_packages; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payers PK_pos_payers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payments PK_pos_payments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_pins PK_pos_pins; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescription_lines PK_pos_prescription_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescriptions PK_pos_prescriptions; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_production_centers PK_pos_production_centers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_program_targets PK_pos_program_targets; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_programs PK_pos_programs; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_registers PK_pos_registers; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_ticket_lines PK_pos_repair_ticket_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_tickets PK_pos_repair_tickets; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_resource_hours PK_pos_resource_hours; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_resources PK_pos_resources; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_room_types PK_pos_room_types; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_rooms PK_pos_rooms; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sales_channels PK_pos_sales_channels; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_service_resources PK_pos_service_resources; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_session_tenders PK_pos_session_tenders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sessions PK_pos_sessions; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores PK_pos_stores; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tab_lines PK_pos_tab_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tables PK_pos_tables; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tabs PK_pos_tabs; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tank_dips PK_pos_tank_dips; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_ticketed_events PK_pos_ticketed_events; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tickets PK_pos_tickets; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_venues PK_pos_venues; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_waiter_settlements PK_pos_waiter_settlements; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_change_lines PK_price_change_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_changes PK_price_changes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_list_prices PK_price_list_prices; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_lists PK_price_lists; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: projects PK_projects; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: public_holidays PK_public_holidays; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_order_lines PK_purchase_order_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_orders PK_purchase_orders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_buildings PK_re_buildings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_installments PK_re_installments; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_invoices PK_re_lease_invoices; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_meters PK_re_lease_meters; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_leases PK_re_leases; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_reservations PK_re_reservations; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_sale_contracts PK_re_sale_contracts; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_units PK_re_units; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: receipt_matches PK_receipt_matches; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: reconciliations PK_reconciliations; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: route_visits PK_route_visits; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_order_lines PK_sales_order_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_orders PK_sales_orders; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_route_stops PK_sales_route_stops; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_routes PK_sales_routes; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: statutory_parameters PK_statutory_parameters; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_balances PK_stock_balances; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines PK_stock_document_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents PK_stock_documents; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_locations PK_stock_locations; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_move_lots PK_stock_move_lots; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_moves PK_stock_moves; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_settings PK_stock_settings; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: tax_definitions PK_tax_definitions; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: tax_repartition_lines PK_tax_repartition_lines; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: time_entries PK_time_entries; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: user_favorites PK_user_favorites; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: user_invitations PK_user_invitations; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: warehouses PK_warehouses; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: withholding_tax_entries PK_withholding_tax_entries; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: EmailIndex; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_AspNetUserClaims_UserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_AspNetUserLogins_UserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_account_groups_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_account_groups_ParentGroupId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_account_lock_exceptions_CompanyId_UserId_LockDateField; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_account_requests_Email; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_account_requests_Status_CreatedAt; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_accounts_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_attachments_CompanyId_OwnerType_OwnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_audit_entries_CompanyId_EntityType_EntityId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_audit_entries_CompanyId_OccurredAtUtc; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bill_lines_BillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bill_lines_CostCodeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bill_lines_ExpenseAccountId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bill_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bill_lines_PurchaseOrderLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bills_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bills_OriginalBillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bills_ProjectId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_bills_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_commission_plans_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_companies_FirmId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_company_account_defaults_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_company_bank_accounts_CompanyId_SortOrder; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_company_roles_CompanyId_BuiltInKey; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_company_roles_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_boq_lines_SiteId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_cost_codes_SiteId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_progress_bill_lines_BoqLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_progress_bill_lines_ProgressBillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_progress_bills_InvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_progress_bills_SiteId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_sites_BillingItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_sites_ClientPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_sites_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_construction_sites_ProjectId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_cost_centers_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_dashboard_layouts_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_departments_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_document_edit_audits_CompanyId_DocumentId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_document_number_audits_CompanyId_DocumentId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_contracts_EmployeeId_StartDate; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_loans_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_loans_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_partner_assignment_periods_CompanyId_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_partner_assignment_periods_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_partner_assignments_CompanyId_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_partner_assignments_EmployeeId_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_partner_assignments_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_profile_changes_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employee_profile_changes_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employees_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employees_CompanyId_PersonalNumber; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employees_CompanyId_UserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_employees_DepartmentId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_expense_claim_lines_ExpenseClaimId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_expense_claims_BillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_expense_claims_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_expense_claims_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_fiscal_documents_CompanyId_AtkStatus; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_fiscal_documents_CompanyId_CouponId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_fiscal_documents_OrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_fiscal_documents_RegisterId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoice_lines_DeliveryLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoice_lines_InvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoice_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoice_lines_RevenueAccountId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoice_lines_SalesOrderLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoices_CompanyId_InvoiceNumber; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoices_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoices_OriginalInvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoices_ProjectId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_invoices_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_attribute_values_AttributeId_Value; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_attributes_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_barcodes_CompanyId_Barcode; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_barcodes_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_categories_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_costs_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_cross_references_ItemId_Brand_Normalized; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_cross_references_Normalized; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_fitments_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_fitments_Make_Model; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_recipe_lines_IngredientItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_recipe_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_serials_CompanyId_ItemId_Serial; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_serials_CompanyId_Serial; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_serials_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_item_variant_values_AttributeValueId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_AgencyPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_CategoryId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_CompanyId_Plu; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_DepositItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_PackageServiceItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_ProductionCenterId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_items_VariantOfItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_journal_entries_CompanyId_JournalId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_journal_entry_lines_AccountId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_journal_entry_lines_JournalEntryId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_journals_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_allocations_EmployeeId_LeaveTypeId_Year; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_allocations_LeaveTypeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_requests_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_requests_EmployeeId_StartDate; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_requests_LeaveTypeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_leave_types_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_lot_balances_ItemId_LocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_lot_balances_LocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_lots_CompanyId_ExpiryDate; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_lots_ItemId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_memberships_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_memberships_CompanyRoleId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_memberships_FirmId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_memberships_UserId_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_memberships_UserId_FirmId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_notifications_CompanyId_CreatedAt; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_notifications_State_NextAttemptAt; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_number_series_CompanyId_DocumentType_Year; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_partners_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_partners_CompanyId_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_partners_CompanyId_TaxNumber_Unique; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_partners_PriceListId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payment_methods_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_adjustments_CompanyId_Period; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_adjustments_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_adjustments_EmployeeLoanId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_adjustments_ExpenseClaimId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_adjustments_PayrollRunId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payroll_runs_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payslip_lines_EmployeeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_payslip_lines_PayrollRunId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_platform_audit_entries_OccurredAtUtc; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_platform_audit_entries_TargetType_TargetId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_DepositCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_ResourceId_Start; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_appointments_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_barcode_rules_CompanyId_Prefix; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_cash_movements_SessionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_channel_order_lines_ChannelOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_channel_order_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_channel_orders_ChannelId_ExternalRef; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_channel_orders_CompanyId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_channel_orders_CourierPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_combo_choices_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_combo_choices_SlotId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_combo_slots_ComboItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_order_lines_CustomerOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_order_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_orders_CollectedOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_orders_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_orders_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_orders_DepositCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_customer_orders_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_DepositCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_PackageItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_TabId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_bookings_VenueId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_ticket_types_EventId_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_event_ticket_types_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fleet_cards_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fleet_cards_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_floors_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_floors_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_nozzles_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_nozzles_StoreId_Pump_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_nozzles_TankId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_tanks_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_tanks_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_fuel_tanks_StoreId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_gift_card_movements_GiftCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_gift_card_movements_OrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_gift_cards_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_gift_cards_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_CompanyPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_DepositCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_FolioTabId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_RoomId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_RoomTypeId_Arrival; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_bookings_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_hotel_guests_BookingId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_item_modifier_groups_GroupId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_kitchen_ticket_lines_TicketId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_kitchen_tickets_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_kitchen_tickets_ProductionCenterId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_kitchen_tickets_StoreId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_kitchen_tickets_TabId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_loyalty_cards_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_loyalty_cards_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_memberships_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_memberships_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_memberships_PlanItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_meter_readings_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_meter_readings_NozzleId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_meter_readings_SessionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_modifier_groups_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_modifiers_GroupId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_modifiers_IngredientItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_order_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_order_lines_NozzleId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_order_lines_OrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_order_lines_PrescriptionLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_order_lines_TabLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_AppointmentId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_ChannelOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_CompanyId_ClientUuid; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_CompanyId_OrderedAt; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_FleetCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_LoyaltyCardId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_OriginalOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_PrescriptionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_RepairTicketId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_SessionId_Kind; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_orders_TabId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_packages_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_packages_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_packages_ServiceItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_payers_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_payers_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_payments_OrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_payments_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_payments_PaymentMethodId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_pins_CompanyId_UserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_prescription_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_prescription_lines_PrescriptionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_prescriptions_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_prescriptions_PayerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_prescriptions_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_production_centers_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_production_centers_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_program_targets_CategoryId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_program_targets_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_program_targets_ProgramId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_programs_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_programs_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_registers_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_registers_StoreId_FiscalPosNumber; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_repair_ticket_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_repair_ticket_lines_TicketId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_repair_tickets_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_repair_tickets_CustomerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_repair_tickets_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_resource_hours_ResourceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_resources_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_resources_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_room_types_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_room_types_RateItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_room_types_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_rooms_RoomTypeId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sales_channels_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sales_channels_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sales_channels_Token; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_service_resources_ResourceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_session_tenders_SessionId_PaymentMethodId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sessions_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sessions_RegisterId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_sessions_one_open; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_BookingToken; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_CompanyId_FiscalBranchNumber; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_PriceListId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_TipsAccountId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_TouristTaxItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_stores_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tab_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tab_lines_TabId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tables_FloorId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tables_QrToken; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tabs_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tabs_StoreId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tabs_TableId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tank_dips_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tank_dips_TankId_MeasuredAt; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_ticketed_events_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_ticketed_events_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tickets_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tickets_EventId_State; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_tickets_OrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_venues_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_venues_StoreId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_pos_waiter_settlements_SessionId_WaiterUserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_change_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_change_lines_PriceChangeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_changes_CompanyId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_changes_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_changes_PriceListId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_list_prices_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_list_prices_PriceChangeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_list_prices_PriceListId_ItemId_ValidFrom; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_lists_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_lists_CompanyId_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_price_lists_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_projects_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_public_holidays_CompanyId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_order_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_order_lines_PurchaseOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_orders_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_orders_CompanyId_State_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_orders_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_purchase_orders_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_buildings_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_buildings_ProjectId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_buildings_SaleItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_installments_ContractId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_installments_InvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_lease_invoices_InvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_lease_invoices_LeaseId_Period; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_lease_meters_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_lease_meters_LeaseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_leases_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_leases_RentItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_leases_TenantPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_leases_UnitId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_reservations_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_reservations_UnitId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_sale_contracts_BuyerPartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_sale_contracts_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_sale_contracts_UnitId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_re_units_BuildingId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_receipt_matches_BillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_receipt_matches_CompanyId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_receipt_matches_ReceiptLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_reconciliations_BillId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_reconciliations_InvoiceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_reconciliations_JournalEntryLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_route_visits_CompanyId_Date_UserId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_route_visits_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_route_visits_RouteId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_order_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_order_lines_SalesOrderId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_order_lines_TaxDefinitionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_CompanyId_QuoteNumber; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_CompanyId_State_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_RouteVisitId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_orders_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_route_stops_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_route_stops_RouteId_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_routes_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_sales_routes_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_statutory_parameters_FirmId_Key_EffectiveFrom; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_balances_CompanyId_LocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_balances_LocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_document_lines_CostCodeId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_document_lines_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_document_lines_PurchaseOrderLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_document_lines_SalesOrderLineId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_document_lines_StockDocumentId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_CompanyId_Number; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_CompanyId_Type_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_DestinationWarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_PartnerId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_SiteId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_documents_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_locations_CompanyId_Usage_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_locations_WarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_move_lots_LotId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_move_lots_StockMoveId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_moves_CompanyId_ItemId_Date_Sequence; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_moves_FromLocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_moves_ItemId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_moves_SourceType_SourceId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_moves_ToLocationId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_stock_settings_DefaultWarehouseId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_tax_definitions_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_tax_definitions_CompanyId_Name; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_tax_repartition_lines_AccountId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_tax_repartition_lines_TaxDefinitionId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_time_entries_CompanyId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_time_entries_EmployeeId_Date; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_user_favorites_UserId_CompanyId_EntityType; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_user_favorites_UserId_CompanyId_EntityType_EntityId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_user_invitations_CompanyId_Email; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_user_invitations_CompanyRoleId; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_user_invitations_TokenHash; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_warehouses_CompanyId_Code; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: IX_withholding_tax_entries_CompanyId_Year; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: UserNameIndex; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: ix_items_name_trgm; Type: INDEX; Schema: public; Owner: -
--



--
-- Name: journal_entries trg_enforce_journal_entry_balance; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: reconciliations trg_enforce_reconciliation_line_capacity; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: AspNetUserClaims FK_AspNetUserClaims_AspNetUsers_UserId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: AspNetUserLogins FK_AspNetUserLogins_AspNetUsers_UserId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: AspNetUserTokens FK_AspNetUserTokens_AspNetUsers_UserId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: account_groups FK_account_groups_account_groups_ParentGroupId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bill_lines FK_bill_lines_bills_BillId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bill_lines FK_bill_lines_construction_cost_codes_CostCodeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bill_lines FK_bill_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bill_lines FK_bill_lines_purchase_order_lines_PurchaseOrderLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bills FK_bills_bills_OriginalBillId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bills FK_bills_projects_ProjectId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: bills FK_bills_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: companies FK_companies_firms_FirmId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_bank_accounts FK_company_bank_accounts_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_notification_settings FK_company_notification_settings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: company_roles FK_company_roles_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_boq_lines FK_construction_boq_lines_construction_sites_SiteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_cost_codes FK_construction_cost_codes_construction_sites_SiteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bill_lines FK_construction_progress_bill_lines_construction_boq_lines_Boq~; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bill_lines FK_construction_progress_bill_lines_construction_progress_bill~; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bills FK_construction_progress_bills_construction_sites_SiteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_progress_bills FK_construction_progress_bills_invoices_InvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_sites FK_construction_sites_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_sites FK_construction_sites_items_BillingItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_sites FK_construction_sites_partners_ClientPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: construction_sites FK_construction_sites_projects_ProjectId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: dashboard_layouts FK_dashboard_layouts_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_contracts FK_employee_contracts_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_loans FK_employee_loans_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_partner_assignment_periods FK_employee_partner_assignment_periods_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_partner_assignments FK_employee_partner_assignments_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_partner_assignments FK_employee_partner_assignments_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: employee_profile_changes FK_employee_profile_changes_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: expense_claim_lines FK_expense_claim_lines_expense_claims_ExpenseClaimId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: expense_claims FK_expense_claims_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: fiscal_documents FK_fiscal_documents_pos_orders_OrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: fiscal_documents FK_fiscal_documents_pos_registers_RegisterId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoice_lines FK_invoice_lines_invoices_InvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoice_lines FK_invoice_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoice_lines FK_invoice_lines_sales_order_lines_SalesOrderLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoice_lines FK_invoice_lines_stock_document_lines_DeliveryLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoices FK_invoices_invoices_OriginalInvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoices FK_invoices_projects_ProjectId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: invoices FK_invoices_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_attribute_values FK_item_attribute_values_item_attributes_AttributeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_attributes FK_item_attributes_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_barcodes FK_item_barcodes_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_categories FK_item_categories_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_costs FK_item_costs_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_cross_references FK_item_cross_references_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_fitments FK_item_fitments_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_recipe_lines FK_item_recipe_lines_items_IngredientItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_recipe_lines FK_item_recipe_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_serials FK_item_serials_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_serials FK_item_serials_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_variant_values FK_item_variant_values_item_attribute_values_AttributeValueId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: item_variant_values FK_item_variant_values_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_item_categories_CategoryId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_items_DepositItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_items_PackageServiceItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_items_VariantOfItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_partners_AgencyPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: items FK_items_pos_production_centers_ProductionCenterId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: journal_entry_lines FK_journal_entry_lines_journal_entries_JournalEntryId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_allocations FK_leave_allocations_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_allocations FK_leave_allocations_leave_types_LeaveTypeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_requests FK_leave_requests_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: leave_requests FK_leave_requests_leave_types_LeaveTypeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lot_balances FK_lot_balances_lots_LotId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lot_balances FK_lot_balances_stock_locations_LocationId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lots FK_lots_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: lots FK_lots_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: memberships FK_memberships_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: memberships FK_memberships_company_roles_CompanyRoleId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: memberships FK_memberships_firms_FirmId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: notifications FK_notifications_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: partners FK_partners_price_lists_PriceListId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payroll_adjustments FK_payroll_adjustments_employee_loans_EmployeeLoanId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payroll_adjustments FK_payroll_adjustments_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: payslip_lines FK_payslip_lines_payroll_runs_PayrollRunId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_pos_gift_cards_DepositCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_pos_resources_ResourceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_appointments FK_pos_appointments_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_barcode_rules FK_pos_barcode_rules_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_cash_movements FK_pos_cash_movements_pos_sessions_SessionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_order_lines FK_pos_channel_order_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_order_lines FK_pos_channel_order_lines_pos_channel_orders_ChannelOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_orders FK_pos_channel_orders_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_orders FK_pos_channel_orders_partners_CourierPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_channel_orders FK_pos_channel_orders_pos_sales_channels_ChannelId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_combo_choices FK_pos_combo_choices_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_combo_choices FK_pos_combo_choices_pos_combo_slots_SlotId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_combo_slots FK_pos_combo_slots_items_ComboItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_order_lines FK_pos_customer_order_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_order_lines FK_pos_customer_order_lines_pos_customer_orders_CustomerOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders FK_pos_customer_orders_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders FK_pos_customer_orders_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders FK_pos_customer_orders_pos_gift_cards_DepositCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders FK_pos_customer_orders_pos_orders_CollectedOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_customer_orders FK_pos_customer_orders_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_items_PackageItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_pos_gift_cards_DepositCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_pos_tabs_TabId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_bookings FK_pos_event_bookings_pos_venues_VenueId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_ticket_types FK_pos_event_ticket_types_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_event_ticket_types FK_pos_event_ticket_types_pos_ticketed_events_EventId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fleet_cards FK_pos_fleet_cards_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fleet_cards FK_pos_fleet_cards_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_floors FK_pos_floors_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_floors FK_pos_floors_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_nozzles FK_pos_fuel_nozzles_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_nozzles FK_pos_fuel_nozzles_pos_fuel_tanks_TankId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_nozzles FK_pos_fuel_nozzles_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_tanks FK_pos_fuel_tanks_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_tanks FK_pos_fuel_tanks_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_fuel_tanks FK_pos_fuel_tanks_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_card_movements FK_pos_gift_card_movements_pos_gift_cards_GiftCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_card_movements FK_pos_gift_card_movements_pos_orders_OrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_cards FK_pos_gift_cards_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_gift_cards FK_pos_gift_cards_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_partners_CompanyPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_pos_gift_cards_DepositCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_pos_room_types_RoomTypeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_pos_rooms_RoomId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_bookings FK_pos_hotel_bookings_pos_tabs_FolioTabId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_hotel_guests FK_pos_hotel_guests_pos_hotel_bookings_BookingId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_item_modifier_groups FK_pos_item_modifier_groups_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_item_modifier_groups FK_pos_item_modifier_groups_pos_modifier_groups_GroupId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_ticket_lines FK_pos_kitchen_ticket_lines_pos_kitchen_tickets_TicketId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_tickets FK_pos_kitchen_tickets_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_tickets FK_pos_kitchen_tickets_pos_production_centers_ProductionCenter~; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_kitchen_tickets FK_pos_kitchen_tickets_pos_tabs_TabId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_loyalty_cards FK_pos_loyalty_cards_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_loyalty_cards FK_pos_loyalty_cards_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_memberships FK_pos_memberships_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_memberships FK_pos_memberships_items_PlanItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_memberships FK_pos_memberships_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_meter_readings FK_pos_meter_readings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_meter_readings FK_pos_meter_readings_pos_fuel_nozzles_NozzleId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_meter_readings FK_pos_meter_readings_pos_sessions_SessionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_modifier_groups FK_pos_modifier_groups_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_modifiers FK_pos_modifiers_items_IngredientItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_modifiers FK_pos_modifiers_pos_modifier_groups_GroupId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines FK_pos_order_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines FK_pos_order_lines_pos_fuel_nozzles_NozzleId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines FK_pos_order_lines_pos_orders_OrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines FK_pos_order_lines_pos_prescription_lines_PrescriptionLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_order_lines FK_pos_order_lines_pos_tab_lines_TabLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_appointments_AppointmentId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_channel_orders_ChannelOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_fleet_cards_FleetCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_loyalty_cards_LoyaltyCardId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_orders_OriginalOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_prescriptions_PrescriptionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_repair_tickets_RepairTicketId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_sessions_SessionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_orders FK_pos_orders_pos_tabs_TabId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_packages FK_pos_packages_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_packages FK_pos_packages_items_ServiceItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_packages FK_pos_packages_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payers FK_pos_payers_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payers FK_pos_payers_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payments FK_pos_payments_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payments FK_pos_payments_payment_methods_PaymentMethodId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_payments FK_pos_payments_pos_orders_OrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_pins FK_pos_pins_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescription_lines FK_pos_prescription_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescription_lines FK_pos_prescription_lines_pos_prescriptions_PrescriptionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescriptions FK_pos_prescriptions_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescriptions FK_pos_prescriptions_pos_payers_PayerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_prescriptions FK_pos_prescriptions_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_production_centers FK_pos_production_centers_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_production_centers FK_pos_production_centers_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_program_targets FK_pos_program_targets_item_categories_CategoryId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_program_targets FK_pos_program_targets_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_program_targets FK_pos_program_targets_pos_programs_ProgramId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_programs FK_pos_programs_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_programs FK_pos_programs_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_registers FK_pos_registers_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_registers FK_pos_registers_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_ticket_lines FK_pos_repair_ticket_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_ticket_lines FK_pos_repair_ticket_lines_pos_repair_tickets_TicketId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_tickets FK_pos_repair_tickets_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_tickets FK_pos_repair_tickets_partners_CustomerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_repair_tickets FK_pos_repair_tickets_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_resource_hours FK_pos_resource_hours_pos_resources_ResourceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_resources FK_pos_resources_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_resources FK_pos_resources_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_room_types FK_pos_room_types_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_room_types FK_pos_room_types_items_RateItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_room_types FK_pos_room_types_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_rooms FK_pos_rooms_pos_room_types_RoomTypeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sales_channels FK_pos_sales_channels_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sales_channels FK_pos_sales_channels_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_service_resources FK_pos_service_resources_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_service_resources FK_pos_service_resources_pos_resources_ResourceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_session_tenders FK_pos_session_tenders_pos_sessions_SessionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sessions FK_pos_sessions_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_sessions FK_pos_sessions_pos_registers_RegisterId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores FK_pos_stores_accounts_TipsAccountId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores FK_pos_stores_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores FK_pos_stores_items_TouristTaxItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores FK_pos_stores_price_lists_PriceListId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_stores FK_pos_stores_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tab_lines FK_pos_tab_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tab_lines FK_pos_tab_lines_pos_tabs_TabId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tables FK_pos_tables_pos_floors_FloorId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tabs FK_pos_tabs_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tabs FK_pos_tabs_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tabs FK_pos_tabs_pos_tables_TableId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tank_dips FK_pos_tank_dips_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tank_dips FK_pos_tank_dips_pos_fuel_tanks_TankId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_ticketed_events FK_pos_ticketed_events_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_ticketed_events FK_pos_ticketed_events_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tickets FK_pos_tickets_pos_orders_OrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_tickets FK_pos_tickets_pos_ticketed_events_EventId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_venues FK_pos_venues_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_venues FK_pos_venues_pos_stores_StoreId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: pos_waiter_settlements FK_pos_waiter_settlements_pos_sessions_SessionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_change_lines FK_price_change_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_change_lines FK_price_change_lines_price_changes_PriceChangeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_changes FK_price_changes_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_changes FK_price_changes_price_lists_PriceListId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_list_prices FK_price_list_prices_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_list_prices FK_price_list_prices_price_changes_PriceChangeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_list_prices FK_price_list_prices_price_lists_PriceListId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_lists FK_price_lists_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: price_lists FK_price_lists_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_order_lines FK_purchase_order_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_order_lines FK_purchase_order_lines_purchase_orders_PurchaseOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_orders FK_purchase_orders_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_orders FK_purchase_orders_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: purchase_orders FK_purchase_orders_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_buildings FK_re_buildings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_buildings FK_re_buildings_items_SaleItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_buildings FK_re_buildings_projects_ProjectId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_installments FK_re_installments_invoices_InvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_installments FK_re_installments_re_sale_contracts_ContractId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_invoices FK_re_lease_invoices_invoices_InvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_invoices FK_re_lease_invoices_re_leases_LeaseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_meters FK_re_lease_meters_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_lease_meters FK_re_lease_meters_re_leases_LeaseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_leases FK_re_leases_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_leases FK_re_leases_items_RentItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_leases FK_re_leases_partners_TenantPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_leases FK_re_leases_re_units_UnitId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_reservations FK_re_reservations_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_reservations FK_re_reservations_re_units_UnitId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_sale_contracts FK_re_sale_contracts_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_sale_contracts FK_re_sale_contracts_partners_BuyerPartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_sale_contracts FK_re_sale_contracts_re_units_UnitId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: re_units FK_re_units_re_buildings_BuildingId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: receipt_matches FK_receipt_matches_bills_BillId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: receipt_matches FK_receipt_matches_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: receipt_matches FK_receipt_matches_stock_document_lines_ReceiptLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: reconciliations FK_reconciliations_bills_BillId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: reconciliations FK_reconciliations_invoices_InvoiceId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: reconciliations FK_reconciliations_journal_entry_lines_JournalEntryLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: route_visits FK_route_visits_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: route_visits FK_route_visits_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: route_visits FK_route_visits_sales_routes_RouteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_order_lines FK_sales_order_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_order_lines FK_sales_order_lines_sales_orders_SalesOrderId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_order_lines FK_sales_order_lines_tax_definitions_TaxDefinitionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_orders FK_sales_orders_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_orders FK_sales_orders_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_orders FK_sales_orders_route_visits_RouteVisitId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_orders FK_sales_orders_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_route_stops FK_sales_route_stops_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_route_stops FK_sales_route_stops_sales_routes_RouteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_routes FK_sales_routes_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sales_routes FK_sales_routes_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: statutory_parameters FK_statutory_parameters_firms_FirmId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_balances FK_stock_balances_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_balances FK_stock_balances_stock_locations_LocationId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines FK_stock_document_lines_construction_cost_codes_CostCodeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines FK_stock_document_lines_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines FK_stock_document_lines_purchase_order_lines_PurchaseOrderLine~; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines FK_stock_document_lines_sales_order_lines_SalesOrderLineId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_document_lines FK_stock_document_lines_stock_documents_StockDocumentId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents FK_stock_documents_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents FK_stock_documents_construction_sites_SiteId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents FK_stock_documents_partners_PartnerId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents FK_stock_documents_warehouses_DestinationWarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_documents FK_stock_documents_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_locations FK_stock_locations_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_locations FK_stock_locations_warehouses_WarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_move_lots FK_stock_move_lots_lots_LotId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_move_lots FK_stock_move_lots_stock_moves_StockMoveId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_moves FK_stock_moves_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_moves FK_stock_moves_items_ItemId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_moves FK_stock_moves_stock_locations_FromLocationId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_moves FK_stock_moves_stock_locations_ToLocationId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_settings FK_stock_settings_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: stock_settings FK_stock_settings_warehouses_DefaultWarehouseId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: tax_repartition_lines FK_tax_repartition_lines_tax_definitions_TaxDefinitionId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: time_entries FK_time_entries_employees_EmployeeId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: user_invitations FK_user_invitations_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: user_invitations FK_user_invitations_company_roles_CompanyRoleId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: warehouses FK_warehouses_companies_CompanyId; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- Demo data version (read by the API's DemoDatabaseSync)
CREATE TABLE IF NOT EXISTS public.__pako_demo_seed (version text NOT NULL);
INSERT INTO public.__pako_demo_seed (version) VALUES ('2026-11-02.1');

