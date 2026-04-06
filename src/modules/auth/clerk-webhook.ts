/**
 * Clerk Webhook Handler
 * Processes events from Clerk authentication service
 */

import type  { FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import type { ClerkWebhookPayload, CreateUserInput } from './types.js';
import * as service from './service.js';

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET!;

/**
 * Verify Clerk webhook signature
 */
export function verifyClerkWebhook(request: FastifyRequest): boolean {
  const svixId = request.headers['svix-id'] as string;
  const svixTimestamp = request.headers['svix-timestamp'] as string;
  const svixSignature = request.headers['svix-signature'] as string;
  
  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const payload = (request as any).rawBody || JSON.stringify(request.body);
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  
  const secret = Buffer.from(CLERK_WEBHOOK_SECRET.split('_')[1], 'base64');
  const signature = createHmac('sha256', secret).update(signedContent).digest('base64');
  
  const expectedSignatures = svixSignature.split(' ').map(s => s.split(',')[1]);
  
  return expectedSignatures.some(expSig => {
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expSig));
    } catch {
      return false;
    }
  });
}

/**
 * Process Clerk webhook event
 */
export async function processClerkWebhook(payload: ClerkWebhookPayload, ipAddress: string, requestId: string): Promise<void> {
  switch (payload.type) {
    case 'user.created': {
      const primaryEmail = payload.data.email_addresses?.[0];
      if (!primaryEmail) throw new Error('No email provided');
      
      const input: CreateUserInput = {
        clerk_user_id: payload.data.id,
        email: primaryEmail.email_address,
        full_name: `${payload.data.first_name || ''} ${payload.data.last_name || ''}`.trim() || 'Unknown',
        avatar_url: payload.data.image_url,
        email_verified: primaryEmail.verification?.status === 'verified',
      };
      
      await service.createUserFromClerk(input, ipAddress, requestId);
      break;
    }
    
    case 'user.updated': {
      // Handle user updates from Clerk
      // Sync email, name, avatar changes
      break;
    }
    
    case 'user.deleted': {
      // Handle user deletion from Clerk
      // Optionally soft-delete our user record
      break;
    }
    
    case 'session.created': {
      // Log session creation for audit
      break;
    }
    
    case 'session.ended': {
      // Revoke our session if mapped
      break;
    }
  }
}