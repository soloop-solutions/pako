import { ApiException } from "@pako/shared";

import { getApiErrorMessage } from "@/api/client";

export type PartnerFormError = { message: string; taxNumber: boolean };

function conflictMessage(err: unknown): string | null {
  if (!(err instanceof ApiException) || err.status !== 409) return null;
  const raw = err.response?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed) return parsed;
    if (parsed && typeof parsed.error === "string" && parsed.error) return parsed.error;
    if (parsed && typeof parsed.detail === "string" && parsed.detail) return parsed.detail;
    return null;
  } catch {
    return raw;
  }
}

export function partnerFormError(err: unknown, fallback: string): PartnerFormError {
  const conflict = conflictMessage(err);
  if (conflict) return { message: conflict, taxNumber: true };
  return { message: getApiErrorMessage(err, fallback), taxNumber: false };
}
