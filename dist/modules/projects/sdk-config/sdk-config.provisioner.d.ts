import type { PoolClient } from "pg";
import { type OrgPolicy, type TrustedTopology } from "./compiler.js";
/** Authoritative tenant scope for one environment's SDK configuration head. */
export interface SdkConfigProvisionScope {
    organizationId: string;
    projectId: string;
    environmentId: string;
    /** The environment slug becomes the compiled `sdk.environment` identity. */
    environmentKey: string;
}
export declare class SdkConfigProvisioner {
    private readonly orgPolicy?;
    private readonly clock;
    private readonly topology;
    constructor(topology?: TrustedTopology, orgPolicy?: ((scope: SdkConfigProvisionScope) => OrgPolicy | undefined) | undefined, clock?: () => string);
    /**
     * Provision the SDK configuration head + published revision #1 for a freshly
     * created environment, using the caller's transaction client. Throws if the
     * environment already owns a head (the unique constraint on environment_id is
     * the ultimate guard); callers create the environment in the same transaction
     * so a conflict indicates a logic error rather than a race.
     */
    provisionInitial(client: PoolClient, scope: SdkConfigProvisionScope, createdBy: string | null): Promise<{
        headId: string;
        revisionId: string;
        configHash: string;
    }>;
}
//# sourceMappingURL=sdk-config.provisioner.d.ts.map