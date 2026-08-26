import { z } from "zod";

// Money values (debit/credit/amountCurrency) are decimal strings on the wire, not JS numbers —
// the .NET backend serializes `decimal` as a string to avoid float precision loss crossing the
// C#-to-TS boundary. Parse with a decimal library (e.g. decimal.js) at the point of use, don't
// coerce to `number`.

export const AccountTypeSchema = z.enum([
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
  "receivable",
  "payable",
  "bank",
  "cash",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const AccountSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  accountType: AccountTypeSchema,
  parentId: z.string().nullable(),
  reconcilable: z.boolean(),
});
export type Account = z.infer<typeof AccountSchema>;

export const JournalEntryStateSchema = z.enum(["draft", "posted", "cancelled"]);
export type JournalEntryState = z.infer<typeof JournalEntryStateSchema>;

export const JournalEntrySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  journalId: z.string(),
  date: z.string(),
  ref: z.string().nullable(),
  state: JournalEntryStateSchema,
  sequenceNumber: z.string().nullable(),
  postedAt: z.string().nullable(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalEntryLineSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  accountId: z.string(),
  partnerId: z.string().nullable(),
  debit: z.string(),
  credit: z.string(),
  currencyId: z.string(),
  amountCurrency: z.string().nullable(),
  taxId: z.string().nullable(),
  reconciled: z.boolean(),
  reconciliationId: z.string().nullable(),
  description: z.string().nullable(),
});
export type JournalEntryLine = z.infer<typeof JournalEntryLineSchema>;
