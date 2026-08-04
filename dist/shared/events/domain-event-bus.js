import { EventEmitter } from 'events';
class DomainEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
    }
    publish(eventName, payload) {
        this.emit(eventName, payload);
    }
    on(eventName, listener) {
        return super.on(eventName, listener);
    }
}
export const domainEventBus = new DomainEventBus();
//# sourceMappingURL=domain-event-bus.js.map