# 05 — Condition Engine Audit

Two separate, non-shared condition engines exist. This is a **DUPLICATED IMPLEMENTATION** pattern (documented in `26-duplication-audit` conceptually, tracked here) — not necessarily wrong, since the two modules evaluate structurally different data (arbitrary JSON event payloads vs. telemetry metric rollups), but worth being explicit that there is no shared condition library.

## Automation: `src/modules/automation/evaluator.ts`

- Pure, side-effect-free. `evaluateConditions()` / `readPath()`.
- Safe dot-path reading (`$.path` syntax) with prototype-pollution guards: `FORBIDDEN_KEYS` blocks `__proto__`, `constructor`, `prototype`.
- Operators: `eq, neq, gt, gte, lt, lte, in, not_in, contains, not_contains, matches, exists, not_exists, between`.
- Regex operator (`matches`) goes through `regex-safety.ts` (`isSafeRegex`) — rejects patterns over 256 chars. This is a real ReDoS mitigation, not exhaustive (length-based, not complexity-based), but present.
- Condition-group semantics: conditions within the same group are OR'd, different groups are AND'd. This is a real, specific semantic — worth confirming the UI/API documentation matches it, since "same group = OR, different group = AND" is a common source of user confusion if undocumented. NOT VERIFIED whether the workflow builder UI communicates this correctly (frontend not in scope of this pass).

Classification: **VERIFIED WORKING** as a pure function (confirmed by direct read of the operator implementations, cross-checked against `automation-evaluator.test.ts` existing). Whether it's fed correct/current data at evaluation time depends on the caller (`processInbox` loads version-pinned conditions before calling it) — that part is VERIFIED WORKING too, per the workers.ts trace in `04`.

## Alerting: `src/modules/alerting/evaluator.ts`

Per `ALERT_RULE_CORRECTNESS_AUDIT.md` (already-completed audit, re-cited not re-derived): comparison operators (`evaluator.ts:104-131` per that doc's citations) are correct and fail closed — **VERIFIED GOOD**, confirmed by that audit's line-level trace, which this audit trusts.

Still-open gaps carried forward from that audit and the hardening report (NOT re-derived, cited as still relevant):
- `aggregate_function`/`lookback_minutes` per-condition fields are **decorative** — real aggregation is fixed to 1m/1h upstream rollup buckets; `metric-registry.ts` is dead code. Classification: **DEAD CODE** (per prior audit, re-confirmed as still open per hardening report §J4).
- Absence/inactivity rules (`service_inactivity`, `request_inactivity`) structurally cannot fire from true zero-activity, because no rollup row exists for an empty bucket, so the rule is skipped rather than evaluated as zero. Classification: **BROKEN** (structural, not a code bug that can be patched locally — needs a "no data in window" synthetic evaluation path that doesn't exist).
- `isRequired=false` semantics were fixed per the hardening report (§ "Done" list) — trust that fix, do not re-flag.

## Condition compatibility matrix (automation only — alerting's matrix already exists in `alert-rules-catalog.md`, not duplicated here)

| Operator | Type coercion | Null/missing field | Array support |
|---|---|---|---|
| `eq`/`neq` | Loose JS equality on resolved value (`readPath` returns `undefined` for missing paths) | `undefined === undefined` is possible if both sides resolve missing — not independently re-verified for exact JS semantics beyond source read | Not array-aware beyond JS equality |
| `gt/gte/lt/lte` | Relies on JS numeric/string comparison — NOT VERIFIED whether non-numeric operands are guarded (would need to read the exact operator function body character-by-character to be certain; flagged as a gap, not a confirmed bug) | — | — |
| `in`/`not_in` | Expects RHS to be an array | — | Yes, by design |
| `contains`/`not_contains` | String/array containment | — | Yes |
| `matches` | Regex, length-bounded (256 chars) via `isSafeRegex` | — | N/A |
| `exists`/`not_exists` | Checks `readPath` result against `undefined` | Correct by construction | N/A |
| `between` | Expects a 2-tuple bound | NOT VERIFIED whether inclusive/exclusive bounds are documented consistently | N/A |

Where this audit could not fully confirm exact type-coercion edge cases from the evidence gathered, it says so explicitly above rather than asserting correctness or a bug.
