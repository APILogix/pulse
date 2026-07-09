export function createBillingLogger(context: string) {
  return {
    info: (message: string, ...args: any[]) => console.log(`[Billing:${context}] ${message}`, ...args),
    error: (message: string, error?: any, ...args: any[]) => console.error(`[Billing:${context}] ${message}`, error, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[Billing:${context}] ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.debug(`[Billing:${context}] ${message}`, ...args),
  };
}
