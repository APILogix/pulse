import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  resolveDatabasePath,
  getDatabaseDirectories,
  extractTableDependencies,
  topologicalSortDomainFiles,
  buildDatabasePlan,
  parseCliOptions,
  executePlan,
  PRIMARY_DOMAIN_ORDER,
  LOGDB_DOMAIN_ORDER,
} from '../../scripts/run-modular-schema.js';

describe('Modular Schema Runner (run-modular-schema.ts)', () => {
  describe('Directory Resolution', () => {
    it('resolves primary database directory correctly', () => {
      const primaryDirs = getDatabaseDirectories('primary');
      expect(fs.existsSync(primaryDirs.baseDir)).toBe(true);
      expect(fs.existsSync(primaryDirs.schemaDir)).toBe(true);
      expect(primaryDirs.baseDir).toContain('primarydbv2');
    });

    it('resolves logdb database directory correctly', () => {
      const logDirs = getDatabaseDirectories('logdb');
      expect(fs.existsSync(logDirs.baseDir)).toBe(true);
      expect(fs.existsSync(logDirs.schemaDir)).toBe(true);
      expect(logDirs.baseDir).toContain('logdbv2');
    });

    it('resolves candidate paths in fallback order', () => {
      const resolved = resolveDatabasePath([
        'non_existent_folder_xyz',
        'database/primarydbv2',
      ]);
      expect(fs.existsSync(resolved)).toBe(true);
      expect(resolved).toContain('primarydbv2');
    });
  });

  describe('Dependency Extraction and Topological Ordering', () => {
    it('extracts table creation and foreign key references from SQL files', () => {
      const primaryDirs = getDatabaseDirectories('primary');
      const sessionsFile = path.join(primaryDirs.schemaDir, '04_user/001_create_user_sessions.sql');
      const info = extractTableDependencies(sessionsFile, '04_user', '001_create_user_sessions.sql');

      expect(info.file).toBe('001_create_user_sessions.sql');
      expect(info.domain).toBe('04_user');
      expect(info.createdTables).toContain('user_sessions');
      expect(info.refTables).toContain('users');
    });

    it('orders tables topologically such that users precedes user_sessions', () => {
      const primaryDirs = getDatabaseDirectories('primary');
      const userDomain = path.join(primaryDirs.schemaDir, '04_user');
      const sorted = topologicalSortDomainFiles(userDomain, '04_user');

      const userIndex = sorted.findIndex((f) => f.createdTables.includes('users'));
      const sessionIndex = sorted.findIndex((f) => f.createdTables.includes('user_sessions'));

      expect(userIndex).toBeGreaterThanOrEqual(0);
      expect(sessionIndex).toBeGreaterThanOrEqual(0);
      expect(userIndex).toBeLessThan(sessionIndex);
    });

    it('orders organizations before organization_members in 05_organization', () => {
      const primaryDirs = getDatabaseDirectories('primary');
      const orgDomain = path.join(primaryDirs.schemaDir, '05_organization');
      const sorted = topologicalSortDomainFiles(orgDomain, '05_organization');

      const orgIndex = sorted.findIndex((f) => f.createdTables.includes('organizations'));
      const memberIndex = sorted.findIndex((f) => f.createdTables.includes('organization_members'));

      expect(orgIndex).toBeGreaterThanOrEqual(0);
      expect(memberIndex).toBeGreaterThanOrEqual(0);
      expect(orgIndex).toBeLessThan(memberIndex);
    });

    it('orders plans before plan_prices and plan_feature_entitlements in 07_billing', () => {
      const primaryDirs = getDatabaseDirectories('primary');
      const billingDomain = path.join(primaryDirs.schemaDir, '07_billing');
      const sorted = topologicalSortDomainFiles(billingDomain, '07_billing');

      const plansIndex = sorted.findIndex((f) => f.createdTables.includes('plans'));
      const pricesIndex = sorted.findIndex((f) => f.createdTables.includes('plan_prices'));

      expect(plansIndex).toBeGreaterThanOrEqual(0);
      expect(pricesIndex).toBeGreaterThanOrEqual(0);
      expect(plansIndex).toBeLessThan(pricesIndex);
    });
  });

  describe('PrimaryDB Plan Generation', () => {
    it('generates complete PrimaryDB execution plan containing all 247 modular files', () => {
      const plan = buildDatabasePlan('primary', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'primary',
      });

      expect(plan.dbLabel).toBe('PrimaryDB');
      expect(plan.target).toBe('primary');
      expect(plan.files.length).toBe(247);
      expect(plan.schemaCount).toBe(223);
      expect(plan.triggerCount).toBe(11);
      expect(plan.seedCount).toBe(13);

      // Verify first file is extension
      expect(plan.files[0].relativePath).toBe('00_extensions/001_extensions.sql');
      // Verify types follow extensions
      expect(plan.files[1].relativePath).toBe('02_types/001_enums_and_domains.sql');

      // Verify triggers are deferred after schema files
      const triggers = plan.files.filter((f) => f.type === 'trigger');
      expect(triggers.length).toBe(11);
      for (const t of triggers) {
        expect(t.filename).toBe('999_triggers.sql');
        expect(t.step).toBeGreaterThan(plan.schemaCount);
      }

      // Verify seeds are at the end
      const seeds = plan.files.filter((f) => f.type === 'seed');
      expect(seeds.length).toBe(13);
      for (const s of seeds) {
        expect(s.step).toBeGreaterThan(plan.schemaCount + plan.triggerCount);
      }
    });

    it('respects --skip-seeds flag for PrimaryDB', () => {
      const plan = buildDatabasePlan('primary', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: true,
        target: 'primary',
      });

      expect(plan.seedCount).toBe(0);
      expect(plan.files.length).toBe(234); // 223 schema + 11 triggers
    });
  });

  describe('LogDB Plan Generation', () => {
    it('generates complete LogDB execution plan containing all 96 modular files', () => {
      const plan = buildDatabasePlan('logdb', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'logdb',
      });

      expect(plan.dbLabel).toBe('LogDB');
      expect(plan.target).toBe('logdb');
      expect(plan.files.length).toBe(96);
      expect(plan.schemaCount).toBe(90);
      expect(plan.triggerCount).toBe(5);
      expect(plan.seedCount).toBe(1);

      // First file is extensions
      expect(plan.files[0].relativePath).toBe('00_extensions/001_extensions.sql');
      // Types follow extensions
      expect(plan.files[1].relativePath).toBe('01_types/001_sequences.sql');
      expect(plan.files[2].relativePath).toBe('01_types/002_enums_and_domains.sql');

      // Triggers deferred
      const triggers = plan.files.filter((f) => f.type === 'trigger');
      expect(triggers.length).toBe(5);
      for (const t of triggers) {
        expect(t.filename).toBe('999_triggers.sql');
        expect(t.step).toBeGreaterThan(plan.schemaCount);
      }

      // Seed at the end
      const seeds = plan.files.filter((f) => f.type === 'seed');
      expect(seeds.length).toBe(1);
      expect(seeds[0].relativePath).toBe('seeds/000001_noop.sql');
    });

    it('respects --skip-seeds flag for LogDB', () => {
      const plan = buildDatabasePlan('logdb', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: true,
        target: 'logdb',
      });

      expect(plan.seedCount).toBe(0);
      expect(plan.files.length).toBe(95); // 90 schema + 5 triggers
    });
  });

  describe('CLI Arguments Parsing', () => {
    it('parses default options with no arguments', () => {
      const opts = parseCliOptions([]);
      expect(opts.dryRun).toBe(false);
      expect(opts.recreate).toBe(false);
      expect(opts.yes).toBe(false);
      expect(opts.skipSeeds).toBe(false);
      expect(opts.target).toBe('both');
    });

    it('parses --dry-run and --only primary', () => {
      const opts = parseCliOptions(['--dry-run', '--only', 'primary']);
      expect(opts.dryRun).toBe(true);
      expect(opts.target).toBe('primary');
    });

    it('parses --primary and --logdb flags', () => {
      expect(parseCliOptions(['--primary']).target).toBe('primary');
      expect(parseCliOptions(['--logdb']).target).toBe('logdb');
      expect(parseCliOptions(['--log']).target).toBe('logdb');
    });

    it('parses --recreate and --yes', () => {
      const opts = parseCliOptions(['--recreate', '--yes', '--skip-seeds']);
      expect(opts.recreate).toBe(true);
      expect(opts.yes).toBe(true);
      expect(opts.skipSeeds).toBe(true);
    });

    it('throws on invalid target', () => {
      expect(() => parseCliOptions(['--only', 'invalid_db'])).toThrow(
        'Expected --only to be one of: primary, logdb, both',
      );
    });

    it('throws on unknown argument', () => {
      expect(() => parseCliOptions(['--unknown-arg'])).toThrow('Unknown argument: --unknown-arg');
    });
  });

  describe('Dry Run Execution', () => {
    it('executes dry run for PrimaryDB without error', async () => {
      const plan = buildDatabasePlan('primary', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'primary',
      });

      const res = await executePlan(plan, {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'primary',
      });

      expect(res.totalExecuted).toBe(247);
    });

    it('executes dry run for LogDB without error', async () => {
      const plan = buildDatabasePlan('logdb', {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'logdb',
      });

      const res = await executePlan(plan, {
        dryRun: true,
        recreate: false,
        yes: false,
        skipSeeds: false,
        target: 'logdb',
      });

      expect(res.totalExecuted).toBe(96);
    });
  });
});
