/**
 * Server-statement counting for the ingestion write path.
 *
 * `EventProcessor.instrumentClientQueries` already wraps `client.query` and
 * counts invocations, but it counts CLIENT ROUND TRIPS.
 * `applyIngestionTransactionSettings()` joins up to four `SET LOCAL` statements
 * with `'; '` into a single round trip, so round trips UNDERCOUNT the statements
 * PostgreSQL actually executes. Requirements 2.7, 9.1 and 21.3 are written in
 * terms of SQL statements per batch transaction, so both numbers are recorded:
 *
 *   roundTrips       — how many times `client.query(...)` was called
 *   serverStatements — how many top-level statements those calls carried
 *
 * This module is the authoritative counter for those acceptance criteria: it has
 * no database dependency beyond the connection it wraps and needs no privileges,
 * so it works where `pg_stat_statements` is absent or its reset is not permitted
 * (design §2.2 covers that source as the cross-check and cost attributor).
 *
 * `splitTopLevelStatements()` is exported as a pure function because a semicolon
 * inside a JSON literal, a dollar-quoted plpgsql body or a comment must never be
 * miscounted — a splitter that is confidently wrong is worse than no splitter,
 * since it would silently validate a false conclusion about write amplification.
 *
 * Design: §2.1. Requirements: 2.7, 9.1, 21.3.
 */
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

import type { PoolClient } from 'pg';

/** Length of the normalized SQL prefix kept for grouping and reporting. */
const SQL_PREFIX_LENGTH = 120;

/** Frames to retain when locating the calling site inside `src/`. */
const CALLER_STACK_DEPTH = 40;

const MODULE_PATH = normalizePath(fileURLToPath(import.meta.url)).toLowerCase();

/** One observed `client.query(...)` call and the statements it carried. */
export interface StatementRecord {
  /** Whitespace-collapsed prefix of the SQL text, for grouping and reporting. */
  sqlFirst120: string;
  /** Top-level `;` split, string/dollar-quote/comment aware. */
  statementCount: number;
  /** Epoch milliseconds at which the call was issued. */
  startedAtMs: number;
  /** Wall duration of the call, from a monotonic clock. Zero until it settles. */
  durationMs: number;
  /** Rows reported by the driver, summed across multi-statement results. */
  rowCount: number | null;
  /** Captured stack frame inside `src/`, e.g. `error-group.repository.ts:150`. */
  caller: string | null;
}

/** Counters accumulated since construction or since the last `reset()`. */
export interface StatementTally {
  roundTrips: number;
  serverStatements: number;
  records: StatementRecord[];
}

/** Handle returned by {@link countStatements}. */
export interface StatementCounter {
  /** Snapshot of the counters. Records are copied, so the snapshot is stable. */
  tally: () => StatementTally;
  /** Zero the counters and drop the recorded calls. */
  reset: () => void;
  /** Reinstate the original `client.query`. Idempotent. */
  restore: () => void;
}

function normalizePath(value: string): string {
  return value.split('\\').join('/');
}

function isIdentifierChar(ch: string): boolean {
  return ch.length > 0 && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(ch);
}

function isDollarTagChar(ch: string, first: boolean): boolean {
  if (ch.length === 0) return false;
  return first
    ? /[A-Za-z_\u0080-\uFFFF]/.test(ch)
    : /[A-Za-z0-9_\u0080-\uFFFF]/.test(ch);
}

/**
 * Read a dollar-quote delimiter at `at`, including both `$` characters, or null
 * when the `$` is not one.
 *
 * PostgreSQL forbids a digit as the first tag character, so `$1` is rejected
 * here and stays a positional parameter rather than opening a quoted body.
 */
function readDollarTag(sql: string, at: number): string | null {
  if (sql.charAt(at) !== '$') return null;
  let i = at + 1;
  let first = true;
  while (i < sql.length && sql.charAt(i) !== '$') {
    if (!isDollarTagChar(sql.charAt(i), first)) return null;
    first = false;
    i += 1;
  }
  if (i >= sql.length) return null;
  return sql.slice(at, i + 1);
}

