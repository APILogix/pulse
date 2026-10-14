import { describe, expect, it } from 'vitest';
import { WorkerMetrics } from './metrics-server.js';

describe('WorkerMetrics', () => {
  it('renders rolling latency quantiles for processing and e2e latency', () => {
    const metrics = new WorkerMetrics();

    for (const ms of [10, 20, 30, 40, 50]) {
      metrics.recordProcessed('ingest.error', 'error', 1, 1, 0, ms, ms + 100);
    }

    const output = metrics.render(null);

    expect(output).toContain('ingest_processing_latency_ms_quantile{type="error",quantile="0.5"} 30');
    expect(output).toContain('ingest_processing_latency_ms_quantile{type="error",quantile="0.95"} 50');
    expect(output).toContain('ingest_processing_latency_ms_quantile{type="error",quantile="0.99"} 50');
    expect(output).toContain('ingest_processing_latency_ms_quantile{type="error",quantile="0.999"} 50');
    expect(output).toContain('ingest_e2e_latency_ms_quantile{type="error",quantile="0.5"} 130');
  });

  it('renders stage latency quantiles with stage and type labels', () => {
    const metrics = new WorkerMetrics();

    for (const ms of [1, 5, 9, 13, 100]) {
      metrics.recordStage('db_connection_wait', 'span', ms);
    }

    const output = metrics.render(null);

    expect(output).toContain('ingest_stage_latency_ms_quantile{stage="db_connection_wait",type="span",quantile="0.5"} 9');
    expect(output).toContain('ingest_stage_latency_ms_quantile{stage="db_connection_wait",type="span",quantile="0.95"} 100');
  });

  it('renders per-type typed insert stage latency quantiles', () => {
    const metrics = new WorkerMetrics();

    for (const ms of [7, 11, 19]) {
      metrics.recordStage('perType.request.durationMs', 'request', ms);
    }

    const output = metrics.render(null);

    expect(output).toContain('ingest_stage_latency_ms_quantile{stage="perType.request.durationMs",type="request",quantile="0.5"} 11');
    expect(output).toContain('ingest_stage_latency_ms_quantile{stage="perType.request.durationMs",type="request",quantile="0.99"} 19');
  });

  it('renders error path quantiles for grouping metrics', () => {
    const metrics = new WorkerMetrics();

    metrics.recordErrorLatencies(2, 10, 20, 1);
    metrics.recordErrorLatencies(4, 30, 40, 3);

    const output = metrics.render(null);

    expect(output).toContain('ingest_error_group_lookup_ms_quantile{type="lookup",quantile="0.5"} 2');
    expect(output).toContain('ingest_error_group_upsert_ms_quantile{type="upsert",quantile="0.95"} 30');
    expect(output).toContain('ingest_error_transaction_ms_quantile{type="transaction",quantile="0.99"} 40');
    expect(output).toContain('ingest_error_domain_event_ms_quantile{type="domain_event",quantile="0.999"} 3');
  });

  it('renders database pool connection gauges', () => {
    const metrics = new WorkerMetrics();

    const output = metrics.render(null, [
      { name: 'telemetry', total: 8, idle: 3, waiting: 2 },
    ]);

    expect(output).toContain('ingest_db_pool_connections{pool="telemetry",state="total"} 8');
    expect(output).toContain('ingest_db_pool_connections{pool="telemetry",state="idle"} 3');
    expect(output).toContain('ingest_db_pool_connections{pool="telemetry",state="in_use"} 5');
    expect(output).toContain('ingest_db_pool_connections{pool="telemetry",state="waiting"} 2');
  });

  it('renders retry counters and worker utilization gauges', () => {
    const metrics = new WorkerMetrics();

    metrics.recordRetry('ingest.span', 2);
    metrics.recordFailed('ingest.span', 7, 'span', 'db_connection');
    metrics.recordFairnessStarvationAdmission('ingest.span', 'span');
    metrics.setWorkerCapacity('ingest.span', 'span', 40);
    metrics.setWorkerInFlight('ingest.span', 'span', 7);

    const output = metrics.render(null);

    expect(output).toContain('ingest_jobs_retried_total{queue="ingest.span"} 2');
    expect(output).toContain('ingest_events_failed_total{queue="ingest.span"} 7');
    expect(output).toContain('ingest_events_failed_by_reason_total{queue="ingest.span",type="span",reason="db_connection"} 7');
    expect(output).toContain('ingest_fairness_starvation_guard_admissions_total{queue="ingest.span",type="span"} 1');
    expect(output).toContain('ingest_worker_configured_slots{queue="ingest.span",type="span"} 40');
    expect(output).toContain('ingest_worker_inflight_jobs{queue="ingest.span",type="span"} 7');
  });

  it('renders duplicate counters by queue and event type', () => {
    const metrics = new WorkerMetrics();

    metrics.recordDuplicates('ingest.request', 'request', 3);
    metrics.recordDuplicates('ingest.request', 'request', 2);
    metrics.recordDuplicates('ingest.span', 'span', 0);

    const output = metrics.render(null);

    expect(output).toContain('ingest_events_duplicate_total{queue="ingest.request",type="request"} 5');
    expect(output).not.toContain('ingest_events_duplicate_total{queue="ingest.span",type="span"}');
  });

  it('renders throughput counters by queue and event type', () => {
    const metrics = new WorkerMetrics();

    metrics.recordProcessed('ingest.log', 'log', 10, 9, 1, 12, 20, 2048);
    metrics.recordProcessed('ingest.log', 'log', 5, 5, 0, 8, 15, 1024);

    const output = metrics.render(null);

    expect(output).toContain('ingest_batches_processed_by_type_total{queue="ingest.log",type="log"} 2');
    expect(output).toContain('ingest_events_received_by_type_total{queue="ingest.log",type="log"} 15');
    expect(output).toContain('ingest_events_inserted_by_type_total{queue="ingest.log",type="log"} 14');
    expect(output).toContain('ingest_events_rejected_by_type_total{queue="ingest.log",type="log"} 1');
    expect(output).toContain('ingest_batch_bytes_total{queue="ingest.log",type="log"} 3072');
  });

  it('renders database query count distribution per batch', () => {
    const metrics = new WorkerMetrics();

    for (const queries of [3, 4, 4, 6, 9]) {
      metrics.recordDbQueries('request', queries);
    }

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_queries_per_batch_count{type="request"} 5');
    expect(output).toContain('ingest_db_queries_per_batch_sum{type="request"} 26');
    expect(output).toContain('ingest_db_queries_per_batch_max{type="request"} 9');
    expect(output).toContain('ingest_db_queries_per_batch_quantile{type="request",quantile="0.95"} 9');
  });

  it('renders database query duration distribution', () => {
    const metrics = new WorkerMetrics();

    for (const ms of [2, 8, 13, 21]) {
      metrics.recordDbQueryDuration('metric', ms);
    }

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_query_duration_ms_count{type="metric"} 4');
    expect(output).toContain('ingest_db_query_duration_ms_sum{type="metric"} 44');
    expect(output).toContain('ingest_db_query_duration_ms_max{type="metric"} 21');
    expect(output).toContain('ingest_db_query_duration_ms_quantile{type="metric",quantile="0.95"} 21');
  });

  it('renders events and bytes per batch distributions', () => {
    const metrics = new WorkerMetrics();

    metrics.recordBatchShape('span', 47, 4096);
    metrics.recordBatchShape('span', 200, 16384);

    const output = metrics.render(null);

    expect(output).toContain('ingest_events_per_batch_count{type="span"} 2');
    expect(output).toContain('ingest_events_per_batch_max{type="span"} 200');
    expect(output).toContain('ingest_batch_bytes_sum{type="span"} 20480');
    expect(output).toContain('ingest_batch_bytes_quantile{type="span",quantile="0.95"} 16384');
  });

  it('renders oldest pending job age gauges', () => {
    const metrics = new WorkerMetrics();

    const output = metrics.render({
      pending: 3,
      ready: 2,
      deferred: 1,
      active: 1,
      failed: 0,
      deadLettered: 3,
      oldestPendingAgeMs: 12_345,
      perQueue: [
        { queue: 'ingest.error', state: 'created', count: 2, ready: 2, deferred: 0, oldestPendingAgeMs: 12_345 },
        { queue: 'ingest.span', state: 'active', count: 1, ready: 0, deferred: 0, oldestPendingAgeMs: null },
        { queue: 'ingest.trace', state: 'retry', count: 1, ready: 0, deferred: 1, oldestPendingAgeMs: 4_000 },
      ],
      dlqPerQueue: [
        { queue: 'ingest.error', count: 2 },
        { queue: 'ingest.trace', count: 1 },
      ],
    });

    expect(output).toContain('ingest_queue_depth_ready 2');
    expect(output).toContain('ingest_queue_depth_deferred 1');
    expect(output).toContain('ingest_dlq_retained_jobs 3');
    expect(output).toContain('ingest_queue_ready_jobs{queue="ingest.error",state="created"} 2');
    expect(output).toContain('ingest_queue_deferred_jobs{queue="ingest.trace",state="retry"} 1');
    expect(output).toContain('ingest_dlq_retained_jobs_per_queue{queue="ingest.error"} 2');
    expect(output).toContain('ingest_queue_oldest_pending_job_age_ms 12345');
    expect(output).toContain(
      'ingest_queue_oldest_pending_job_age_ms_per_queue{queue="ingest.error",state="created"} 12345',
    );
    expect(output).toContain(
      'ingest_queue_oldest_pending_job_age_ms_per_queue{queue="ingest.trace",state="retry"} 4000',
    );
  });

  it('renders database pool acquisition latency and timeout metrics', () => {
    const metrics = new WorkerMetrics();

    metrics.recordPoolAcquire('write_pool', 5);
    metrics.recordPoolAcquire('write_pool', 15);
    metrics.recordPoolAcquireTimeout('write_pool');

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_pool_acquire_duration_ms_count{pool="write_pool"} 2');
    expect(output).toContain('ingest_db_pool_acquire_duration_ms_max{pool="write_pool"} 15');
    expect(output).toContain('ingest_db_pool_acquire_timeout_total{pool="write_pool"} 1');
  });

  it('renders transaction latency, commit duration, rollbacks, and long transactions', () => {
    const metrics = new WorkerMetrics();

    metrics.recordTransaction('batch_write', 120, true, 10);
    metrics.recordTransaction('batch_write', 1500, true, 25);
    metrics.recordTransaction('batch_write', 50, false);

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_transaction_duration_ms_count{op="batch_write"} 3');
    expect(output).toContain('ingest_db_transaction_commit_duration_ms_count{op="batch_write"} 2');
    expect(output).toContain('ingest_db_transaction_rollbacks_total{op="batch_write"} 1');
    expect(output).toContain('ingest_db_long_transactions_total{op="batch_write"} 1');
  });

  it('renders slow query and query error counters', () => {
    const metrics = new WorkerMetrics();

    metrics.recordDbQuery('error_groups_update', 1200, true);
    metrics.recordDbQueryError('events_requests_insert', 'statement_timeout');

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_slow_queries_total{op="error_groups_update"} 1');
    expect(output).toContain('ingest_db_query_errors_total{op="events_requests_insert",reason="statement_timeout"} 1');
  });

  it('renders lock wait and deadlock metrics', () => {
    const metrics = new WorkerMetrics();

    metrics.recordLockWait('error_groups', 45);
    metrics.recordDeadlock('error_groups');

    const output = metrics.render(null);

    expect(output).toContain('ingest_db_lock_waits_total{table="error_groups"} 1');
    expect(output).toContain('ingest_db_lock_wait_duration_ms_max{table="error_groups"} 45');
    expect(output).toContain('ingest_db_deadlocks_total{table="error_groups"} 1');
  });

  it('renders queue poll duration, messages fetched, empty polls, and visibility timeout failures', () => {
    const metrics = new WorkerMetrics();

    metrics.recordQueuePoll('ingest.error', 15, 10);
    metrics.recordQueuePoll('ingest.error', 5, 0);
    metrics.recordVisibilityTimeoutFailure('ingest.error');

    const output = metrics.render(null);

    expect(output).toContain('ingest_queue_poll_duration_ms_count{queue="ingest.error"} 2');
    expect(output).toContain('ingest_queue_messages_fetched_total{queue="ingest.error"} 10');
    expect(output).toContain('ingest_queue_empty_polls_total{queue="ingest.error"} 1');
    expect(output).toContain('ingest_queue_visibility_timeout_failures_total{queue="ingest.error"} 1');
  });

  it('renders startup phase timing gauges', () => {
    const metrics = new WorkerMetrics();

    metrics.recordStartupPhase('migrations', 1200);
    metrics.recordStartupPhase('queue_registration', 350);
    metrics.recordStartupPhase('worker_init', 400);
    metrics.recordStartupPhase('outbox', 150);
    metrics.recordStartupPhase('total', 2100);

    const output = metrics.render(null);

    expect(output).toContain('ingest_startup_phase_duration_ms{phase="migrations"} 1200');
    expect(output).toContain('ingest_startup_phase_duration_ms{phase="queue_registration"} 350');
    expect(output).toContain('ingest_startup_phase_duration_ms{phase="worker_init"} 400');
    expect(output).toContain('ingest_startup_phase_duration_ms{phase="outbox"} 150');
    expect(output).toContain('ingest_startup_phase_duration_ms{phase="total"} 2100');
  });
});
