import fs from 'fs';
const p = 'c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository.ts';
let content = fs.readFileSync(p, 'utf8');

// 1. Rewrite PROJECT_COLUMNS
const oldColumnsMatch = /const PROJECT_COLUMNS = `[\s\S]*?`;/;
const newColumns = `const PROJECT_COLUMNS = \`
  id, org_id, name, slug, description, status, default_environment AS environment,
  archived_at, deleted_at, created_at, updated_at
\`;`;
content = content.replace(oldColumnsMatch, newColumns);

// 2. Rewrite mapProject
const mapProjectStart = content.indexOf('  private mapProject(row: ProjectRow): Project {');
const mapProjectEnd = content.indexOf('  }', mapProjectStart) + 3;
const oldMapProject = content.substring(mapProjectStart, mapProjectEnd);

const newMapProject = `  private mapProject(row: ProjectRow): Project {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      environment: row.environment,
      productionApiPrefix: null,
      developmentApiPrefix: null,
      stagingApiPrefix: null,
      rateLimitPerSecond: 0,
      rateLimitPerMinute: 0,
      rateLimitPerHour: 0,
      burstLimit: 0,
      allowedEventTypes: [],
      maxEventSizeBytes: 0,
      maxBatchSize: 0,
      allowedOrigins: [],
      requireHttps: false,
      ipAllowlist: null,
      ipBlocklist: null,
      geoRestrictionEnabled: false,
      allowedCountries: null,
      alertEmail: null,
      alertWebhookUrl: null,
      alertOnErrorRateThreshold: 0,
      alertOnLatencyThresholdMs: 0,
      metadata: {},
      settings: {},
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      deletedBy: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }`;

content = content.replace(oldMapProject, newMapProject);

fs.writeFileSync(p, content);
console.log('Fixed repository.ts columns and mapProject');
