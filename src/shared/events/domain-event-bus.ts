import { EventEmitter } from 'events';

export interface DomainEvents {
  ErrorGroupCreated: { errorGroupId: string; projectId: string; organizationId: string; fingerprint: string; eventId: string };
  ErrorOccurred: { errorGroupId: string; projectId: string; organizationId: string; fingerprint: string; eventId: string };
  ErrorRegressed: { errorGroupId: string; projectId: string; organizationId?: string; fingerprint?: string; eventId?: string };
  ErrorResolved: { projectId: string; groupId: string; actorId?: string };
  ErrorIgnored: { projectId: string; groupId: string; actorId?: string };
  ErrorReopened: { projectId: string; groupId: string; actorId?: string };
  ErrorArchived: { projectId: string; groupId: string; actorId?: string };
  ErrorRestored: { projectId: string; groupId: string; actorId?: string };
  ErrorAssigned: { projectId: string; groupId: string; assigneeId: string; actorId?: string };
  ErrorUnassigned: { projectId: string; groupId: string; actorId?: string };
  ErrorMuted: { projectId: string; groupId: string; actorId?: string };
  ErrorUnmuted: { projectId: string; groupId: string; actorId?: string };
}

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish<K extends keyof DomainEvents>(eventName: K, payload: DomainEvents[K]): void {
    this.emit(eventName, payload);
  }

  on<K extends keyof DomainEvents>(eventName: K, listener: (payload: DomainEvents[K]) => void): this {
    return super.on(eventName, listener);
  }
}

export const domainEventBus = new DomainEventBus();
