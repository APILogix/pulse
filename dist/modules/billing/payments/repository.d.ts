import type { Pool, PoolClient } from 'pg';
import { PaymentStatus, BillingProvider } from '../shared/types.js';
type Db = Pool | PoolClient;
export interface PaymentRow {
    id: string;
    organization_id: string;
    invoice_id: string | null;
    subscription_id: string | null;
    provider: BillingProvider;
    provider_payment_id: string | null;
    status: PaymentStatus;
    currency: string;
    amount: number;
    fee_amount: number;
    tax_amount: number;
    refunded_amount: number;
    payment_method: string | null;
    payment_method_last4: string | null;
    initiated_at: Date;
    authorized_at: Date | null;
    captured_at: Date | null;
    failed_at: Date | null;
    refunded_at: Date | null;
    failure_code: string | null;
    failure_reason: string | null;
    created_at: Date;
    updated_at: Date;
}
export declare class PaymentsRepository {
    private readonly db;
    constructor(db?: Pool);
    listPayments(orgId: string, options: {
        status?: PaymentStatus;
        limit: number;
        offset: number;
    }, db?: Db): Promise<{
        data: PaymentRow[];
        total: number;
    }>;
}
export {};
//# sourceMappingURL=repository.d.ts.map