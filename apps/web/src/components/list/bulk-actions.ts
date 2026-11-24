import type { IntlShape } from "react-intl";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/api/client";

// Client request 2026-11-24: bulk actions on the document lists.

export interface BulkResult {
  done: number;
  failures: { label: string; message: string }[];
}

/**
 * Runs the action for each item one after the other (each document is posted by the same endpoint
 * as its own page), keeping going past failures and collecting each server message.
 */
export async function runEach<T>(items: T[], run: (item: T) => Promise<unknown>, label: (item: T) => string, fallback: string): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failures: [] };
  for (const item of items) {
    try {
      await run(item);
      result.done += 1;
    } catch (err) {
      result.failures.push({ label: label(item), message: getApiErrorMessage(err, fallback) });
    }
  }
  return result;
}

/** One toast for what went through, one listing each document that did not and why. */
export function reportBulk(intl: IntlShape, result: BulkResult, doneMessageId: string) {
  if (result.done > 0) toast.success(intl.formatMessage({ id: doneMessageId }, { count: result.done }));
  if (result.failures.length > 0) {
    toast.error(intl.formatMessage({ id: "listActions.failed" }, { count: result.failures.length }), {
      description: result.failures.slice(0, 5).map((f) => `${f.label}: ${f.message}`).join("\n"),
      duration: 15_000,
    });
  }
}
