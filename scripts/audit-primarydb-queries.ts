/**
 * PrimaryDB Query Quality & Performance Audit Tool
 *
 * Automated static analysis safeguard against query regressions:
 * - Rule 1: Disallow production SELECT * / table.* (Mandatory Rule 3.1)
 * - Rule 2: Enforce bounded queries and pagination (LIMIT / keyset cursors on collections)
 * - Rule 3: Detect query execution inside loop constructs (N+1 query anti-pattern)
 * - Rule 4: Enforce safe row-level locking (require SKIP LOCKED or single-row PK lock)
 * - Rule 5: Detect raw string concatenation in SQL queries (parameterized SQL)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Violation {
  file: string;
  line: number;
  rule: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  snippet: string;
}

export function runQueryAudit(): { violations: Violation[]; filesCount: number } {
  const violations: Violation[] = [];

  function getTsFiles(dir: string): string[] {
    let results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(getTsFiles(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const srcDir = path.resolve(process.cwd(), 'src');
  const files = getTsFiles(srcDir);

  for (const filePath of files) {
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');

    // -------------------------------------------------------------------------
    // Rule 1: Zero SELECT * or table.* (Mandatory Rule 3.1)
    // -------------------------------------------------------------------------
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      if (/\bSELECT\s+(?:\*|[a-zA-Z0-9_]+\.\*)\s+FROM\b/i.test(line)) {
        if (!/\bUNNEST\b/i.test(line) && !/jsonb_to_recordset\b/i.test(line) && !/json_to_recordset\b/i.test(line)) {
          violations.push({
            file: relativePath,
            line: lineNum,
            rule: 'RULE_1_SELECT_STAR',
            severity: 'ERROR',
            message: 'Production query uses SELECT * or table.*. Explicit column projections are required.',
            snippet: line.trim(),
          });
        }
      }
    });

    // -------------------------------------------------------------------------
    // Parse Full SQL Template Literals for Multiline Query Analysis
    // -------------------------------------------------------------------------
    const sqlRegex = /`([^`]*(?:\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b)[^`]*)`/gi;
    let match: RegExpExecArray | null;

    while ((match = sqlRegex.exec(content)) !== null) {
      const sql = match[1];
      const offset = match.index;
      const lineNum = content.slice(0, offset).split('\n').length;
      const normalizedSql = sql.replace(/\s+/g, ' ');

      // Rule 2: Unbounded collection queries
      // If querying high-cardinality tables without LIMIT / cursor / aggregates / single row lookup
      const isHighCardinality = /\bFROM\s+(?:alert_events|alert_events_v2|events_requests|events_errors|automation_runs|unified_events|alert_delivery_attempts)\b/i.test(normalizedSql);
      if (isHighCardinality && /\bSELECT\b/i.test(normalizedSql)) {
        const hasLimit = /\bLIMIT\b/i.test(normalizedSql);
        const hasAggregate = /\b(?:COUNT|SUM|AVG|MIN|MAX|BOOL_AND|BOOL_OR)\s*\(/i.test(normalizedSql);
        const hasSingleLookup = /\bWHERE\s+id\s*=\s*\$|\bWHERE\s+alert_key\s*=\s*\$/i.test(normalizedSql);
        const isCte = /\bWITH\b/i.test(normalizedSql) && !normalizedSql.endsWith(sql);

        if (!hasLimit && !hasAggregate && !hasSingleLookup && !isCte) {
          violations.push({
            file: relativePath,
            line: lineNum,
            rule: 'RULE_2_UNBOUNDED_SCAN',
            severity: 'WARNING',
            message: 'High-cardinality table queried without explicit LIMIT or unique single-row predicate.',
            snippet: normalizedSql.slice(0, 120) + '...',
          });
        }
      }

      // Rule 4: Dangerous FOR UPDATE without SKIP LOCKED
      if (/\bFOR\s+UPDATE\b/i.test(normalizedSql)) {
        const hasSkipLocked = /\bSKIP\s+LOCKED\b/i.test(normalizedSql);
        const hasSingleRowPk = /\bWHERE\s+(?:id|alert_key|token|session_id)\s*=\s*\$/i.test(normalizedSql) ||
                               /\bLIMIT\s+1\b/i.test(normalizedSql);
        if (!hasSkipLocked && !hasSingleRowPk) {
          violations.push({
            file: relativePath,
            line: lineNum,
            rule: 'RULE_4_DANGEROUS_FOR_UPDATE',
            severity: 'WARNING',
            message: 'FOR UPDATE without SKIP LOCKED or explicit single-row PK predicate risks lock contention.',
            snippet: normalizedSql.slice(0, 120) + '...',
          });
        }
      }

      // Rule 5: Raw string interpolation in WHERE clause (potential SQL injection / cache bloat)
      if (/\bWHERE\s+[^`]*\$\{[a-zA-Z0-9_.]+(?:Id|Name|Key|Email|Status)\}/i.test(sql)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          rule: 'RULE_5_STRING_CONCAT_SQL',
          severity: 'ERROR',
          message: 'Direct string interpolation in SQL WHERE clause. Use parameterized queries ($1, $2) instead.',
          snippet: normalizedSql.slice(0, 120) + '...',
        });
      }
    }

    // -------------------------------------------------------------------------
    // Rule 3: Query Execution Inside Loops (N+1 Anti-Pattern)
    // -------------------------------------------------------------------------
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      // Heuristic: check if query call appears inside for (...) { or while (...) { or .forEach(
      if (/\b(?:for\s*\(|while\s*\(|\.forEach\s*\()\s*.*(?:db|client|pool)\.query/i.test(line)) {
        violations.push({
          file: relativePath,
          line: lineNum,
          rule: 'RULE_3_LOOP_QUERY_N_PLUS_ONE',
          severity: 'WARNING',
          message: 'Synchronous database query call inside loop statement. Prefer bulk operations using ANY($1::uuid[]) or UNNEST.',
          snippet: line.trim(),
        });
      }
    });
  }

  return { violations, filesCount: files.length };
}

// CLI Execution
if (process.argv[1] && process.argv[1].includes('audit-primarydb-queries')) {
  console.log('='.repeat(80));
  console.log(' PRIMARYDB QUERY QUALITY & PERFORMANCE AUDIT');
  console.log('='.repeat(80));

  const { violations, filesCount } = runQueryAudit();
  console.log(`Scanned ${filesCount} TypeScript source files.`);

  const errors = violations.filter((v) => v.severity === 'ERROR');
  const warnings = violations.filter((v) => v.severity === 'WARNING');

  console.log(`Audit Findings: ${violations.length} (${errors.length} Errors, ${warnings.length} Warnings)\n`);

  if (violations.length > 0) {
    console.table(
      violations.map((v) => ({
        Rule: v.rule,
        Severity: v.severity,
        Location: `${v.file}:${v.line}`,
        Message: v.message,
      }))
    );
  }

  if (errors.length > 0) {
    console.error(`\n❌ Query audit FAILED with ${errors.length} error(s). Fix violations before deployment.`);
    process.exit(1);
  } else {
    console.log(`\n✅ Query audit PASSED! Zero critical query anti-patterns detected.`);
    process.exit(0);
  }
}
