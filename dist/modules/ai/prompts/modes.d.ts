/**
 * AI module — mode-specific prompts (transcribed from masterprompt.md, v1).
 *
 * One entry per AI mode: trigger, goal, required input, "answer must include"
 * list, mode-specific rules, success criteria, and minimum confidence
 * threshold. Appended after the base system prompt by `buildSystemPrompt()`.
 */
import type { AIMode } from '../types.js';
export declare const MODE_PROMPTS: Record<AIMode, string>;
//# sourceMappingURL=modes.d.ts.map