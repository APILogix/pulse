import fs from 'fs';
import path from 'path';

const typesPath = path.resolve('./src/modules/projects/types.ts');
let content = fs.readFileSync(typesPath, 'utf8');

// Restore missing fields to Project
content = content.replace(
  /export interface Project {([\s\S]*?)archivedAt: Date \| null;/m,
  `export interface Project {$1
  // Restored for alerting/legacy compatibility
  alertEmail?: string | null;
  alertWebhookUrl?: string | null;
  alertOnErrorRateThreshold?: number;
  alertOnLatencyThresholdMs?: number;
  metadata?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  rateLimitPerSecond?: number;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
  burstLimit?: number;
  allowedEventTypes?: string[];
  maxEventSizeBytes?: number;
  maxBatchSize?: number;
  allowedOrigins?: string[];
  requireHttps?: boolean;
  ipAllowlist?: string[] | null;
  ipBlocklist?: string[] | null;
  geoRestrictionEnabled?: boolean;
  allowedCountries?: string[] | null;
  productionApiPrefix?: string | null;
  developmentApiPrefix?: string | null;
  stagingApiPrefix?: string | null;
  
  archivedAt: Date | null;`
);

// Restore missing fields to ProjectApiKey
content = content.replace(
  /export interface ProjectApiKey {([\s\S]*?)createdAt: Date;/m,
  `export interface ProjectApiKey {$1
  // Restored for legacy compatibility
  rateLimitPerSecond?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
  permissions?: string[];
  allowedEndpoints?: string[];
  blockedEndpoints?: string[];
  
  createdAt: Date;`
);

fs.writeFileSync(typesPath, content);

const repoPath = path.resolve('./src/modules/projects/repository.ts');
let repoContent = fs.readFileSync(repoPath, 'utf8');

repoContent = repoContent.replace(
  /export interface ProjectUpdateInput {([\s\S]*?)}/m,
  `export interface ProjectUpdateInput {$1
  alertEmail?: string | null;
  alertWebhookUrl?: string | null;
  alertOnErrorRateThreshold?: number;
  alertOnLatencyThresholdMs?: number;
  metadata?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}`
);
fs.writeFileSync(repoPath, repoContent);

console.log('Restored types');
