import type { AlertStateValue } from '../runtime/alert-runtime.repository.js';

export type AlertLifecycleState = AlertStateValue | 'healthy' | 'triggered' | 'escalated' | 'closed';
export type AlertActorType = 'user' | 'system' | 'worker' | 'api';
export type AlertTransition =
  | 'evaluate_breach'
  | 'trigger'
  | 'acknowledge'
  | 'escalate'
  | 'mute'
  | 'recover'
  | 'expire'
  | 'close'
  | 'suppress'
  | 'unsuppress';

export class InvalidAlertTransitionError extends Error {
  readonly code = 'INVALID_ALERT_TRANSITION';

  constructor(
    readonly from: AlertLifecycleState,
    readonly transition: AlertTransition,
    readonly actorType: AlertActorType,
  ) {
    super(`Cannot ${transition} alert in state ${from} as ${actorType}`);
  }
}

const TRANSITIONS: Readonly<Record<AlertLifecycleState, Partial<Record<AlertTransition, AlertLifecycleState>>>> = {
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

const USER_TRANSITIONS = new Set<AlertTransition>([
  'acknowledge', 'mute', 'recover', 'close', 'unsuppress',
]);
const WORKER_TRANSITIONS = new Set<AlertTransition>([
  'evaluate_breach', 'trigger', 'acknowledge', 'escalate', 'mute', 'recover', 'expire', 'close', 'suppress', 'unsuppress',
]);

export function transitionAlert(
  state: AlertLifecycleState,
  transition: AlertTransition,
  actorType: AlertActorType,
): AlertLifecycleState {
  if ((actorType === 'user' || actorType === 'api') && !USER_TRANSITIONS.has(transition)) {
    throw new InvalidAlertTransitionError(state, transition, actorType);
  }
  if ((actorType === 'worker' || actorType === 'system') && !WORKER_TRANSITIONS.has(transition)) {
    throw new InvalidAlertTransitionError(state, transition, actorType);
  }
  const next = TRANSITIONS[state]?.[transition];
  if (!next) throw new InvalidAlertTransitionError(state, transition, actorType);
  return next;
}

export function canTransition(
  state: AlertLifecycleState,
  transition: AlertTransition,
  actorType: AlertActorType,
): boolean {
  try {
    transitionAlert(state, transition, actorType);
    return true;
  } catch {
    return false;
  }
}

export function transitionMatrix(): Readonly<typeof TRANSITIONS> {
  return TRANSITIONS;
}
