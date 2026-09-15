# Seven places Odoo diverges

Read 14 Sep 2026 against `odoo/addons/account` at `7bbce82` (8 Sep 2026), LGPLv3 — learnable from,
not copyable wholesale. Full write-up: https://claude.ai/code/artifact/938b4844-00f5-4c03-86a5-6481ad4e3c58

Scale, for calibration: Odoo's `account` module is 98,867 Python lines with 1,070 tests in 73 files.
PAKO's backend is 194 `.cs` files with 198 tests in 28. Almost none of that mass is what makes Odoo
feel smooth.

## Where "smooth" actually comes from

1. **Views are declared, not built.** 32 list views, 25 forms, 19 search views, 10 kanbans, 3 graphs
   and 2 pivots, as XML. A generic client turns each into filtering, grouping, sorting, paging,
   `optional="hide"` columns, `sum="Total Debit"` column totals, `decoration-info="..."` row
   colouring, `multi_edit="1"` and export. No screen writes that code. **This is F1**, and it is the
   highest-leverage item in the milestone — widen its spec to match.
2. **The server derives; the client never calculates.** `_sync_dynamic_lines` regenerates tax,
   payment-term and rounding lines from the product lines on every write; `_check_balanced` refuses
   an unbalanced move. `DocumentLineCalculator` is the seed of the same discipline — protect it, and
   never let a React form compute a total.

## The seven

1. **An invoice *is* a journal entry.** One `account.move` with `move_type` in
   entry/out_invoice/out_refund/in_invoice/in_refund/out_receipt/in_receipt, one line model with
   `display_type` (product/tax/discount/rounding/payment_term/section/note). PAKO has three
   aggregates; Track A's own log records the cost — *"A2: purchase return, mirrored on Bill."*
   **Strategic, not a plan edit** — see the closing note.
2. **Numbering is derived, not counted.** `sequence_mixin` has no counter: `_get_last_sequence()`
   reads the highest existing number for the prefix, `_locked_increment()` takes the lock by
   *updating the row covered by the unique index* and retries in a savepoint on unique violation,
   caching within the transaction. Partial index: `(name, journal_id) WHERE state='posted' AND
   name != '/'`. Gaps are first-class (`made_sequence_gap` + its own partial index).
   **Changes B5** — a counter drifts from reality; a derivation cannot, manual override needs no
   special case, and gap detection is a query.
3. **Accounts have no parent.** `account.account` has no `parent_id`. `account.group` carries
   `code_prefix_start`/`code_prefix_end`; the account's `group_id` is *computed*.
   **Changes B2** — better than the recommendation in ACCOUNTANT_MILESTONE.md. Touches none of the
   233 seeded rows, and a new `5xxx` account files itself. Retires the B2 open question.
4. **Five lock dates, exceptions, and one irreversible.** `fiscalyear_`, `tax_`, `sale_`,
   `purchase_`, `hard_lock_date`. Hard lock is monotonic and permanent ("The Hard Lock Date cannot
   be removed"), and setting it forces drafts in the period to be posted or deleted. Soft locks bend
   via `account.lock_exception` — per user, with reason and expiry, effective lock computed per user.
   **Changes B4** — Odoo deliberately does *not* model periods as rows. Drop the period table; add
   sale/purchase/hard locks plus exceptions. Answers "chronological or arbitrary": chronological.
5. **Posted entries are hash-chained.** `inalterable_hash = sha256(previous_hash + current_record)`
   with a gapless `secure_sequence_number`; `write()` blocks integrity fields once hashed; a wizard
   seals up to a date, refusing past drafts or unreconciled statement lines.
   **Adds B15** — the mechanism SEF certification will ask for. It constrains the write path, so
   retrofitting later is dearer.
6. **One analytic distribution, not a column per dimension.** `analytic_distribution` is JSON,
   analytic account → percentage, across plans. **Changes B14** — same cost as adding project and
   employee columns, supports 60/40 splits, and needs no migration for the next axis.
7. **Year-end carry-forward is a property of the account type.** 19 flat types; `internal_group` and
   `include_initial_balance` are computed from them; `equity_unaffected` ("Current Year Earnings")
   is a real type. **Simplifies B13** and retires PAKO's synthetic earnings line.

## Amendments to ACCOUNTANT_MILESTONE.md

| Item | Becomes | Effect |
|---|---|---|
| B2 | Account groups by code-prefix range, membership computed | Smaller; answers the blocking question |
| B4 | Sale + purchase + hard lock dates, and a lock-exception model | Smaller; closing is chronological |
| B5 | Derive from max + partial unique index + retry | Smaller; override and gap reporting free |
| B13 | Widen account types; derive carry-forward | Smaller; kills the synthetic earnings line |
| B14 | One analytic distribution (JSON) over analytic plans | Same cost, more capability |
| B15 | **New:** hash chain over posted entries | ~1 week; earlier is cheaper |
| F1 | Widened: optional columns, column sums, row decoration, multi-edit | Position unchanged — already first |

Net effect on the 12 weeks: roughly neutral. Two open decisions answered for free.

## What PAKO already got right

Chart seeded from a per-locale CSV (Odoo's `chart_template._parse_csv`, same pattern) · lock dates
on the company enforced at the posting path (same names, same placement) · credit notes flipping
debit/credit rather than storing negatives (`out_refund`) · per-line tax rounded independently and
summed to the total · money math extracted into one service.

## The decision that does not get easier

Six of the seven are adjustments to a sound plan. The first is not. Three document aggregates where
Odoo has one means every future document type — delivery note, goods receipt, order, offer, IM4 — is
built and tested two or three times, and the duplication compounds rather than amortising. Unifying
now is a refactor whose blast radius is the ledger. Unifying later is the same refactor across
fifteen document types instead of six. Not unifying is legitimate — but choose it deliberately.
Recommendation: not inside this milestone; settle it before the next batch of document types is scoped.
