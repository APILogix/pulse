/**
 * Template rendering with input sanitization.
 *
 * Templates use `{{ variable.path }}` placeholders resolved against a context
 * object. Because rendered output is sent to third-party chat connectors
 * (Slack/Discord/Teams) and email, ALL interpolated values are sanitized to
 * neutralize injection: control characters are stripped and HTML-sensitive
 * characters are escaped. Literal template text is left untouched.
 *
 * This is intentionally a tiny, dependency-free renderer (no eval, no logic) —
 * the only feature is dotted-path variable substitution, which keeps the
 * attack surface minimal.
 */
import { readPath } from './evaluator.js';

const PLACEHOLDER = /\{\{\s*([\w.[\]]+)\s*\}\}/g;

/** Strip control chars and escape HTML-significant characters in a value. */
export function sanitizeValue(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Remove ASCII control characters (except none are needed in messages).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  // Escape HTML-sensitive characters to prevent markup/script injection.
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return s;
}

export interface RenderResult {
  output: string;
  /** Variable paths referenced by the template. */
  referenced: string[];
  /** Referenced paths that had no value in the context. */
  missing: string[];
}

/**
 * Render a template string against a context object. All substituted values
 * are sanitized; missing variables render as empty strings and are reported.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): RenderResult {
  const referenced: string[] = [];
  const missing: string[] = [];

  const output = template.replace(PLACEHOLDER, (_match, path: string) => {
    referenced.push(path);
    const value = readPath(context, path);
    if (value === undefined || value === null) {
      missing.push(path);
      return '';
    }
    return sanitizeValue(value);
  });

  return { output, referenced: [...new Set(referenced)], missing: [...new Set(missing)] };
}

/** Extract the unique set of variable paths a template references. */
export function extractVariables(template: string): string[] {
  const vars: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER.lastIndex = 0;
  while ((m = PLACEHOLDER.exec(template)) !== null) {
    if (m[1]) vars.push(m[1]);
  }
  return [...new Set(vars)];
}
