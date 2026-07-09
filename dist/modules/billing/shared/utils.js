export function createBillingLogger(context) {
    return {
        info: (message, ...args) => console.log(`[Billing:${context}] ${message}`, ...args),
        error: (message, error, ...args) => console.error(`[Billing:${context}] ${message}`, error, ...args),
        warn: (message, ...args) => console.warn(`[Billing:${context}] ${message}`, ...args),
        debug: (message, ...args) => console.debug(`[Billing:${context}] ${message}`, ...args),
    };
}
//# sourceMappingURL=utils.js.map