// "a@x.com, b@y.com" → ["a@x.com", "b@y.com"]: commas, semicolons or spaces separate addresses.
export function splitRecipients(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}
