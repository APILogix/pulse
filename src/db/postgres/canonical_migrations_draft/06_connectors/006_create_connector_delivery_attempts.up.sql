BEGIN;

CREATE TABLE IF NOT EXISTS connector_delivery_attempts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL,
    delivery_created_at TIMESTAMPTZ NOT NULL,

    attempt_number INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL,
    http_status INTEGER,

    error_code VARCHAR(100),
    error_message TEXT,

    response JSONB,

    duration_ms INTEGER,

    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, attempted_at),
    FOREIGN KEY (delivery_id, delivery_created_at)
        REFERENCES connector_deliveries(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_default
PARTITION OF connector_delivery_attempts DEFAULT;

COMMIT;
