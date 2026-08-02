export function compareThreshold(observedValue, operator, thresholdValue) {
    if (!Number.isFinite(observedValue) || !Number.isFinite(thresholdValue))
        return false;
    switch (operator) {
        case ">": return observedValue > thresholdValue;
        case ">=": return observedValue >= thresholdValue;
        case "<": return observedValue < thresholdValue;
        case "<=": return observedValue <= thresholdValue;
        case "=": return observedValue === thresholdValue;
        case "!=": return observedValue !== thresholdValue;
    }
}
/** Cooldown is active until, but not including, its exact expiry instant. */
export function isThresholdInCooldown(lastTriggeredAt, cooldownMinutes, evaluatedAt) {
    if (lastTriggeredAt === null || cooldownMinutes <= 0)
        return false;
    const expiry = lastTriggeredAt.getTime() + cooldownMinutes * 60_000;
    return Number.isFinite(expiry) && evaluatedAt.getTime() < expiry;
}
/**
 * Pure state transition for one metric observation. Persistence and delivery
 * are deliberately left to the caller.
 */
export function evaluateProjectThreshold(threshold, observedValue, previous, evaluatedAt) {
    if (!threshold.enabled) {
        return { action: "none", breached: false, shouldNotify: false, state: previous };
    }
    const breached = compareThreshold(observedValue, threshold.comparisonOperator, threshold.thresholdValue);
    if (!breached) {
        if (!previous.active) {
            return {
                action: "none",
                breached: false,
                shouldNotify: false,
                state: { ...previous, consecutiveBreaches: 0 },
            };
        }
        return {
            action: "recover",
            breached: false,
            shouldNotify: threshold.notifyOnRecovery,
            state: {
                consecutiveBreaches: 0,
                active: false,
                lastTriggeredAt: previous.lastTriggeredAt,
                lastRecoveredAt: evaluatedAt,
            },
        };
    }
    const requiredBreaches = Math.max(1, threshold.consecutiveBreaches);
    const consecutiveBreaches = Math.min(requiredBreaches, Math.max(0, previous.consecutiveBreaches) + 1);
    const breachedState = {
        ...previous,
        consecutiveBreaches,
    };
    if (previous.active || consecutiveBreaches < requiredBreaches) {
        return { action: "none", breached: true, shouldNotify: false, state: breachedState };
    }
    if (isThresholdInCooldown(previous.lastTriggeredAt, threshold.cooldownMinutes, evaluatedAt)) {
        return { action: "none", breached: true, shouldNotify: false, state: breachedState };
    }
    return {
        action: "trigger",
        breached: true,
        shouldNotify: true,
        state: {
            consecutiveBreaches,
            active: true,
            lastTriggeredAt: evaluatedAt,
            lastRecoveredAt: previous.lastRecoveredAt,
        },
    };
}
//# sourceMappingURL=threshold.evaluator.js.map