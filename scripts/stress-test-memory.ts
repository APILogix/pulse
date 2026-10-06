/**
 * Automated Local Memory Stress Test Harness & Plateau Verification.
 *
 * Executes controlled stepped workloads (Baseline → 1,000 → 5,000 → 10,000 → 25,000 requests)
 * with pre-GC, peak, and post-GC memory metric captures across:
 *   - heapUsedMB
 *   - heapTotalMB
 *   - rssMB
 *   - externalMB
 *   - arrayBuffersMB
 *
 * Verifies whether post-GC heap stabilizes on a plateau or exhibits monotonic growth.
 *
 * Usage:
 *   node --expose-gc --import tsx/esm scripts/stress-test-memory.ts
 *   or: tsx scripts/stress-test-memory.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import v8 from 'v8';
import { buildApp } from '../src/app.js';
import { captureMemorySnapshot, memoryDiagnostics, type MemorySnapshot } from '../src/lib/memory-diagnostics.js';

// Ensure full compaction during diagnostic GC sweeps so fragmentation does not mask true live memory
try {
  v8.setFlagsFromString('--compact_on_every_full_gc');
} catch {
  // best-effort
}

export interface StressStepResult {
  step: number;
  label: string;
  totalRequests: number;
  batchSize: number;
  durationMs: number;
  preHeapMB: number;
  peakHeapMB: number;
  postGcHeapMB: number;
  postGcRssMB: number;
  postGcExternalMB: number;
  postGcArrayBuffersMB: number;
  deltaFromStartupMB: number;
  deltaFromPrevPostGcMB: number;
  growthPerThousandMB: number;
  plateauStatus: 'BASELINE' | 'WARMUP' | 'PLATEAU_STABLE' | 'UNBOUNDED_GROWTH';
}

export interface StressHarnessSummary {
  timestamp: string;
  environment: string;
  nodeVersion: string;
  gcExposed: boolean;
  steps: StressStepResult[];
  verdict: 'PLATEAU_STABLE' | 'LEAK_DETECTED';
  retainingPaths?: string[];
  maxPostGcHeapMB: number;
  minPostGcHeapMB: number;
  plateauVarianceMB: number;
}

const STEP_DEFINITIONS = [
  { step: 0, label: 'Baseline', requests: 0 },
  { step: 1, label: 'Step 1 (1k)', requests: 1_000 },
  { step: 2, label: 'Step 2 (5k)', requests: 5_000 },
  { step: 3, label: 'Step 3 (10k)', requests: 10_000 },
  { step: 4, label: 'Step 4 (25k)', requests: 25_000 },
  { step: 5, label: 'Step 5 (50k)', requests: 50_000 },
];

function runGcIfExposed(): void {
  const gc = (globalThis as unknown as { gc?: (opt?: boolean) => void }).gc;
  if (typeof gc === 'function') {
    gc(true);
    gc(true); // Second pass to sweep weak references and finalizers
  }
}

async function waitMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export async function runStressTest(concurrency = 25): Promise<StressHarnessSummary> {
  console.log('===============================================================');
  console.log('   PULSE SERVICE — AUTOMATED MEMORY STRESS & PLATEAU HARNESS   ');
  console.log('===============================================================');
  console.log(`Node.js Version: ${process.version}`);
  console.log(`GC Exposed: ${typeof (globalThis as any).gc === 'function' ? 'YES (--expose-gc)' : 'NO'}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log('Initializing application...\n');

  const app = await buildApp();
  await app.ready();

  runGcIfExposed();
  await waitMicrotasks();
  const startupSnapshot = memoryDiagnostics.markStartupComplete();

  const results: StressStepResult[] = [];
  let prevPostGcHeap = startupSnapshot.heapUsedMB;
  let cumulativeRequests = 0;

  // Baseline record
  results.push({
    step: 0,
    label: 'Baseline (0 req)',
    totalRequests: 0,
    batchSize: 0,
    durationMs: 0,
    preHeapMB: startupSnapshot.heapUsedMB,
    peakHeapMB: startupSnapshot.heapUsedMB,
    postGcHeapMB: startupSnapshot.heapUsedMB,
    postGcRssMB: startupSnapshot.rssMB,
    postGcExternalMB: startupSnapshot.externalMB,
    postGcArrayBuffersMB: startupSnapshot.arrayBuffersMB,
    deltaFromStartupMB: 0,
    deltaFromPrevPostGcMB: 0,
    growthPerThousandMB: 0,
    plateauStatus: 'BASELINE',
  });

  const routes = [
    { method: 'GET', url: '/health/live' },
    { method: 'GET', url: '/health' },
    { method: 'GET', url: '/metrics' },
    { method: 'GET', url: '/api/v1/non-existent-diagnostic-probe' },
  ] as const;

  for (let i = 1; i < STEP_DEFINITIONS.length; i++) {
    const def = STEP_DEFINITIONS[i];
    const targetRequests = def.requests;
    const batchSize = targetRequests - cumulativeRequests;
    cumulativeRequests = targetRequests;

    console.log(`Executing ${def.label}: +${batchSize.toLocaleString()} requests (total: ${targetRequests.toLocaleString()})...`);

    const preSnapshot = captureMemorySnapshot();
    const startTime = Date.now();
    let peakHeap = preSnapshot.heapUsedMB;

    // Execute batch with clean bounded worker concurrency (zero promise reaction leaks)
    let completed = 0;
    let nextReq = 0;

    const workerCount = Math.min(concurrency, batchSize);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextReq < batchSize) {
        const r = nextReq++;
        const route = routes[r % routes.length];
        await app.inject({ method: route.method, url: route.url });
        completed++;
        if (completed % 25 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (completed % 1000 === 0) {
          const cur = captureMemorySnapshot();
          if (cur.heapUsedMB > peakHeap) peakHeap = cur.heapUsedMB;
        }
      }
    });

    await Promise.all(workers);
    const durationMs = Date.now() - startTime;

    // Force GC to measure surviving heap objects
    runGcIfExposed();
    await waitMicrotasks();
    const postGcSnapshot = captureMemorySnapshot();

    const deltaFromStartupMB = Math.round((postGcSnapshot.heapUsedMB - startupSnapshot.heapUsedMB) * 100) / 100;
    const deltaFromPrevPostGcMB = Math.round((postGcSnapshot.heapUsedMB - prevPostGcHeap) * 100) / 100;
    const growthPerThousandMB = batchSize > 0 
      ? Math.round((deltaFromPrevPostGcMB / (batchSize / 1000)) * 1000) / 1000 
      : 0;

    let plateauStatus: StressStepResult['plateauStatus'] = 'PLATEAU_STABLE';
    if (i === 1) {
      plateauStatus = 'WARMUP';
    } else if (growthPerThousandMB > 0.5) {
      plateauStatus = 'UNBOUNDED_GROWTH';
    } else {
      plateauStatus = 'PLATEAU_STABLE';
    }

    results.push({
      step: def.step,
      label: def.label,
      totalRequests: targetRequests,
      batchSize,
      durationMs,
      preHeapMB: preSnapshot.heapUsedMB,
      peakHeapMB: Math.max(peakHeap, preSnapshot.heapUsedMB),
      postGcHeapMB: postGcSnapshot.heapUsedMB,
      postGcRssMB: postGcSnapshot.rssMB,
      postGcExternalMB: postGcSnapshot.externalMB,
      postGcArrayBuffersMB: postGcSnapshot.arrayBuffersMB,
      deltaFromStartupMB,
      deltaFromPrevPostGcMB,
      growthPerThousandMB,
      plateauStatus,
    });

    prevPostGcHeap = postGcSnapshot.heapUsedMB;
  }

  await app.close();

  // Evaluate stability across the steady-state plateau (steps 2, 3, 4: 5k to 25k requests)
  const plateauSteps = results.filter((r) => r.step >= 2);
  const postGcHeaps = plateauSteps.map((r) => r.postGcHeapMB);
  const minPostGcHeapMB = Math.min(...postGcHeaps);
  const maxPostGcHeapMB = Math.max(...postGcHeaps);
  const plateauVarianceMB = Math.round((maxPostGcHeapMB - minPostGcHeapMB) * 100) / 100;

  const hasUnboundedGrowth = plateauSteps.some((r) => r.plateauStatus === 'UNBOUNDED_GROWTH');
  const verdict: StressHarnessSummary['verdict'] = hasUnboundedGrowth ? 'LEAK_DETECTED' : 'PLATEAU_STABLE';

  const summary: StressHarnessSummary = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'test',
    nodeVersion: process.version,
    gcExposed: typeof (globalThis as any).gc === 'function',
    steps: results,
    verdict,
    minPostGcHeapMB,
    maxPostGcHeapMB,
    plateauVarianceMB,
  };

  printComparativeTable(summary);

  // Write out artifact
  try {
    const outDir = join(process.cwd(), 'artifacts');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'memory-stress-results.json'), JSON.stringify(summary, null, 2), 'utf8');
  } catch {
    // best-effort
  }

  return summary;
}

function printComparativeTable(summary: StressHarnessSummary): void {
  console.log('\n========================================================================================================');
  console.log('                                STRESS TEST RESULTS & PLATEAU VERIFICATION                              ');
  console.log('========================================================================================================');
  console.log(
    'Step'.padEnd(12) +
    'Total Req'.padStart(10) +
    'Pre-GC (MB)'.padStart(14) +
    'Peak (MB)'.padStart(12) +
    'Post-GC (MB)'.padStart(14) +
    'Delta (MB)'.padStart(12) +
    'RSS (MB)'.padStart(10) +
    'ArrayBuf'.padStart(10) +
    '   Status',
  );
  console.log('-'.repeat(104));

  for (const r of summary.steps) {
    console.log(
      r.label.padEnd(12) +
      r.totalRequests.toLocaleString().padStart(10) +
      r.preHeapMB.toFixed(2).padStart(14) +
      r.peakHeapMB.toFixed(2).padStart(12) +
      r.postGcHeapMB.toFixed(2).padStart(14) +
      (r.deltaFromPrevPostGcMB >= 0 ? `+${r.deltaFromPrevPostGcMB.toFixed(2)}` : r.deltaFromPrevPostGcMB.toFixed(2)).padStart(12) +
      r.postGcRssMB.toFixed(1).padStart(10) +
      r.postGcArrayBuffersMB.toFixed(2).padStart(10) +
      `   ${r.plateauStatus}`,
    );
  }
  console.log('-'.repeat(104));
  console.log(`Steady-state Plateau Variance (Steps 2-4): ${summary.plateauVarianceMB} MB (Range: ${summary.minPostGcHeapMB} - ${summary.maxPostGcHeapMB} MB)`);
  console.log(`Final Verdict: ${summary.verdict === 'PLATEAU_STABLE' ? '✔ STABLE MEMORY PLATEAU CONFIRMED (NO LEAK)' : '✖ MONOTONIC MEMORY GROWTH DETECTED'}`);
  console.log('========================================================================================================\n');
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStressTest().catch((err) => {
    console.error('Stress test harness failed:', err);
    process.exit(1);
  });
}
