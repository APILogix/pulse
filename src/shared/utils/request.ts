/**
 * Per-request client metadata helpers.
 *
 * Trust model for the IP:
 *   - Fastify's `request.ip` is the only trusted source. App.ts configures
 *     `trustProxy` so the framework already walks `X-Forwarded-For` correctly
 *     and produces the IP of the closest *trusted* proxy or the client.
 *   - We INTENTIONALLY do not re-read `X-Forwarded-For`, `X-Real-IP`, or
 *     `CF-Connecting-IP` here. Re-reading those headers in application code
 *     bypasses Fastify's trust-proxy chain and lets any client spoof their
 *     own IP, which would break IP-based rate limiting, audit, security
 *     events, and `users.last_login_ip`.
 *
 * If you ever need a tighter model, narrow `trustProxy` to a specific
 * subnet in `app.ts` rather than re-implementing the chain here.
 */
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    routerPath?: string;
    statusCode?: number;
    clientInfo: ClientInfo;
  }
}

// ============================================
// TYPES
// ============================================

export interface ClientInfo {
  ip: string;
  userAgent: string;
  device: DeviceInfo;
  requestId: string;
  timestamp: string;
  isMobile: boolean;
  isBot: boolean;
}

export interface DeviceInfo {
  type: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
}

export interface RequestWithUser extends FastifyRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
  };
  clientInfo: ClientInfo;
  startTime: number;
}

// ============================================
// USER AGENT PARSING
// ============================================

const MOBILE_REGEX = /Mobile|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini/i;
const TABLET_REGEX = /Tablet|iPad|Android(?!.*Mobile)/i;
const BOT_REGEX = /bot|crawler|spider|crawling|facebookexternalhit|googlebot|bingbot|yandex/i;

const BROWSER_PATTERNS = [
  { name: 'Edge', regex: /Edg\/([0-9.]+)/ },           // Must match before Chrome
  { name: 'Opera', regex: /OPR\/([0-9.]+)|Opera\/([0-9.]+)/ },
  { name: 'Chrome', regex: /Chrome\/([0-9.]+)/ },
  { name: 'Firefox', regex: /Firefox\/([0-9.]+)/ },
  { name: 'Safari', regex: /Version\/([0-9.]+).*Safari/ },
];

const OS_PATTERNS = [
  { name: 'Windows', regex: /Windows NT ([0-9.]+)/ },
  { name: 'macOS', regex: /Mac OS X ([0-9._]+)/ },
  { name: 'iOS', regex: /iPhone OS ([0-9._]+)|iOS ([0-9.]+)/ },
  { name: 'Android', regex: /Android ([0-9.]+)/ },
  { name: 'Linux', regex: /Linux/ },
];

// ============================================
// MAIN FUNCTION
// ============================================

export function getClientInfo(request: FastifyRequest): ClientInfo {
  const userAgent =
    typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : 'unknown';

  return {
    ip: normalizeIp(request.ip || 'unknown'),
    userAgent: userAgent.slice(0, 1024), // bounded
    device: parseDeviceInfo(userAgent),
    requestId: request.id as string,
    timestamp: new Date().toISOString(),
    isMobile: MOBILE_REGEX.test(userAgent),
    isBot: BOT_REGEX.test(userAgent),
  };
}

// ============================================
// IP NORMALIZATION (no source rewriting; only normalize formatting)
// ============================================

function normalizeIp(ip: string): string {
  // IPv6-mapped IPv4 → bare IPv4. INET columns accept both, but downstream
  // tooling is happier with the canonical form.
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

// ============================================
// DEVICE PARSING
// ============================================

function parseDeviceInfo(userAgent: string): DeviceInfo {
  return {
    type: detectDeviceType(userAgent),
    ...parseBrowser(userAgent),
    ...parseOS(userAgent),
  };
}

function detectDeviceType(userAgent: string): DeviceInfo['type'] {
  if (BOT_REGEX.test(userAgent)) return 'bot';
  if (TABLET_REGEX.test(userAgent)) return 'tablet';
  if (MOBILE_REGEX.test(userAgent)) return 'mobile';
  if (userAgent && userAgent !== 'unknown') return 'desktop';
  return 'unknown';
}

function parseBrowser(userAgent: string): { browser: string; browserVersion: string } {
  for (const pattern of BROWSER_PATTERNS) {
    const match = userAgent.match(pattern.regex);
    if (match) {
      return {
        browser: pattern.name,
        browserVersion: match[1] || match[2] || 'unknown',
      };
    }
  }
  return { browser: 'unknown', browserVersion: 'unknown' };
}

function parseOS(userAgent: string): { os: string; osVersion: string } {
  for (const pattern of OS_PATTERNS) {
    const match = userAgent.match(pattern.regex);
    if (match) {
      return {
        os: pattern.name,
        osVersion: (match[1] || match[2] || 'unknown').replace(/_/g, '.'),
      };
    }
  }
  return { os: 'unknown', osVersion: 'unknown' };
}

// ============================================
// FASTIFY DECORATOR (optional convenience plugin)
// ============================================

import fp from 'fastify-plugin';

export const clientInfoPlugin = fp(async (fastify) => {
  fastify.decorateRequest('clientInfo', null as unknown as ClientInfo);

  fastify.addHook('onRequest', async (request) => {
    request.clientInfo = getClientInfo(request);
  });
});
