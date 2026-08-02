/**
 * Email design tokens — Sentinel "Mono" theme.
 *
 * Mirrors `pulsiv_fe/src/app/index.css` → `[data-theme="mono"]` and
 * `pulsiv_fe/src/theme/theme-tokens.ts` → `SENTINEL_TOKENS.mono` exactly.
 * sentinel-design.md is the source of truth for every value below.
 *
 * ── Why hard-coded hex? ──────────────────────────────────────────────────
 * Email clients strip `<style>` blocks (Gmail Android/iOS partially, Outlook
 * desktop aggressively) and almost none resolve CSS custom properties inside
 * inline `style` attributes. Every colour therefore has to be a literal hex in
 * an inline style. This module is the single place those literals live, so the
 * mono palette stays in one spot instead of being smeared across templates.
 *
 * ── The three-channel law (sentinel-design.md §0) ────────────────────────
 *   brand = the product  → in Mono this is WHITE (#fafafa), never green.
 *   truth = the system   → green / red / amber / blue (theme-invariant).
 *   ai    = the model    → cyan #22d3ee, theme-invariant, model output ONLY.
 *
 * The previous email theme used green as the brand colour, which broke the law
 * (green is a verdict, not an identity). Brand is now white, and green is
 * reserved for "resolved / healthy / success" verdicts.
 */
export declare const palette: {
    readonly bg: "#09090b";
    readonly bg1: "#111113";
    readonly bg2: "#18181b";
    readonly bg3: "#232326";
    readonly border: "#26262a";
    readonly border2: "#3f3f46";
    readonly text: "#fafafa";
    readonly text2: "#a1a1aa";
    readonly text3: "#8a8a94";
    readonly brand: "#fafafa";
    readonly brandD: "#e4e4e7";
    readonly brandFg: "#09090b";
    readonly ai: "#22d3ee";
    readonly aiD: "#06b6d4";
    readonly aiFg: "#032a33";
    readonly green: "#34d399";
    readonly greenD: "#10b981";
    readonly red: "#ef4444";
    readonly redD: "#dc2626";
    readonly amber: "#f59e0b";
    readonly blue: "#60a5fa";
    readonly violet: "#a78bfa";
};
/**
 * Opaque tint surfaces.
 *
 * The app uses `rgba(...)` tints (e.g. `--red-bg: rgba(239,68,68,0.08)`), but
 * `rgba()` over a parent background is unreliable in Outlook (it flattens to
 * black) and in dark-mode-inverting clients. These are the same tints
 * pre-composited over `--bg1` (#111113) as flat hex, so they render identically
 * everywhere.
 */
export declare const tint: {
    readonly brand: "#1d1d20";
    readonly ai: "#132a30";
    readonly green: "#152420";
    readonly red: "#1e1517";
    readonly amber: "#1e1a15";
    readonly blue: "#161c26";
    readonly violet: "#1b1a24";
    readonly neutral: "#18181b";
};
/** Borders for tinted chips/callouts — the accent at ~30% over #111113. */
export declare const tintBorder: {
    readonly brand: "#3f3f42";
    readonly ai: "#1c4954";
    readonly green: "#1d4237";
    readonly red: "#3f2124";
    readonly amber: "#3f2f14";
    readonly blue: "#25334a";
    readonly violet: "#2f2b41";
    readonly neutral: "#26262a";
};
/**
 * Font stacks. Web fonts are linked in the head for clients that honour them
 * (Apple Mail, iOS Mail, Samsung Mail, Thunderbird); everything else falls back
 * down the stack. Outlook desktop always lands on the final generic family, so
 * every stack ends in a metric-safe websafe font.
 */
export declare const font: {
    /** Space Grotesk — display only: titles, big human-facing numbers. */
    readonly display: "'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    /** Inter — all UI text, body copy, buttons, labels. */
    readonly sans: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    /** JetBrains Mono — IDs, metrics, timestamps, eyebrows, status badges. */
    readonly mono: "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace";
};
/** Type scale in px (§4). Kept as numbers so callers can compose `${n}px`. */
export declare const size: {
    readonly title: 24;
    readonly titleSm: 20;
    readonly metric: 30;
    readonly cardTitle: 15;
    readonly subHeading: 14;
    readonly body: 14;
    readonly ui: 13;
    readonly monoData: 12;
    readonly eyebrow: 11;
    readonly micro: 10;
};
export declare const radius: {
    readonly sm: "4px";
    readonly md: "6px";
    readonly lg: "10px";
    readonly pill: "100px";
};
export declare const layout: {
    /** Outer email width. 620px keeps the focus rail readable on desktop. */
    readonly width: 620;
    /** Card internal padding (§5.2: 16–24px). */
    readonly pad: 32;
    readonly padMobile: 22;
};
/**
 * Modal-grade elevation (§6). Shadows are functional, not decorative — the card
 * gets a hairline border AND a soft lift so it separates from the page canvas
 * in clients that render box-shadow (Apple Mail, iOS, Thunderbird).
 */
export declare const shadow: {
    readonly card: "0 24px 60px rgba(0,0,0,0.7)";
};
/**
 * A tone is one lane of the three-channel law, packaged for a component.
 *   `brand`   — the product is speaking (neutral/informational actions)
 *   `ai`      — a model produced this (cyan, rationed to model output)
 *   `success` — a verdict: healthy / resolved
 *   `danger`  — a verdict: firing / error / 5xx
 *   `warning` — a verdict: degraded / 4xx / attention
 *   `info`    — a verdict: informational / 3xx
 */
export type Tone = 'brand' | 'ai' | 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export interface ToneStyle {
    /** Saturated foreground — text and glyphs. */
    fg: string;
    /** Flat tint background, pre-composited over --bg1. */
    bg: string;
    /** Hairline border for the tinted surface. */
    border: string;
    /** Text colour to use ON a solid `fg` fill. */
    on: string;
}
export declare const tones: Record<Tone, ToneStyle>;
export declare function toneStyle(tone: Tone): ToneStyle;
/** Mirrors `AlertSeveritySchema` in `src/modules/alerting/common.ts`. */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export declare function severityTone(severity: AlertSeverity): Tone;
export declare function severityGlyph(severity: AlertSeverity): string;
//# sourceMappingURL=theme.d.ts.map