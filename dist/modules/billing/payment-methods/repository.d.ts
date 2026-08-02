import type { Pool, PoolClient } from 'pg';
import { BillingProvider } from '../shared/types.js';
import type { CreatePaymentMethodBody } from './schemas.js';
type Db = Pool | PoolClient;
export interface PaymentMethodRow {
    id: string;
    organization_id: string;
    provider: BillingProvider;
    provider_payment_method_id: string;
    type: string;
    last4: string | null;
    brand: string | null;
    expiry_month: number | null;
    expiry_year: number | null;
    is_default: boolean;
    is_active: boolean;
    billing_details: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}
export declare class PaymentMethodsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    listPaymentMethods(orgId: string, options: {
        includeInactive: boolean;
        limit: number;
        offset: number;
    }, db?: Db): Promise<{
        data: PaymentMethodRow[];
        total: number;
    }>;
    createPaymentMethod(orgId: string, body: CreatePaymentMethodBody, db: PoolClient): Promise<PaymentMethodRow>;
    setDefault(orgId: string, paymentMethodId: string, db: PoolClient): Promise<PaymentMethodRow | null>;
    deactivate(orgId: string, paymentMethodId: string, db?: Db): Promise<PaymentMethodRow | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map