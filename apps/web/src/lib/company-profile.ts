import type { CompanyResponse, UpdateCompanyProfileRequest } from "@pako/shared";

// The editable company profile, shared by Settings → Company profile and the lobby's
// "New company" dialog so both always ask for exactly the same details.
export interface CompanyProfileValues {
  name: string;
  tradingName: string;
  legalForm: number | null;
  businessActivity: string;
  description: string;
  businessNumber: string;
  fiscalNumber: string;
  vatNumber: string;
  vatRegistrationDate: string;
  country: string;
  municipality: string;
  streetAddress: string;
  postalCode: string;
  addressLine2: string;
  email: string;
  phone: string;
  website: string;
  bankName: string;
  bankAccountHolder: string;
  iban: string;
  swiftBic: string;
  documentFooter: string;
  paymentInstructions: string;
}

export const LEGAL_FORM_OPTIONS = [
  { value: 0, labelKey: "companyProfile.legalForm.individual" },
  { value: 1, labelKey: "companyProfile.legalForm.shpk" },
  { value: 2, labelKey: "companyProfile.legalForm.sha" },
  { value: 3, labelKey: "companyProfile.legalForm.shk" },
  { value: 4, labelKey: "companyProfile.legalForm.shkKomandite" },
  { value: 5, labelKey: "companyProfile.legalForm.oe" },
  { value: 6, labelKey: "companyProfile.legalForm.ngo" },
  { value: 7, labelKey: "companyProfile.legalForm.publicEntity" },
  { value: 99, labelKey: "companyProfile.legalForm.other" },
] as const;

export function emptyProfileValues(): CompanyProfileValues {
  return {
    name: "", tradingName: "", legalForm: null, businessActivity: "", description: "",
    businessNumber: "", fiscalNumber: "", vatNumber: "", vatRegistrationDate: "",
    country: "Kosovo", municipality: "", streetAddress: "", postalCode: "", addressLine2: "",
    email: "", phone: "", website: "",
    bankName: "", bankAccountHolder: "", iban: "", swiftBic: "",
    documentFooter: "", paymentInstructions: "",
  };
}

export function profileValuesFrom(company: CompanyResponse): CompanyProfileValues {
  return {
    name: company.name ?? "",
    tradingName: company.tradingName ?? "",
    legalForm: company.legalForm ?? null,
    businessActivity: company.businessActivity ?? "",
    description: company.description ?? "",
    businessNumber: company.businessNumber ?? "",
    fiscalNumber: company.fiscalNumber ?? "",
    vatNumber: company.vatNumber ?? "",
    vatRegistrationDate: company.vatRegistrationDate ?? "",
    country: company.country ?? "Kosovo",
    municipality: company.municipality ?? "",
    streetAddress: company.streetAddress ?? "",
    postalCode: company.postalCode ?? "",
    addressLine2: company.addressLine2 ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    website: company.website ?? "",
    bankName: company.bankName ?? "",
    bankAccountHolder: company.bankAccountHolder ?? "",
    iban: company.iban ?? "",
    swiftBic: company.swiftBic ?? "",
    documentFooter: company.documentFooter ?? "",
    paymentInstructions: company.paymentInstructions ?? "",
  };
}

// Blank fields are sent as "not given" rather than empty strings.
export function toProfileRequest(v: CompanyProfileValues): UpdateCompanyProfileRequest {
  const opt = (s: string) => s.trim() || undefined;
  return {
    name: v.name.trim(),
    tradingName: opt(v.tradingName),
    legalForm: v.legalForm ?? undefined,
    businessActivity: opt(v.businessActivity),
    description: opt(v.description),
    businessNumber: opt(v.businessNumber),
    fiscalNumber: opt(v.fiscalNumber),
    vatNumber: opt(v.vatNumber),
    vatRegistrationDate: v.vatRegistrationDate || undefined,
    country: opt(v.country),
    municipality: opt(v.municipality),
    streetAddress: opt(v.streetAddress),
    postalCode: opt(v.postalCode),
    addressLine2: opt(v.addressLine2),
    email: opt(v.email),
    phone: opt(v.phone),
    website: opt(v.website),
    bankName: opt(v.bankName),
    bankAccountHolder: opt(v.bankAccountHolder),
    iban: opt(v.iban),
    swiftBic: opt(v.swiftBic),
    documentFooter: opt(v.documentFooter),
    paymentInstructions: opt(v.paymentInstructions),
  };
}
