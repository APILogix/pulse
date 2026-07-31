-- =============================================================================
-- Module      : Billing
-- Migration   : 028c2_seed_billing_features_dashboards.sql
-- Description : Seed Dashboards & Analytics feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('dashboards.enabled','Dashboards','Enable dashboards','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.custom_dashboards','Custom Dashboards','Create custom dashboards','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.widgets','Dashboard Widgets','Use built-in dashboard widgets','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.custom_widgets','Custom Widgets','Build custom dashboard widgets','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.folders','Dashboard Folders','Organize dashboards into folders','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.saved_views','Saved Views','Save reusable dashboard views','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.filters','Global Filters','Apply global dashboard filters','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.variables','Dashboard Variables','Parameterized dashboards','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.drilldowns','Drilldowns','Navigate from charts into underlying data','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.scheduled_reports','Scheduled Reports','Email scheduled dashboard reports','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.pdf_export','PDF Export','Export dashboards as PDF','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.csv_export','CSV Export','Export dashboard data as CSV','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.sharing','Dashboard Sharing','Share dashboards with users','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.public_links','Public Dashboard Links','Create public dashboard links','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('dashboards.embeds','Embedded Dashboards','Embed dashboards into external apps','feature','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),

('analytics.explorer','Analytics Explorer','Interactive analytics explorer','feature','analytics','boolean','none','{}'::jsonb,TRUE,FALSE),
('analytics.query_builder','Query Builder','Visual query builder','feature','analytics','boolean','none','{}'::jsonb,TRUE,FALSE),
('analytics.comparisons','Time Comparisons','Compare metrics across time ranges','feature','analytics','boolean','none','{}'::jsonb,TRUE,FALSE),

('ai.dashboard_insights','AI Dashboard Insights','AI-generated dashboard insights','ai','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.report_summaries','AI Report Summaries','AI-generated report summaries','ai','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.dashboards','Dashboards','Maximum dashboards','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.dashboard_widgets','Dashboard Widgets','Maximum widgets','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.saved_views','Saved Views','Maximum saved views','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('integrations.power_bi','Power BI Integration','Export to Microsoft Power BI','integration','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.grafana','Grafana Integration','Grafana interoperability','integration','dashboards','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,name,description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,is_public,is_module_root
FROM feature_seed
ON CONFLICT (feature_key)
DO UPDATE SET
name=EXCLUDED.name,
description=EXCLUDED.description,
category=EXCLUDED.category,
module=EXCLUDED.module,
value_type=EXCLUDED.value_type,
usage_behavior=EXCLUDED.usage_behavior,
configuration=EXCLUDED.configuration,
is_public=EXCLUDED.is_public,
is_module_root=EXCLUDED.is_module_root,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;