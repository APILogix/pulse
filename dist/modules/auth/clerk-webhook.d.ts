/**
 * Clerk Webhook Handler
 * Processes events from Clerk authentication service
 *
 * Flow:
 * 1. Verify Svix/Clerk signature headers against the raw payload.
 * 2. Switch by Clerk event type.
 * 3. Convert supported user lifecycle events into the local auth service
 *    contract.
 *
 * The local user record remains the backend source for authorization/session
 * behavior after the external identity event is accepted.
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