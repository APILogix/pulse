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

import { LIMITS } from './types.js';

const MAX_REGEX_LENGTH = LIMITS.MAX_REGEX_LENGTH;
const MAX_INPUT_LENGTH = 10_000; // Max input string length for regex matching

// Patterns that indicate dangerous regex constructs
const NESTED_QUANTIFIER_PATTERN = /(\+|\*|\{[^}]+\})\s*\)(\+|\*|\?|\{)/;
const BACKREFERENCE_PATTERN = /\\[1-9]/;
const LOOKAROUND_PATTERN = /\(\?[=!<]/;

/**
 * Check if a regex pattern is safe to use (no catastrophic backtracking risk).
 * 
 * Returns true if safe, false if dangerous.
 */
export function isSafeRegex(pattern: string): boolean {
  // Length check
  if (pattern.length > MAX_REGEX_LENGTH) {
    return false;
  }

  // Check for nested quantifiers (catastrophic backtracking)
  if (NESTED_QUANTIFIER_PATTERN.test(pattern)) {
    return false;
  }

  // Check for backreferences
  if (BACKREFERENCE_PATTERN.test(pattern)) {
    return false;
  }

  // Check for lookaround assertions
  if (LOOKAROUND_PATTERN.test(pattern)) {
    return false;
  }

  // Verify the pattern is actually valid regex
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }

  return true;
}

/**
 * Safely execute a regex match with bounded input.
 * Returns match result or null if input exceeds bounds.
 */
export function safeRegexMatch(
  pattern: string,
  input: string,
): RegExpMatchArray | null {
  if (!isSafeRegex(pattern)) {
    return null;
  }

  // Bound input length
  const boundedInput = input.length > MAX_INPUT_LENGTH
    ? input.slice(0, MAX_INPUT_LENGTH)
    : input;

  try {
    const regex = new RegExp(pattern);
    return boundedInput.match(regex);
  } catch {
    return null;
  }
}

/**
 * Safely test a regex pattern against bounded input.
 * Returns boolean or null if the pattern is unsafe.
 */
export function safeRegexTest(
  pattern: string,
  input: string,
): boolean | null {
  if (!isSafeRegex(pattern)) {
    return null;
  }

  const boundedInput = input.length > MAX_INPUT_LENGTH
    ? input.slice(0, MAX_INPUT_LENGTH)
    : input;

  try {
    const regex = new RegExp(pattern);
    return regex.test(boundedInput);
  } catch {
    return null;
  }
}
