import fp from 'fastify-plugin';
import { runHashing, runSorting, runFibonacci, simulateAsyncTask, simulateJsonProcessing, } from './helpers.js';
// ─── Route Handlers ──────────────────────────────────────────────────────────
/**
 * GET /benchmark
 *
 * Ultra-light probe — returns runtime metadata with zero computation.
 * Ideal baseline: measures pure Fastify routing + serialisation overhead.
 */
async function benchmarkLight(_request, reply) {
    return reply.send({
        success: true,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
    });
}
/**
 * GET /benchmark/heavy
 *
 * Runs three synchronous CPU-bound workloads sequentially and reports
 * individual + total durations.  Exposes event-loop blockage under load.
 *
 * Query params:
 *   intensity: 'light' | 'medium' | 'heavy'  (default: 'medium')
 */
async function benchmarkHeavy(request, reply) {
    const { intensity = 'medium' } = request.query;
    // Workload sizes per intensity level
    const config = {
        light: { hashIter: 10_000, sortSize: 50_000, fibN: 5_000 },
        medium: { hashIter: 50_000, sortSize: 200_000, fibN: 20_000 },
        heavy: { hashIter: 200_000, sortSize: 500_000, fibN: 50_000 },
    };
    const { hashIter, sortSize, fibN } = config[intensity] ?? config.medium;
    const start = performance.now();
    const hashing = runHashing(hashIter);
    const sorting = runSorting(sortSize);
    const fibonacci = runFibonacci(fibN);
    const totalMs = Math.round(performance.now() - start);
    return reply.send({ intensity, hashing, sorting, fibonacci, totalMs });
}
/**
 * GET /benchmark/async
 *
 * Runs multiple async tasks concurrently via Promise.all.
 * Measures event-loop scheduling efficiency under parallel I/O simulation.
 *
 * Query params:
 *   concurrency: number of parallel tasks  (default: 5, max: 20)
 */
async function benchmarkAsync(request, reply) {
    const query = request.query;
    const concurrency = Math.min(Number(query.concurrency ?? 5), 20);
    const start = performance.now();
    // Build a mix of tasks — delays + in-process work
    const tasks = await Promise.all([
        simulateAsyncTask('io-fast', 10),
        simulateAsyncTask('io-medium', 50),
        simulateAsyncTask('io-slow', 100),
        simulateJsonProcessing(2_000),
        simulateJsonProcessing(5_000),
        ...Array.from({ length: Math.max(0, concurrency - 5) }, (_, i) => simulateAsyncTask(`io-extra-${i}`, 20 + i * 10)),
    ]);
    const totalMs = Math.round(performance.now() - start);
    return reply.send({ concurrency, tasks, totalMs });
}
// ─── Plugin Registration ──────────────────────────────────────────────────────
async function benchmarkPlugin(fastify) {
    fastify.get('/benchmark', { config: { rateLimit: false } }, benchmarkLight);
    fastify.get('/benchmark/heavy', { config: { rateLimit: false } }, benchmarkHeavy);
    fastify.get('/benchmark/async', { config: { rateLimit: false } }, benchmarkAsync);
    fastify.log.info('Benchmark routes registered: GET /benchmark, /benchmark/heavy, /benchmark/async');
}
export const registerBenchmarkRoutes = fp(benchmarkPlugin, {
    name: 'benchmark-routes',
});
//# sourceMappingURL=routes.js.map