/**
 * SdkConfigProvisioner — service-layer, transaction-bound SDK config bootstrap.
 *
 * Every environment owns exactly one SDK configuration head and an immutable
 * chain of revisions. Provisioning is performed EXPLICITLY inside the caller's
 * database transaction (no PostgreSQL trigger) so that creating an environment
 * and seeding its published revision #1 are one atomic unit.
 *
 * The compiled schema-v1 snapshot is produced by the deterministic core
 * compiler (`compileInitial`) so the environment is immediately usable by the
 * SDK without any manual configuration:
 *   - requested_config  = {}                (empty editable intent)
 *   - compiled_snapshot = compileInitial()  (complete, valid schema-v1 doc)
 *   - config_hash       = compiled.meta.configHash
 *   - revision_number   = 1, change_type = 'initial'
 *
 * NOTE on ordering: `project_environment_sdk_configs.published_revision_id` is
 * NOT NULL with a DEFERRABLE INITIALLY DEFERRED foreign key to the revisions
 * table. We therefore mint both UUIDs up front and insert the head row FIRST
 * (pointing at the revision id), then insert the revision. The deferred FK is
 * validated at COMMIT, keeping the whole unit atomic and orphan-free.
 */
import { v7 as uuidv7 } from "uuid";
import type { PoolClient } from "pg";
import { env } from "../../../config/env.js";
import { compileInitial, type OrgPolicy, type TrustedTopology } from "./compiler.js";
import { validateSchemaV1 } from "./validator.js";

/** Authoritative tenant scope for one environment's SDK configuration head. */
export interface SdkConfigProvisionScope {
  organizationId: string;
  projectId: string;
  environmentId: string;
  /** The environment slug becomes the compiled `sdk.environment` identity. */
  environmentKey: string;
}

/** Trusted ingest origin used to derive protected route URLs during compilation. */
function defaultTopology(): TrustedTopology {
  return { ingestBaseUrl: env.BACKEND_URL };
}

export class SdkConfigProvisioner {
  private readonly topology: TrustedTopology;

  constructor(
    topology?: TrustedTopology,
    private readonly orgPolicy?: (scope: SdkConfigProvisionScope) => OrgPolicy | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.topology = topology ?? defaultTopology();
  }

  /**
   * Provision the SDK configuration head + published revision #1 for a freshly
   * created environment, using the caller's transaction client. Throws if the
   * environment already owns a head (the unique constraint on environment_id is
   * the ultimate guard); callers create the environment in the same transaction
   * so a conflict indicates a logic error rather than a race.
   */
  async provisionInitial(
    client: PoolClient,
    scope: SdkConfigProvisionScope,
    createdBy: string | null,
  ): Promise<{ headId: string; revisionId: string; configHash: string }> {
    const policy = this.orgPolicy ? this.orgPolicy(scope) : undefined;
    const compiled = compileInitial(
      { projectId: scope.projectId, environment: scope.environmentKey },
      this.topology,
      this.clock(),
      policy,
    );
    validateSchemaV1(compiled);
    const configHash = compiled.meta.configHash ?? "";
    const schemaVersion = String(compiled.schemaVersion);

    const headId = uuidv7();
    const revisionId = uuidv7();

    // Head first (published_revision_id is NOT NULL); the FK to the revision is
    // deferred, so pointing at a not-yet-inserted revision id is legal until COMMIT.
    await client.query(
      `INSERT INTO project_environment_sdk_configs(
         id, organization_id, project_id, environment_id, published_revision_id,
         current_revision, current_hash, schema_version, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$8)`,
      [
        headId,
        scope.organizationId,
        scope.projectId,
        scope.environmentId,
        revisionId,
        configHash,
        schemaVersion,
        createdBy,
      ],
    );

    await client.query(
      `INSERT INTO project_environment_sdk_config_revisions(
         id, config_id, organization_id, project_id, environment_id, revision_number,
         requested_config, compiled_snapshot, config_hash,
         schema_version, change_type, change_summary, published_by
       ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'initial',$10,$11)`,
      [
        revisionId,
        headId,
        scope.organizationId,
        scope.projectId,
        scope.environmentId,
        JSON.stringify({}),
        JSON.stringify(compiled),
        configHash,
        schemaVersion,
        "Initial compiled schema-v1 SDK configuration",
        createdBy,
      ],
    );

    return { headId, revisionId, configHash };
  }
}
