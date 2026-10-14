/**
 * Guards against backend/frontend automation contract drift.
 *
 * The backend now REJECTS unknown or retired action types at workflow-creation time
 * (service.validateActions). So if the frontend offers a type the backend does not
 * support, the user gets a guaranteed save failure; and if the backend supports a
 * type the frontend never lists, that capability is unreachable from the UI.
 *
 * This drift is exactly what happened before: the frontend still offered all nine
 * removed action types after they were deleted from the backend.
 *
 * Compares the literal arrays in:
 *   pulse/src/modules/automation/types.ts            -> ACTION_TYPES, TRIGGER_TYPES
 *   pulsiv_fe/src/modules/automation/api/types.ts    -> ACTION_TYPES, TRIGGER_TYPES
 *
 * Read-only. Exits non-zero on any mismatch.
 */
const fs = require('fs');
const path = require('path');

const BE = path.join(__dirname, '..', 'src/modules/automation/types.ts');
const FE = path.join(__dirname, '..', '..', 'pulsiv_fe/src/modules/automation/api/types.ts');

/** Extract a `export const NAME = [ "a", "b" ] as const;` string array. */
function extractArray(source, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`);
  const m = source.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function compare(label, beList, feList) {
  if (!beList) return { label, ok: false, detail: 'could not parse backend array' };
  if (!feList) return { label, ok: false, detail: 'could not parse frontend array' };
  const beSet = new Set(beList);
  const feSet = new Set(feList);
  const feOnly = feList.filter((x) => !beSet.has(x));
  const beOnly = beList.filter((x) => !feSet.has(x));
  if (feOnly.length === 0 && beOnly.length === 0) {
    return { label, ok: true, detail: `${beList.length} entries match` };
  }
  const parts = [];
  if (feOnly.length) parts.push(`frontend offers unsupported: ${feOnly.join(', ')}`);
  if (beOnly.length) parts.push(`backend supports but UI omits: ${beOnly.join(', ')}`);
  return { label, ok: false, detail: parts.join(' | ') };
}

function main() {
  if (!fs.existsSync(FE)) {
    console.log(`SKIP: frontend not found at ${FE}`);
    return;
  }
  const be = fs.readFileSync(BE, 'utf8');
  const fe = fs.readFileSync(FE, 'utf8');

  const results = [
    compare('ACTION_TYPES', extractArray(be, 'ACTION_TYPES'), extractArray(fe, 'ACTION_TYPES')),
    compare('TRIGGER_TYPES', extractArray(be, 'TRIGGER_TYPES'), extractArray(fe, 'TRIGGER_TYPES')),
    compare('CONDITION_OPERATORS', extractArray(be, 'CONDITION_OPERATORS'), extractArray(fe, 'CONDITION_OPERATORS')),
  ];

  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log(`  PASS  ${r.label}: ${r.detail}`);
    else { console.log(`  FAIL  ${r.label}: ${r.detail}`); failed += 1; }
  }

  // Retired types must not appear anywhere in the frontend automation module.
  const RETIRED = [
    'runbook.open', 'runbook.step.create', 'status_page.update',
    'release.guard.warn', 'release.guard.pause', 'retention.archive',
    'retention.purge_request', 'quota.throttle_recommend', 'alert.severity.change',
  ];
  const feDir = path.join(__dirname, '..', '..', 'pulsiv_fe/src/modules/automation');
  const leaked = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const t of RETIRED) {
          if (text.includes(`"${t}"`) || text.includes(`'${t}'`)) {
            leaked.push(`${path.relative(feDir, p)} -> ${t}`);
          }
        }
      }
    }
  })(feDir);

  if (leaked.length === 0) console.log('  PASS  no retired action type referenced in the frontend automation module');
  else { for (const l of leaked) console.log(`  FAIL  retired type still referenced: ${l}`); failed += 1; }

  if (failed > 0) {
    console.log(`\nFE/BE CONTRACT DRIFT DETECTED (${failed} problem(s))`);
    process.exit(1);
  }
  console.log('\nFE/BE AUTOMATION CONTRACT IN SYNC');
}

main();
