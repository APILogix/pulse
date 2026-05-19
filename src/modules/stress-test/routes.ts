/**
 * Stress test route — heavy CPU computation endpoint.
 *
 * Simulates real-world CPU-bound workloads:
 * - Cryptographic hashing iterations
 * - Large array sorting
 * - Fibonacci computation
 * - Matrix multiplication
 * - Prime number generation
 *
 * This route is intentionally blocking to measure event loop degradation
 * under concurrent load.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomBytes } from 'crypto';

function heavyHashing(iterations: number): string {
  let hash = 'initial-seed';
  for (let i = 0; i < iterations; i++) {
    hash = createHash('sha256').update(hash + i).digest('hex');
  }
  return hash;
}

function heavySorting(size: number): number[] {
  const arr = Array.from({ length: size }, () => Math.random() * 1000000);
  return arr.sort((a, b) => a - b);
}

function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

function matrixMultiply(size: number): number[][] {
  const a = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Math.random()),
  );
  const b = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Math.random()),
  );
  const result = Array.from({ length: size }, () => Array(size).fill(0));

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      for (let k = 0; k < size; k++) {
        result[i]![j]! += a[i]![k]! * b[k]![j]!;
      }
    }
  }
  return result;
}

function generatePrimes(limit: number): number[] {
  const primes: number[] = [];
  for (let num = 2; primes.length < limit; num++) {
    let isPrime = true;
    for (let i = 2; i <= Math.sqrt(num); i++) {
      if (num % i === 0) { isPrime = false; break; }
    }
    if (isPrime) primes.push(num);
  }
  return primes;
}

export async function registerStressTestRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/stress-test', { config: { rateLimit: false } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { intensity?: string; duration?: string };
    const intensity = query.intensity || 'medium';

    const start = Date.now();
    const startMem = process.memoryUsage().heapUsed;

    let iterations: number;
    let sortSize: number;
    let fibN: number;
    let matrixSize: number;
    let primeLimit: number;

    switch (intensity) {
      case 'light':
        iterations = 50000;
        sortSize = 50000;
        fibN = 1000000;
        matrixSize = 100;
        primeLimit = 5000;
        break;
      case 'heavy':
        iterations = 500000;
        sortSize = 500000;
        fibN = 10000000;
        matrixSize = 300;
        primeLimit = 50000;
        break;
      case 'extreme':
        iterations = 2000000;
        sortSize = 2000000;
        fibN = 50000000;
        matrixSize = 500;
        primeLimit = 200000;
        break;
      case 'medium':
      default:
        iterations = 200000;
        sortSize = 200000;
        fibN = 5000000;
        matrixSize = 200;
        primeLimit = 20000;
        break;
    }

    const results: Record<string, { ms: number; result: string }> = {};

    // 1. Heavy hashing
    const hashStart = Date.now();
    const hashResult = heavyHashing(iterations);
    results.hashing = { ms: Date.now() - hashStart, result: hashResult.slice(0, 16) + '...' };

    // 2. Heavy sorting
    const sortStart = Date.now();
    const sorted = heavySorting(sortSize);
    results.sorting = { ms: Date.now() - sortStart, result: `sorted ${sortSize} items` };

    // 3. Fibonacci
    const fibStart = Date.now();
    const fibResult = fibonacci(fibN);
    results.fibonacci = { ms: Date.now() - fibStart, result: `fib(${fibN}) = ${fibResult.toExponential(4)}` };

    // 4. Matrix multiplication
    const matrixStart = Date.now();
    const matrix = matrixMultiply(matrixSize);
    results.matrix = { ms: Date.now() - matrixStart, result: `${matrixSize}x${matrixSize} matrix` };

    // 5. Prime generation
    const primeStart = Date.now();
    const primes = generatePrimes(primeLimit);
    results.primes = { ms: Date.now() - primeStart, result: `found ${primes.length} primes` };

    const totalMs = Date.now() - start;
    const endMem = process.memoryUsage().heapUsed;
    const memDeltaMB = ((endMem - startMem) / 1024 / 1024).toFixed(2);

    return reply.send({
      status: 'completed',
      intensity,
      totalMs,
      memoryDeltaMB: parseFloat(memDeltaMB),
      operations: results,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
  });

  fastify.get('/stress-test/async', { config: { rateLimit: false } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { intensity?: string };
    const intensity = query.intensity || 'medium';

    const start = Date.now();

    const tasks = [
      (async () => {
        const s = Date.now();
        heavyHashing(intensity === 'heavy' ? 500000 : 200000);
        return { op: 'hashing', ms: Date.now() - s };
      })(),
      (async () => {
        const s = Date.now();
        heavySorting(intensity === 'heavy' ? 500000 : 200000);
        return { op: 'sorting', ms: Date.now() - s };
      })(),
      (async () => {
        const s = Date.now();
        fibonacci(intensity === 'heavy' ? 10000000 : 5000000);
        return { op: 'fibonacci', ms: Date.now() - s };
      })(),
    ];

    const results = await Promise.all(tasks);
    const totalMs = Date.now() - start;

    return reply.send({
      status: 'completed',
      intensity,
      totalMs,
      operations: results,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
  });
}
