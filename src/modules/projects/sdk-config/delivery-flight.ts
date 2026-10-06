import { SdkConfigError } from "./errors.js";

/** Share active lookups only. No credential/config TTL or stale policy is introduced. */
export class DeliveryFlight<T> {
  private readonly active = new Map<string, { promise: Promise<T>; waiters: number }>();

  constructor(
    private readonly maxActive = 256,
    private readonly maxWaiters = 1024,
    private readonly defaultDeadlineMs = 1250,
  ) {}

  async run(key: string, load: () => Promise<T>, deadlineAt = Date.now() + this.defaultDeadlineMs): Promise<T> {
    if (deadlineAt <= Date.now()) {
      throw new SdkConfigError("unavailable", "Configuration lookup deadline exceeded", 503);
    }
    let flight = this.active.get(key);
    if (!flight) {
      if (this.active.size >= this.maxActive) {
        throw new SdkConfigError("unavailable", "Configuration lookup capacity reached", 503);
      }
      flight = { promise: Promise.resolve().then(load), waiters: 0 };
      this.active.set(key, flight);
      // Retain the slot until the actual work settles, even if clients disconnect.
      const release = () => { this.active.delete(key); };
      void flight.promise.then(release, release);
    }
    if (flight.waiters >= this.maxWaiters) {
      throw new SdkConfigError("unavailable", "Configuration lookup capacity reached", 503);
    }
    flight.waiters++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        flight.promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new SdkConfigError("unavailable", "Configuration lookup deadline exceeded", 503)),
            Math.max(1, deadlineAt - Date.now()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      flight.waiters--;
    }
  }
}
