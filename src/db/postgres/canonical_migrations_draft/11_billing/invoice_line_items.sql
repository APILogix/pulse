CREATE TABLE invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    
    line_type VARCHAR(30) NOT NULL            -- 'plan', 'addon', 'overage', 'discount', 'tax'
        CHECK (line_type IN ('plan','addon','overage','discount','tax','credit')),
    
    description VARCHAR(255) NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 1,
    unit_amount_minor BIGINT NOT NULL,        -- Price per unit
    amount_minor BIGINT NOT NULL,             -- quantity * unit_amount
    
    -- References
    plan_id UUID REFERENCES plans(id),
    addon_id UUID REFERENCES addons(id),
    feature_key VARCHAR(100),                 -- 'monthly_events', 'ai_credits'
    
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);