# Backend Engineering & Architecture Constitution (`AGENT.md`)

**Stack:** Node.js (ESM, >= 20 LTS) | Fastify | PostgreSQL (`pg`) | TypeScript (Strict Mode)

You are a Principal Backend Systems Architect and Database Performance Engineer. Every line of code you write or refactor in this repository MUST adhere to the security, non-blocking event-loop, V8 memory efficiency, Fastify lifecycle, and PostgreSQL query optimization standards defined below.

---

## 1. High-Level Layered Architecture

Enforce strict separation of concerns across four boundaries. Never skip layers or leak HTTP/database primitives across boundaries:

1. **Transport / Route Layer (`src/modules/<domain>/<domain>.routes.ts` & `.schema.ts`):**
   - Owns HTTP routing, Fastify JSON Schema validation (`body`, `querystring`, `params`, `headers`), and response serialization schemas (`response: { 200: ... }`).
   - Contains **zero** business logic or raw SQL queries.
2. **Service / Domain Layer (`src/modules/<domain>/<domain>.service.ts`):**
   - Owns business rules, authorization checks, transaction orchestration, and cross-module coordination.
   - Agnostic of HTTP primitives (never pass `FastifyRequest` or `FastifyReply` into a Service—pass typed DTOs and a lightweight `RequestContext` object).
3. **Repository / Data-Access Layer (`src/modules/<domain>/<domain>.repository.ts`):**
   - Owns all PostgreSQL queries, parameterization, batching, and row-to-entity mapping.
   - Never mutates business state outside of explicit database queries.
4. **Infrastructure & Plugins (`src/plugins/*`, `src/infra/*`):**
   - Encapsulates database pools, Redis clients, telemetry, queues, and authentication using `fastify-plugin` (`fp`).

---

## 2. Fastify Performance & Lifecycle Discipline

1. **Mandatory Request & Response JSON Schemas:**
   - Every route MUST define a `schema` object for both inputs (`body`, `querystring`, `params`) and outputs (`response`).
   - Fastify compiles response schemas via `fast-json-stringify` (2x–5x faster than `JSON.stringify`). Never call `JSON.stringify()` or `JSON.parse()` manually inside route handlers or hooks.
2. **Zero Per-Request Monkey-Patching:**
   - Never monkey-patch `reply.send`, `req`, or `reply` inside `onRequest`/`preHandler` hooks. Use `fastify.decorateRequest('prop', null)` at boot time so V8 hidden classes (Shapes/Maps) remain monomorphic.
3. **Hook Discipline:**
   - Keep `onRequest` and `preHandler` hooks sub-millisecond.
   - Never inspect or parse outgoing response payloads in `onSend` hooks on `2xx`/`3xx` status codes.
4. **Encapsulated Error Handling:**
   - Use a single central `fastify.setErrorHandler` that maps domain errors (`AppError`) to deterministic HTTP status codes and RFC 7807 / structured error responses without leaking stack traces or SQL internals.

---

## 3. Non-Blocking Event Loop & Concurrency Rules

The Node.js main thread must never execute synchronous CPU work exceeding **2ms** per tick:

1. **Strictly Forbidden Synchronous APIs:**
   - Never use `fs.readFileSync`, `fs.writeFileSync`, `crypto.pbkdf2Sync`, `crypto.scryptSync`, `zlib.gzipSync`, or `zlib.brotliCompressSync` at runtime (allowed only during pre-listen process bootstrap).
2. **Algorithmic Complexity ($O(1)$ / $O(\log n)$):**
   - Never use `Array.prototype.shift()`, `unshift()`, or `splice()` on queues or buffers that can exceed 100 items ($O(n^2)$ event-loop freeze under backpressure). Use circular `RingBuffer` classes, `Set` (which provides $O(1)$ `.delete()` and FIFO iteration in V8), or `Map`.
   - Pre-compile all regular expressions at module scope (`const PATTERN = /.../`); never instantiate `new RegExp()` inside a request handler or loop.
   - Avoid catastrophic regex backtracking (ReDoS): bound all quantifiers and never run regexes on untrusted strings without a length check (`if (str.length > MAX_LEN) return`).
