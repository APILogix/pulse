export class InvalidAlertTransitionError extends Error {
    from;
    transition;
    actorType;
    code = 'INVALID_ALERT_TRANSITION';
    constructor(from, transition, actorType) {
        super(`Cannot ${transition} alert in state ${from} as ${actorType}`);
        this.from = from;
        this.transition = transition;
        this.actorType = actorType;
    }
}
const TRANSITIONS = {
    healthy: { evaluate_breach: 'pending', trigger: 'triggered', suppress: 'suppressed', recover: 'healthy' },
    pending: { trigger: 'triggered', recover: 'healthy', suppress: 'suppressed', expire: 'expired' },
    triggered: { trigger: 'triggered', evaluate_breach: 'triggered', acknowledge: 'acknowledged', escalate: 'escalated', mute: 'silenced', recover: 'resolved', suppress: 'suppressed', expire: 'expired' },
    firing: { trigger: 'firing', evaluate_breach: 'firing', acknowledge: 'acknowledged', escalate: 'escalated', mute: 'silenced', recover: 'resolved', suppress: 'suppressed', expire: 'expired' },
    acknowledged: { trigger: 'acknowledged', evaluate_breach: 'acknowledged', escalate: 'escalated', mute: 'silenced', recover: 'resolved', expire: 'expired', close: 'closed' },
    escalated: { trigger: 'escalated', evaluate_breach: 'escalated', acknowledge: 'acknowledged', mute: 'silenced', recover: 'resolved', expire: 'expired', close: 'closed' },
    silenced: { trigger: 'silenced', evaluate_breach: 'silenced', unsuppress: 'firing', recover: 'resolved', expire: 'expired', close: 'closed' },
    suppressed: { trigger: 'suppressed', evaluate_breach: 'suppressed', unsuppress: 'pending', recover: 'resolved', expire: 'expired', close: 'closed' },
    resolved: { trigger: 'triggered', recover: 'resolved', close: 'closed' },
    expired: { trigger: 'triggered', recover: 'resolved', close: 'closed' },
    closed: { trigger: 'triggered', recover: 'closed' },
    error: { trigger: 'triggered', recover: 'resolved', close: 'closed' },
};
const USER_TRANSITIONS = new Set([
    'acknowledge', 'mute', 'recover', 'close', 'unsuppress',
]);
const WORKER_TRANSITIONS = new Set([
    'evaluate_breach', 'trigger', 'acknowledge', 'escalate', 'mute', 'recover', 'expire', 'close', 'suppress', 'unsuppress',
]);
export function transitionAlert(state, transition, actorType) {
    if ((actorType === 'user' || actorType === 'api') && !USER_TRANSITIONS.has(transition)) {
        throw new InvalidAlertTransitionError(state, transition, actorType);
    }
    if ((actorType === 'worker' || actorType === 'system') && !WORKER_TRANSITIONS.has(transition)) {
        throw new InvalidAlertTransitionError(state, transition, actorType);
    }
    const next = TRANSITIONS[state]?.[transition];
    if (!next)
        throw new InvalidAlertTransitionError(state, transition, actorType);
    return next;
}
export function canTransition(state, transition, actorType) {
    try {
        transitionAlert(state, transition, actorType);
        return true;
    }
    catch {
        return false;
    }
}
export function transitionMatrix() {
    return TRANSITIONS;
}
//# sourceMappingURL=state-machine.js.map