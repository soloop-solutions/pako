import { setPosOperator } from "@/lib/pos-operator";

// docs/POS_TILL_ACCESS.md: the till shows only to someone signed in with their PIN. Tests of what
// the till does start with a waiter already signed in.
export function signInTestOperator(companyId = "c1", name = "Test Waiter") {
  setPosOperator({ companyId, userId: "op-test", name, token: "op-test-token", expiresAt: "2099-01-01T00:00:00Z" });
}