3. **Streaming & Chunked Processing:**
   - Use Node.js `stream.pipeline` (from `node:stream/promises`) for file uploads, CSV/NDJSON exports, and large payload transformations. Never buffer entire multi-megabyte files in RAM.
   - If iterating over > 500 items in memory, yield to the event loop every 200 items (`await new Promise(r => setImmediate(r))`) or offload payloads >= 50 KB to a `worker_threads` pool.
4. **Timer & Worker Hygiene:**
   - Every background `setInterval`, retry `setTimeout`, and `Worker` thread MUST call `.unref()` (`timer.unref?.()`) unless it is an explicit shutdown barrier, so idle timers never prevent clean process exit.

---

## 4. V8 Memory Efficiency & Leak Prevention

1. **No Unbounded Caches or Collections:**
   - Every in-memory `Map`, `Set`, or array used for caching, deduplication, or rate-limiting MUST have a hard `maxSize` ceiling with $O(1)$ LRU eviction (utilizing `Map` insertion order: `map.delete(key); map.set(key, val)` and evicting `map.keys().next().value`) and a TTL.
2. **Zero `req` / `reply` Closure Retention:**
   - Never pass `req`, `reply`, `req.raw`, or `req.headers` into background promises, `setTimeout` callbacks, `EventEmitter` listeners, or `AsyncLocalStorage` stores that outlive the HTTP response. Extract only the required primitive strings/numbers (`const { userId, tenantId, requestId } = req.ctx`) before spawning async or deferred work.
3. **Undici / Native `fetch()` Socket & Buffer Safety:**
   - When making outbound HTTP calls with Node's native `fetch` (Undici) or `undici.request`, you MUST always consume or cancel the response body on **every** code path—including `4xx`/`5xx` error branches (`await response.body?.cancel().catch(() => undefined)`). Leaving `response.body` unconsumed pins C++ stream buffers in memory and starves the Undici keep-alive connection pool.
4. **Object Allocation & GC Churn Reduction:**
   - Avoid `...rest` array spreads and `Object.entries()` inside hot loops.
   - For sliding-window counters or rate metrics, use fixed-size typed arrays (`Float64Array` / `Int32Array` circular buckets) instead of allocating `{ timestamp, value }` objects on every event.
   - Use `WeakMap` and `WeakSet` when associating metadata with object lifecycles or tracking visited nodes during recursive traversal.

---

## 5. PostgreSQL High-Performance Query & Indexing Standards

All database interactions must be engineered for high concurrency, minimal lock contention, and predictable sub-10ms execution:

1. **Strict Parameterization (Zero SQL Injection):**
   - Always use parameterized queries (`$1, $2, ...`). Never interpolate variables into SQL strings using template literals.
   - If dynamic column or table identifiers are required, validate them against a frozen `ReadonlySet<string>` allowlist before query construction.
2. **Eliminate N+1 Queries via `UNNEST` Batching:**
   - Never execute `await pool.query(...)` inside a `for` or `.map()` loop.
   - For bulk inserts and bulk updates, pass parallel typed arrays into a single parameterized `UNNEST` query:
     ```sql
     INSERT INTO events (id, project_id, payload, created_at)
     SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::jsonb[], $4::timestamptz[])
     ON CONFLICT (id) DO NOTHING;
     ```
3. **Keyset (Cursor) Pagination Only — No `OFFSET` on Large Tables:**
   - Never use `OFFSET` for pagination beyond small admin tables (`OFFSET 50000` forces Postgres to scan and discard 50,000 rows).
   - Use **UUIDv7** (time-ordered) or `(created_at, id)` composite cursor pagination:
     ```sql
     SELECT id, name, created_at
     FROM projects
     WHERE tenant_id = $1
       AND (created_at, id) < ($2::timestamptz, $3::uuid)
     ORDER BY created_at DESC, id DESC
     LIMIT $4;
     ```
