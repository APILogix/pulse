// types.ts - Shared Billing Module Types

import { z } from 'zod';
import type { FastifyRequest } from 'fastify';

// ============================================
// ENUMS (matching DB schema)
// ============================================

export enum PlanTier {
  FREE = 'free',
  STARTER = 'starter',
  GROWTH = 'growth',
  BUSINESS = 'business',
  ENTERPRISE = 'enterprise'
}

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  INCOMPLETE = 'incomplete'
}

export enum BillingProvider {
  STRIPE = 'stripe',
  RAZORPAY = 'razorpay',
  MANUAL = 'manual',
  SYSTEM = 'system'
}

export enum BillingInterval {
  MONTHLY = 'monthly',
  ANNUAL = 'annual'
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
  UNCOLLECTIBLE = 'uncollectible',
  REFUNDED = 'refunded'
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

export enum CouponDiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount'
}

export enum FeatureValueType {
  BOOLEAN = 'boolean',
  INTEGER = 'integer',
  DECIMAL = 'decimal',
  STRING = 'string'
}

export enum FeatureCategory {
  MONITORING = 'monitoring',
  AI = 'ai',
  ALERTS = 'alerts',
  PROJECTS = 'projects',
  ORGANIZATION = 'organization',
  DASHBOARD = 'dashboard',
  SECURITY = 'security',
  LIMITS = 'limits',
  INTEGRATIONS = 'integrations'
}

export enum SubscriptionEventType {
  CREATED = 'created',
  UPGRADED = 'upgraded',
  DOWNGRADED = 'downgraded',
  RENEWED = 'renewed',
  TRIAL_STARTED = 'trial_started',
  TRIAL_ENDED = 'trial_ended',
  CANCELLED = 'cancelled',
  RESUMED = 'resumed',
  EXPIRED = 'expired',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_SUCCEEDED = 'payment_succeeded',
  ADDON_PURCHASED = 'addon_purchased',
  FEATURE_OVERRIDE_ADDED = 'feature_override_added'
}

export enum SubscriptionEventActor {
  USER = 'user',
  ADMIN = 'admin',
  SYSTEM = 'system',
  BILLING_PROVIDER = 'billing_provider'
}

// ============================================
// COMMON SCHEMAS
// ============================================

export const BillingUuidSchema = z.string().uuid();

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

// ============================================
// SERVICE RESPONSE TYPES
// ============================================

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
    orgId?: string;
    currentOrgId?: string;
  };
}

export type RequestWithUser = AuthenticatedRequest;
