import { describe, expect, it } from 'vitest';
import {
  InvalidAlertTransitionError,
  canTransition,
  transitionAlert,
} from '../../src/modules/alerting/decision/state-machine.js';

describe('alert lifecycle state machine', () => {
  it('enforces the normal lifecycle without shortcuts', () => {
    expect(transitionAlert('healthy', 'evaluate_breach', 'worker')).toBe('pending');
    expect(transitionAlert('pending', 'trigger', 'worker')).toBe('triggered');
    expect(transitionAlert('triggered', 'acknowledge', 'user')).toBe('acknowledged');
    expect(transitionAlert('acknowledged', 'escalate', 'worker')).toBe('escalated');
    expect(transitionAlert('escalated', 'recover', 'worker')).toBe('resolved');
    expect(transitionAlert('resolved', 'close', 'user')).toBe('closed');
  });

  it('rejects invalid shortcuts and unauthorized actors', () => {
    expect(() => transitionAlert('healthy', 'close', 'user')).toThrow(InvalidAlertTransitionError);
    expect(() => transitionAlert('triggered', 'trigger', 'worker')).toThrow(InvalidAlertTransitionError);
    expect(() => transitionAlert('triggered', 'escalate', 'user')).toThrow(InvalidAlertTransitionError);
    expect(canTransition('closed', 'recover', 'worker')).toBe(false);
  });
});
