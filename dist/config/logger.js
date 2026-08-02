import pino from 'pino';
import { env } from './env.js';
const isDev = env.NODE_ENV === 'development';
export const logger = pino({
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(isDev && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
            },
        },
    }),
    base: {
        pid: process.pid,
        env: env.NODE_ENV,
    },
    redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        'apiKey',
    ],
});
// Request logger instance
export const requestLogger = logger.child({ component: 'http' });
//# sourceMappingURL=logger.js.map