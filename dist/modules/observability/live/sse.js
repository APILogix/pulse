/**
 * Run an SSE loop until the client disconnects. Errors in a single poll are
 * logged and swallowed so a transient DB blip does not kill the stream.
 */
export async function streamPoll(request, reply, options) {
    const timeField = options.timeField ?? 'timestamp';
    const heartbeatMs = options.heartbeatMs ?? 15_000;
    // Take over the response: Fastify will not try to send its own reply.
    reply.hijack();
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    reply.raw.write('event: open\ndata: {}\n\n');
    let cursor = new Date();
    let closed = false;
    let ticking = false;
    const tick = async () => {
        if (closed || ticking)
            return;
        ticking = true;
        try {
            const rows = await options.fetchSince(cursor);
            for (const row of rows) {
                const raw = row[timeField];
                const ts = raw instanceof Date ? raw : raw ? new Date(String(raw)) : null;
                if (ts && !Number.isNaN(ts.getTime()) && ts > cursor)
                    cursor = ts;
                reply.raw.write(`data: ${JSON.stringify(row)}\n\n`);
            }
        }
        catch (err) {
            request.log.warn({ err, path: request.url }, 'SSE poll failed');
        }
        finally {
            ticking = false;
        }
    };
    const interval = setInterval(() => void tick(), options.intervalMs);
    const heartbeat = setInterval(() => {
        if (!closed)
            reply.raw.write(': ping\n\n');
    }, heartbeatMs);
    const cleanup = () => {
        if (closed)
            return;
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try {
            reply.raw.end();
        }
        catch {
            /* already closed */
        }
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
}
//# sourceMappingURL=sse.js.map