import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import authEn from "@/locales/en/auth.json";
import billsEn from "@/locales/en/bills.json";
import commonEn from "@/locales/en/common.json";
import companiesEn from "@/locales/en/companies.json";
import dashboardEn from "@/locales/en/dashboard.json";
import enumsEn from "@/locales/en/enums.json";
import invoicingEn from "@/locales/en/invoicing.json";
import ledgerEn from "@/locales/en/ledger.json";
import navEn from "@/locales/en/nav.json";
import payrollEn from "@/locales/en/payroll.json";
import reconciliationEn from "@/locales/en/reconciliation.json";
import reportsEn from "@/locales/en/reports.json";
import settingsEn from "@/locales/en/settings.json";
import sharedEn from "@/locales/en/shared.json";

import authSq from "@/locales/sq/auth.json";
import billsSq from "@/locales/sq/bills.json";
import commonSq from "@/locales/sq/common.json";
import companiesSq from "@/locales/sq/companies.json";
import dashboardSq from "@/locales/sq/dashboard.json";
import enumsSq from "@/locales/sq/enums.json";
import invoicingSq from "@/locales/sq/invoicing.json";
import ledgerSq from "@/locales/sq/ledger.json";
import navSq from "@/locales/sq/nav.json";
import payrollSq from "@/locales/sq/payroll.json";
import reconciliationSq from "@/locales/sq/reconciliation.json";
import reportsSq from "@/locales/sq/reports.json";
import settingsSq from "@/locales/sq/settings.json";
import sharedSq from "@/locales/sq/shared.json";

export const LANGUAGE_STORAGE_KEY = "pako.language";

function storedLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "sq") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) - fall through to default.
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  lng: storedLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "nav",
    "auth",
    "dashboard",
    "companies",
    "settings",
    "reports",
    "ledger",
    "invoicing",
    "bills",
    "payroll",
    "reconciliation",
    "shared",
    "enums",
  ],
  resources: {
    en: {
      common: commonEn,
      nav: navEn,
      auth: authEn,
      dashboard: dashboardEn,
      companies: companiesEn,
      settings: settingsEn,
      reports: reportsEn,
      ledger: ledgerEn,
      invoicing: invoicingEn,
      bills: billsEn,
      payroll: payrollEn,
      reconciliation: reconciliationEn,
      shared: sharedEn,
      enums: enumsEn,
    },
    sq: {
      common: commonSq,
      nav: navSq,
      auth: authSq,
      dashboard: dashboardSq,
      companies: companiesSq,
      settings: settingsSq,
      reports: reportsSq,
      ledger: ledgerSq,
      invoicing: invoicingSq,
      bills: billsSq,
      payroll: payrollSq,
      reconciliation: reconciliationSq,
      shared: sharedSq,
      enums: enumsSq,
    },
  },
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // ignore - persistence is a nice-to-have, not required for the app to work
  }
});

export default i18n;
