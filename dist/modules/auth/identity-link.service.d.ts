import { type LinkableProvider } from './identity-link.config.js';
import * as repository from './repository.js';
export declare function startIdentityLink(userId: string, provider: string, ipAddress: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function completeIdentityLink(callbackUrl: string, ipAddress: string, requestId: string): Promise<{
    provider: LinkableProvider;
    linked: true;
}>;
export declare function listUserLinkedIdentities(userId: string): Promise<{
    id: string;
    provider: repository.LinkedIdentityProvider;
    provider_email: string | null;
    linked_at: Date;
    last_used_at: Date | null;
}[]>;
export declare function unlinkIdentity(userId: string, linkId: string, ipAddress: string, requestId: string): Promise<void>;
//# sourceMappingURL=identity-link.service.d.ts.map