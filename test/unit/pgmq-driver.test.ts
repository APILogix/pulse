import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgmqClient } from '../../src/lib/pgmq.js';

describe('PgmqClient (Supabase PGMQ Driver)', () => {
  let mockPool: any;
  let client: PgmqClient;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
    };
    client = new PgmqClient({ pool: mockPool });
  });

  it('creates a standard queue idempotently', async () => {
    // 1st query: queueExists returns false
    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    // 2nd query: create queue
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await client.createQueue('test_queue');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT pgmq.create($1::text);'),
      ['test_queue'],
    );
  });

  it('skips createQueue if queue already exists via queueExists check', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: true }] });
    await client.createQueue('already_existing_queue');
    // pgmq.create should not be called since queueExists returned true
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT pgmq.create($1::text);'),
      ['already_existing_queue'],
    );
  });

  it('gracefully absorbs SQLSTATE 55000 sequence extension member collision', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    const extensionError: any = new Error('sequence pgmq.q_ingest_dlq_msg_id_seq is already a member of extension "pgmq"');
    extensionError.code = '55000';
    mockPool.query.mockRejectedValueOnce(extensionError);

    // Should not throw
    await expect(client.createQueue('ingest_dlq')).resolves.toBeUndefined();
  });

  it('gracefully absorbs SQLSTATE 42P07 duplicate table and 23505 unique violation errors', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    const duplicateTableError: any = new Error('relation "q_test_dup" already exists');
    duplicateTableError.code = '42P07';
    mockPool.query.mockRejectedValueOnce(duplicateTableError);
    await expect(client.createQueue('test_dup')).resolves.toBeUndefined();

    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    const uniqueMetaError: any = new Error('duplicate key value violates unique constraint "pgmq_meta_queue_name_key"');
    uniqueMetaError.code = '23505';
    mockPool.query.mockRejectedValueOnce(uniqueMetaError);
    await expect(client.createQueue('test_meta_dup')).resolves.toBeUndefined();
  });

  it('populates known queues via fetchKnownQueues', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ queue_name: 'ingest_log' }, { queue_name: 'ingest_span' }],
    });
    const known = await client.fetchKnownQueues();
    expect(known.has('ingest_log')).toBe(true);
    expect(known.has('ingest_span')).toBe(true);

    // Calling createQueue on a known queue makes 0 queries
    mockPool.query.mockClear();
    await client.createQueue('ingest_log');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('creates an unlogged queue', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await client.createUnloggedQueue('test_unlogged');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT pgmq.create_unlogged($1::text);'),
      ['test_unlogged'],
    );
  });

  it('sends a single message with explicit parameter casting', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ send: '42' }] });
    const msgId = await client.send('test_queue', { hello: 'world' }, { delaySeconds: 5 });
    expect(msgId).toBe('42');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT pgmq.send($1::text, $2::jsonb, $3::integer);'),
      ['test_queue', JSON.stringify({ hello: 'world' }), 5],
    );
  });

  it('sends a batch of messages in a single SQL query', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ send_batch: '101' }, { send_batch: '102' }] });
    const msgIds = await client.sendBatch('test_queue', [{ item: 1 }, { item: 2 }]);
    expect(msgIds).toEqual(['101', '102']);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT pgmq.send_batch($1::text, $2::jsonb[], $3::integer);'),
      ['test_queue', [JSON.stringify({ item: 1 }), JSON.stringify({ item: 2 })], 0],
    );
  });

  it('reads messages with visibility timeout', async () => {
    const fakeRow = {
      msg_id: '1',
      read_ct: 1,
      enqueued_at: new Date(),
      vt: new Date(Date.now() + 60000),
      message: { task: 'compute' },
      headers: null,
    };
    mockPool.query.mockResolvedValueOnce({ rows: [fakeRow] });

    const messages = await client.read('test_queue', { visibilityTimeoutSeconds: 60, quantity: 5 });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.msgId).toBe('1');
    expect(messages[0]!.message).toEqual({ task: 'compute' });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT msg_id, read_ct, enqueued_at, vt, message, headers'),
      ['test_queue', 60, 5],
    );
  });

  it('extends visibility timeout via set_vt (heartbeat)', async () => {
    const fakeRow = {
      msg_id: '1',
      read_ct: 1,
      enqueued_at: new Date(),
      vt: new Date(Date.now() + 120000),
      message: { task: 'compute' },
      headers: null,
    };
    mockPool.query.mockResolvedValueOnce({ rows: [fakeRow] });

    const updated = await client.setVt('test_queue', '1', 120);
    expect(updated).not.toBeNull();
    expect(updated?.msgId).toBe('1');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT msg_id, read_ct, enqueued_at, vt, message, headers\n       FROM pgmq.set_vt($1::text, $2::bigint, $3::integer);'),
      ['test_queue', '1', 120],
    );
  });

  it('deletes and archives messages', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ delete: true }] });
    const deleted = await client.delete('test_queue', '1');
    expect(deleted).toBe(true);

    mockPool.query.mockResolvedValueOnce({ rows: [{ archive: true }] });
    const archived = await client.archive('test_queue', '1');
    expect(archived).toBe(true);
  });

  it('retrieves queue depth telemetry and metrics', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          queue_name: 'test_queue',
          queue_length: '25',
          newest_msg_age_sec: 2,
          oldest_msg_age_sec: 45,
          total_messages: '1000',
          scrape_time: new Date(),
          queue_visible_length: '20',
        },
      ],
    });

    const metrics = await client.metrics('test_queue');
    expect(metrics).not.toBeNull();
    expect(metrics?.queueName).toBe('test_queue');
    expect(metrics?.queueLength).toBe(25);
    expect(metrics?.queueVisibleLength).toBe(20);
    expect(metrics?.totalMessages).toBe(1000);
  });

  it('polls for messages via readWithPoll and returns immediately when messages are found', async () => {
    const fakeRow = {
      msg_id: '99',
      read_ct: 1,
      enqueued_at: new Date(),
      vt: new Date(Date.now() + 60000),
      message: { event: 'user_signup' },
      headers: null,
    };
    mockPool.query.mockResolvedValueOnce({ rows: [fakeRow] });

    const msgs = await client.readWithPoll('test_queue', {
      visibilityTimeoutSeconds: 60,
      quantity: 1,
      pollTimeoutSeconds: 1,
      pollIntervalMs: 50,
    });

    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.msgId).toBe('99');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT msg_id, read_ct, enqueued_at, vt, message, headers\n       FROM pgmq.read($1::text, $2::integer, $3::integer);'),
      ['test_queue', 60, 1],
    );
  });

  it('returns empty array when readWithPoll hits deadline with no messages', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const msgs = await client.readWithPoll('test_queue', {
      visibilityTimeoutSeconds: 60,
      quantity: 1,
      pollTimeoutSeconds: 1,
      pollIntervalMs: 50,
    });

    expect(msgs).toEqual([]);
    expect(mockPool.query).toHaveBeenCalled();
  });
});