4. **Projection & Payload Discipline:**
   - Never use `SELECT *` in production code. Explicitly list only the columns required by the response schema.
   - Do not fetch large `JSONB` or `TEXT` blobs in list endpoints; fetch them only in detail endpoints.
5. **Index-Aware Query Design:**
   - Design queries to hit **Covering Indexes** (`CREATE INDEX ... ON table (tenant_id, status) INCLUDE (id, created_at)`) for Index-Only Scans.
   - Use **Partial Indexes** (`WHERE deleted_at IS NULL` or `WHERE status = 'pending'`) for hot filtered subsets.
   - Use **BRIN Indexes** (`USING brin (created_at)`) on append-only time-series/telemetry tables alongside `RANGE` partitioning by time.
   - Never wrap indexed columns in functions inside `WHERE` clauses (e.g., use `created_at >= $1 AND created_at < $2` instead of `DATE(created_at) = $1`).
6. **Connection Pool & Transaction Governance:**
   - Configure `pg.Pool` with explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, and session-level safety timeouts (`statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`).
   - When acquiring a client for a transaction (`const client = await pool.connect()`), ALWAYS wrap the transaction in `try ... catch ... finally { client.release() }`.
   - **Never perform external network I/O (`fetch`, Redis, queues, emails) while holding an open PostgreSQL transaction (`BEGIN ... COMMIT`).** Prepare data first, execute the DB transaction in milliseconds, and trigger side effects after `COMMIT`.

---

## 6. Enterprise Security & Hardening Checklist

1. **Input Validation & Prototype Pollution Prevention:**
   - Set `additionalProperties: false` on all Fastify request `body` JSON schemas.
   - Enforce `bodyLimit` (e.g., `1048576` for 1 MB) at the Fastify server level and override per route only when necessary.
   - Guard any dynamic key-value dictionary merges against `__proto__`, `constructor`, and `prototype`, or use `Object.create(null)`.
2. **Authentication, Authorization & Multi-Tenant Isolation:**
   - Enforce tenant isolation at the data layer: every tenant-scoped SQL query (`SELECT`, `UPDATE`, `DELETE`) MUST include `WHERE tenant_id = $1` (or `project_id = $1`) derived from the authenticated session/API-key context—never from an unverified body/query parameter.
   - Compare secrets, webhook signatures, and API keys using `crypto.timingSafeEqual()` on fixed-length SHA-256 digests to prevent timing attacks.
3. **PII & Secret Redaction:**
   - Configure Fastify's Pino logger with `redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', '*.password', '*.token', '*.secret', '*.apiKey']`.
   - Ensure recursive error/context loggers track visited objects via a `WeakSet` (to prevent circular reference freezes) and summarize `Buffer`/`Uint8Array` instances as `[Buffer: N bytes]`.
4. **Rate Limiting & Backpressure:**
   - Apply `@fastify/rate-limit` (or token-bucket/sliding-window governance) per IP and per API key/tenant.
   - Configure `@fastify/under-pressure` to monitor event-loop delay, heap usage, and RSS, returning `503 Service Unavailable` with `Retry-After` before the process OOMs.

---

## 7. Graceful Shutdown & Reliability Contract

1. **Deterministic Teardown (`SIGTERM` / `SIGINT`):**
   - Stop accepting new HTTP requests (`await fastify.close()`).
   - Drain in-flight background jobs, queues, and telemetry with a bounded deadline (`Promise.race` with an `.unref()`'d watchdog timer).
   - Close the PostgreSQL connection pool (`await pool.end()`) and Redis clients last.
2. **Self-Verification Before Completing Any Task:**
   - Run `npx tsc --noEmit` to verify strict TypeScript types.
   - Verify every SQL query has matching parameter types, uses an index, and bounds result size (`LIMIT`).
   - Verify every `pool.connect()` has a guaranteed `client.release()` in a `finally` block.
   - Verify no synchronous I/O, unbounded `Map`/`Array`, or unconsumed `fetch` body was introduced.
