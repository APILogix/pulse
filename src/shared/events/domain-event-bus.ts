import { EventEmitter } from 'events';

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    // Increase max listeners if needed
    this.setMaxListeners(50);
  }

  publish(eventName: string, payload: any): void {
    this.emit(eventName, payload);
  }
}

export const domainEventBus = new DomainEventBus();
