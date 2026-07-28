/**
 * Automation module – Regex safety validator.
 *
 * Rejects dangerous regex patterns that could cause catastrophic backtracking:
 * - Nested quantifiers: (a+)+, (a*)*
 * - Backreferences: (a)\1
 * - Lookaround: (?=...), (?<=...), (?!...), (?<!...)
 * - Patterns exceeding max length
 *
 * Bounds input length for regex matching to prevent resource exhaustion.
 */
/**
 * Check if a regex pattern is safe to use (no catastrophic backtracking risk).
 *
 * Returns true if safe, false if dangerous.
 */
export declare function isSafeRegex(pattern: string): boolean;
/**
 * Safely execute a regex match with bounded input.
 * Returns match result or null if input exceeds bounds.
 */
export declare function safeRegexMatch(pattern: string, input: string): RegExpMatchArray | null;
/**
 * Safely test a regex pattern against bounded input.
 * Returns boolean or null if the pattern is unsafe.
 */
export declare function safeRegexTest(pattern: string, input: string): boolean | null;
//# sourceMappingURL=regex-safety.d.ts.map