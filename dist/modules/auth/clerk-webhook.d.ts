/**
 * Clerk Webhook Handler
 * Processes events from Clerk authentication service
 */
import type { FastifyRequest } from 'fastify';
import type { ClerkWebhookPayload } from './types.js';
/**
 * Verify Clerk webhook signature
 */
export declare function verifyClerkWebhook(request: FastifyRequest): boolean;
/**
 * Process Clerk webhook event
 */
export declare function processClerkWebhook(payload: ClerkWebhookPayload, ipAddress: string, requestId: string): Promise<void>;
//# sourceMappingURL=clerk-webhook.d.ts.map