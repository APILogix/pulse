import type { AlertStateValue } from '../runtime/alert-runtime.repository.js';
export type AlertLifecycleState = AlertStateValue | 'healthy' | 'triggered' | 'escalated' | 'closed';
export type AlertActorType = 'user' | 'system' | 'worker' | 'api';
export type AlertTransition = 'evaluate_breach' | 'trigger' | 'acknowledge' | 'escalate' | 'mute' | 'recover' | 'expire' | 'close' | 'suppress' | 'unsuppress';
export declare class InvalidAlertTransitionError extends Error {
    readonly from: AlertLifecycleState;
    readonly transition: AlertTransition;
    readonly actorType: AlertActorType;
    readonly code = "INVALID_ALERT_TRANSITION";
    constructor(from: AlertLifecycleState, transition: AlertTransition, actorType: AlertActorType);
}
declare const TRANSITIONS: Readonly<Record<AlertLifecycleState, Partial<Record<AlertTransition, AlertLifecycleState>>>>;
export declare function transitionAlert(state: AlertLifecycleState, transition: AlertTransition, actorType: AlertActorType): AlertLifecycleState;
export declare function canTransition(state: AlertLifecycleState, transition: AlertTransition, actorType: AlertActorType): boolean;
export declare function transitionMatrix(): Readonly<typeof TRANSITIONS>;
export {};
//# sourceMappingURL=state-machine.d.ts.map