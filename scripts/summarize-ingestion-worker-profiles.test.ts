import { describe, expect, it } from 'vitest';
import {
  renderMarkdown,
  summarize,
} from './summarize-ingestion-worker-profiles.js';

describe('ingestion worker profile summary', () => {
  it('reports write-admission wait independently for successful and failed profiles', () => {
    const summary = summarize([
      {
        phase: 'ingestion_profile',
        eventType: 'request',
        received: 10,
        validated: 10,
        inserted: 10,
        writeAdmissionWaitMs: 150,
        dbConnectionWaitMs: 4,
        totalProcessingMs: 200,
      },
      {
        phase: 'ingestion_profile_failed',
        eventType: 'request',
        received: 5,
        validated: 5,
        writeAdmissionWaitMs: 75,
        dbConnectionWaitMs: 3,
        totalProcessingMs: 100,
        failureClass: 'db_connection',
      },
    ] as never);

    expect(summary.successStages.writeAdmissionWaitMs).toMatchObject({
      count: 1,
      p50: 150,
      p95: 150,
    });
    expect(summary.failedStages.writeAdmissionWaitMs).toMatchObject({
      count: 1,
      p50: 75,
      p95: 75,
    });
    expect(summary.diagnosticClassification).toContainEqual(
      expect.stringContaining('Write-admission saturation'),
    );
    expect(renderMarkdown(summary)).toContain('| writeAdmissionWaitMs | 1 | 150 | 150 | 150 | 150 | 150 |');
  });

  it('diagnoses write-admission saturation when wait evidence exists only on failed profiles', () => {
    const summary = summarize([
      {
        phase: 'ingestion_profile_failed',
        eventType: 'trace',
        received: 100,
        validated: 100,
        writeAdmissionWaitMs: 175,
        dbConnectionWaitMs: 2,
        totalProcessingMs: 200,
        failureClass: 'db_statement_timeout',
      },
    ] as never);

    expect(summary.successStages.writeAdmissionWaitMs).toMatchObject({ count: 0, p95: null });
    expect(summary.failedStages.writeAdmissionWaitMs).toMatchObject({ count: 1, p95: 175 });
    expect(summary.diagnosticClassification).toContainEqual(
      expect.stringContaining('Write-admission saturation'),
    );
    expect(summary.diagnosticClassification).not.toContainEqual(
      expect.stringContaining('No single worker bottleneck classification'),
    );
    expect(summary.findings).toContainEqual(
      expect.stringContaining('Write admission wait p95 is 175ms'),
    );
  });
});