/**
 * Split SQL text into the statements PostgreSQL would execute for it.
 *
 * Aware of:
 *  - `'...'` literals, including the `''` escape;
 *  - `E'...'` escape strings, where a backslash escapes the next character;
 *  - `"..."` quoted identifiers, including the `""` escape;
 *  - `$tag$ ... $tag$` and `$$ ... $$` bodies (plpgsql, JSON blobs);
 *  - `--` line comments;
 *  - `/* ... *\/` block comments, which PostgreSQL allows to nest.
 *
 * Empty fragments are dropped, so a trailing `;`, a `;;` pair and text
 * containing only whitespace and comments all contribute zero statements.
 *
 * An unterminated literal, identifier or comment consumes the remainder of the
 * text: PostgreSQL would reject such input outright, and counting the remainder
 * as one statement is closer to the truth than splitting inside a literal.
 *
 * Pure: no I/O, no shared state. Design Property 14 quantifies over it.
 */
export function splitTopLevelStatements(sql: string): string[] {
  const statements: string[] = [];
  const length = sql.length;
  let fragmentStart = 0;
  let hasContent = false;
  let i = 0;

  const pushFragment = (endExclusive: number): void => {
    if (!hasContent) return;
    const text = sql.slice(fragmentStart, endExclusive).trim();
    if (text.length > 0) statements.push(text);
  };

  while (i < length) {
    const ch = sql.charAt(i);

    // -- line comment, to end of line.
    if (ch === '-' && sql.charAt(i + 1) === '-') {
      i += 2;
      while (i < length && sql.charAt(i) !== '\n') i += 1;
      continue;
    }

    // /* block comment */ — nesting is legal in PostgreSQL.
    if (ch === '/' && sql.charAt(i + 1) === '*') {
      let depth = 1;
      i += 2;
      while (i < length && depth > 0) {
        if (sql.charAt(i) === '/' && sql.charAt(i + 1) === '*') {
          depth += 1;
          i += 2;
          continue;
        }
        if (sql.charAt(i) === '*' && sql.charAt(i + 1) === '/') {
          depth -= 1;
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }

    // '...' literal. Backslash escapes apply only to an E'' escape string;
    // with standard_conforming_strings on (the default) a backslash inside a
    // plain literal is an ordinary character.
    if (ch === "'") {
      hasContent = true;
      const previous = sql.charAt(i - 1);
      const escapeString =
        (previous === 'e' || previous === 'E') && !isIdentifierChar(sql.charAt(i - 2));
      i += 1;
      while (i < length) {
        const c = sql.charAt(i);
        if (escapeString && c === '\\') {
          i += 2;
          continue;
        }
        if (c === "'") {
          if (sql.charAt(i + 1) === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // "..." quoted identifier.
    if (ch === '"') {
      hasContent = true;
      i += 1;
      while (i < length) {
        if (sql.charAt(i) === '"') {
          if (sql.charAt(i + 1) === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // $tag$ ... $tag$ body, or a positional parameter such as $1.
    if (ch === '$') {
      hasContent = true;
      const tag = readDollarTag(sql, i);
      if (tag === null) {
        i += 1;
        continue;
      }
      const closeAt = sql.indexOf(tag, i + tag.length);
      i = closeAt === -1 ? length : closeAt + tag.length;
      continue;
    }

    if (ch === ';') {
      pushFragment(i);
      fragmentStart = i + 1;
      hasContent = false;
      i += 1;
      continue;
    }

    if (!/\s/.test(ch)) hasContent = true;
    i += 1;
  }

  pushFragment(length);
  return statements;
}

/** Statements PostgreSQL would execute for `sql`. Zero for comments only. */
export function countTopLevelStatements(sql: string): number {
  return splitTopLevelStatements(sql).length;
}

function normalizeSqlPrefix(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ').slice(0, SQL_PREFIX_LENGTH);
}

/**
 * SQL text carried by a `client.query(...)` call.
 *
 * Covers `query(text, ...)` and `query({ text, values }, ...)`. Returns null for
 * a Submittable (cursor, query stream) that exposes no text — such a call still
 * executes exactly one statement, which is what the caller records.
 */
function extractSql(args: unknown[]): string | null {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    const text = (first as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return null;
}

function rowCountOf(result: unknown): number | null {
  if (Array.isArray(result)) {
    let total: number | null = null;
    for (const entry of result) {
      const count = rowCountOf(entry);
      if (count === null) continue;
      total = (total ?? 0) + count;
    }
    return total;
  }
  if (result && typeof result === 'object') {
    const value = (result as { rowCount?: unknown }).rowCount;
    if (typeof value === 'number') return value;
  }
  return null;
}

/** `{ file, line }` for a V8 stack frame line, or null when it has neither. */
function parseStackFrame(line: string): { file: string; line: string } | null {
  const match = /(.+?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
  if (!match) return null;
  const lineNumber = match[2];
  let file = match[1] ?? '';
  if (!lineNumber) return null;

  const parenAt = file.lastIndexOf('(');
  file = parenAt >= 0 ? file.slice(parenAt + 1) : file.replace(/^at\s+/, '');
  file = file.trim();
  if (file.length === 0) return null;

  if (file.startsWith('file://')) {
    try {
      file = fileURLToPath(file);
    } catch {
      // Leave the raw specifier; the `src/` test below still works on it.
    }
  }
  return { file: normalizePath(file), line: lineNumber };
}

/**
 * First stack frame inside `src/`, as `basename:line`.
 *
 * Frames belonging to this module are skipped so the recorded caller is the code
 * that issued the query, not the wrapper. Returns null when the call originates
 * entirely outside `src/` — a harness issuing SQL directly, for instance.
 */
function captureCaller(): string | null {
  const previousLimit = Error.stackTraceLimit;
  if (!(previousLimit >= CALLER_STACK_DEPTH)) Error.stackTraceLimit = CALLER_STACK_DEPTH;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = previousLimit;

  for (const line of stack.split('\n').slice(1)) {
    const frame = parseStackFrame(line);
    if (!frame) continue;
    if (frame.file.toLowerCase() === MODULE_PATH) continue;
    if (!/(^|\/)src\//.test(frame.file)) continue;
    return `${frame.file.slice(frame.file.lastIndexOf('/') + 1)}:${frame.line}`;
  }
  return null;
}

/**
 * Wrap `client.query` so every call is counted as a round trip and as the
 * top-level statements it carries.
 *
 * Records are pushed at issue time, so `records` preserves issue order even when
 * calls overlap; `durationMs` and `rowCount` are filled in when a call settles.
 * A call that throws or rejects keeps `rowCount: null`.
 *
 * `restore()` reinstates whatever `client.query` was when this wrapper was
 * installed, so it composes with `EventProcessor`'s own instrumentation as long
 * as the wrappers are restored in reverse installation order.
 */
export function countStatements(client: PoolClient): StatementCounter {
  const originalQuery = client.query;
  let restored = false;
  let roundTrips = 0;
  let serverStatements = 0;
  let records: StatementRecord[] = [];

  const open = (args: unknown[]): { record: StatementRecord; startedAt: number } => {
    const sql = extractSql(args);
    const statementCount = sql === null ? 1 : countTopLevelStatements(sql);
    const record: StatementRecord = {
      sqlFirst120: sql === null ? '' : normalizeSqlPrefix(sql),
      statementCount,
      startedAtMs: Date.now(),
      durationMs: 0,
      rowCount: null,
      caller: captureCaller(),
    };
    roundTrips += 1;
    serverStatements += statementCount;
    records.push(record);
    return { record, startedAt: performance.now() };
  };

  const settle = (record: StatementRecord, startedAt: number, result: unknown): void => {
    record.durationMs = performance.now() - startedAt;
    record.rowCount = rowCountOf(result);
  };

  client.query = ((...args: unknown[]) => {
    const { record, startedAt } = open(args);
    const invoke = originalQuery as (...queryArgs: unknown[]) => unknown;
    const lastArg = args[args.length - 1];

    if (typeof lastArg === 'function') {
      const callback = lastArg as (...callbackArgs: unknown[]) => unknown;
      args[args.length - 1] = (...callbackArgs: unknown[]) => {
        settle(record, startedAt, callbackArgs[1]);
        return callback(...callbackArgs);
      };
      try {
        return invoke.apply(client, args);
      } catch (err) {
        settle(record, startedAt, undefined);
        throw err;
      }
    }

    try {
      const result = invoke.apply(client, args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        return (result as PromiseLike<unknown>).then(
          (value) => {
            settle(record, startedAt, value);
            return value;
          },
          (err) => {
            settle(record, startedAt, undefined);
            throw err;
          },
        );
      }
      settle(record, startedAt, result);
      return result;
    } catch (err) {
      settle(record, startedAt, undefined);
      throw err;
    }
  }) as PoolClient['query'];

  return {
    tally: () => ({
      roundTrips,
      serverStatements,
      records: records.map((record) => ({ ...record })),
    }),
    reset: () => {
      roundTrips = 0;
      serverStatements = 0;
      records = [];
    },
    restore: () => {
      if (restored) return;
      restored = true;
      client.query = originalQuery;
    },
  };
}
