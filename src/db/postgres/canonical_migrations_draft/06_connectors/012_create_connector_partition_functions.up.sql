-- =============================================================================
-- Generic Monthly Partition Creation Function
-- Supports all RANGE partitioned tables
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION create_monthly_partition(
    p_parent_table TEXT,
    p_partition_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_partition_name TEXT;
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Normalize to first day of month
    v_start_date := date_trunc('month', p_partition_date)::DATE;
    v_end_date := (v_start_date + INTERVAL '1 month')::DATE;

    v_partition_name :=
        format(
            '%s_%s',
            p_parent_table,
            to_char(v_start_date, 'YYYY_MM')
        );

    EXECUTE format(
        '
        CREATE TABLE IF NOT EXISTS %I
        PARTITION OF %I
        FOR VALUES FROM (%L) TO (%L)
        ',
        v_partition_name,
        p_parent_table,
        v_start_date,
        v_end_date
    );

    RAISE NOTICE 'Partition % created.', v_partition_name;

EXCEPTION
WHEN OTHERS THEN
    RAISE EXCEPTION
        'Failed creating partition for table %, month %: %',
        p_parent_table,
        v_start_date,
        SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION create_future_monthly_partitions(
    p_months_ahead INTEGER DEFAULT 2
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_month DATE;
    i INTEGER;
BEGIN
    FOR i IN 0..p_months_ahead LOOP

        v_month :=
            (date_trunc('month', CURRENT_DATE)
             + make_interval(months => i))::DATE;

        PERFORM create_monthly_partition(
            'connector_deliveries',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_delivery_attempts',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_health_checks',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_audit_logs',
            v_month
        );

    END LOOP;
END;
$$;

COMMIT;
