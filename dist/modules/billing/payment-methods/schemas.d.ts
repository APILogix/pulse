import { z } from 'zod';
export declare const PaymentMethodTypeSchema: z.ZodEnum<{
    card: "card";
    bank_transfer: "bank_transfer";
    upi: "upi";
    wallet: "wallet";
}>;
export declare const BillingProviderSchema: z.ZodEnum<{
    system: "system";
    stripe: "stripe";
    razorpay: "razorpay";
    manual: "manual";
}>;
export declare const ListPaymentMethodsQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    includeInactive: z.ZodDefault<z.ZodOptional<z.ZodCoercedBoolean<unknown>>>;
}, z.core.$strip>;
export declare const CreatePaymentMethodSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        system: "system";
        stripe: "stripe";
        razorpay: "razorpay";
        manual: "manual";
    }>;
    providerPaymentMethodId: z.ZodString;
    type: z.ZodEnum<{
        card: "card";
        bank_transfer: "bank_transfer";
        upi: "upi";
        wallet: "wallet";
    }>;
    last4: z.ZodOptional<z.ZodString>;
    brand: z.ZodOptional<z.ZodString>;
    expiryMonth: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    expiryYear: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    isDefault: z.ZodDefault<z.ZodOptional<z.ZodCoercedBoolean<unknown>>>;
    billingDetails: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>;
export declare const PaymentMethodParamsSchema: z.ZodObject<{
    paymentMethodId: z.ZodString;
}, z.core.$strip>;
export type ListPaymentMethodsQuery = z.infer<typeof ListPaymentMethodsQuerySchema>;
export type CreatePaymentMethodBody = z.infer<typeof CreatePaymentMethodSchema>;
//# sourceMappingURL=schemas.d.ts.map