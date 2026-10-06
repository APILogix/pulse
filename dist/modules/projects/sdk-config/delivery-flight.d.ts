/** Share active lookups only. No credential/config TTL or stale policy is introduced. */
export declare class DeliveryFlight<T> {
    private readonly maxActive;
    private readonly maxWaiters;
    private readonly defaultDeadlineMs;
    private readonly active;
    constructor(maxActive?: number, maxWaiters?: number, defaultDeadlineMs?: number);
    run(key: string, load: () => Promise<T>, deadlineAt?: number): Promise<T>;
}
//# sourceMappingURL=delivery-flight.d.ts.map