/**
 * Project module types and request schemas.
 * 
 * Re-exports everything from the bounded contexts to maintain backwards compatibility 
 * during the Phase 4 refactoring.
 */

export * from "./shared/schema-utils.js";
export * from "./core/project.types.js";
export * from "./environments/environment.types.js";
export * from "./api-keys/api-key.types.js";
export * from "./activity/activity.types.js";
export * from "./settings/settings.types.js";


