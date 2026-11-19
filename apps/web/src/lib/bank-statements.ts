// Bank statement import (docs/BANK_STATEMENTS.md): the list's query key, shared by the list and the
// detail page so a confirm or delete refreshes the list.
export const bankStatementsQueryKey = (companyId: string | null) => ["bankStatements", companyId] as const;
