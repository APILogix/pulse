/**
 * Email design tokens — Sentinel "Mono" theme.
 *
 * Mirrors `pulsiv_fe/src/app/index.css` → `[data-theme="mono"]` and the
 * surface records in `pulsiv_fe/design/` (auth, dashboards, observe). Those are
 * the source of truth for every value below.
 *
 * ── Why hard-coded hex? ──────────────────────────────────────────────────
 * Email clients strip `<style>` blocks (Gmail Android/iOS partially, Outlook
 * desktop aggressively) and almost none resolve CSS custom properties inside
 * inline `style` attributes. Every colour therefore has to be a literal hex in
 * an inline style. This module is the single place those literals live, so the
 * mono palette stays in one spot instead of being smeared across templates.
 *
 * ── The three-channel law ────────────────────────────────────────────────
 *   brand = the product  → in Mono this is WHITE (#fafafa), never green.
 *   truth = the system   → green / red / amber / blue (theme-invariant).
 *   ai    = the model    → cyan #22d3ee, theme-invariant, model output ONLY.
 *
 * Colour never decorates chrome. A tone appears on a verdict (the state line,
 * a readout value, a callout's hairline), never on a control: every action is
 * white except a destructive one, which is red.
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
/** Hairlines for tinted surfaces — the accent at ~30% over #111113. */
export declare const tintBorder: {
    readonly brand: "#3f3f42";
    readonly ai: "#1c4954";
    readonly green: "#1d4237";
    readonly red: "#3f2124";
    readonly amber: "#3f2f14";
    readonly blue: "#25334a";
    readonly violet: "#2f2b41";
    readonly neutral: "#3f3f46";
};
/**
 * Font stacks, in the same roles the console gives them.
 *
 * Web fonts are linked in the head for clients that honour them (Apple Mail,
 * iOS Mail, Samsung Mail, Thunderbird); everything else walks down the stack.
 * Outlook desktop never sees the web-font link (it sits in an `[if !mso]`
 * branch), so it resolves the first installed family — Segoe UI and Consolas
 * on Windows — instead of falling back to Times New Roman.
 */
export declare const font: {
    /** Space Grotesk — the brand voice only: wordmark and monogram. */
    readonly display: "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    /** Inter — every heading, sentence, label and control. */
    readonly sans: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    /** JetBrains Mono — measurements, identifiers, codes, timestamps, URLs. Never prose. */
    readonly mono: "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace";
};
/** Type scale in px. Kept as numbers so callers can compose `${n}px`. */
export declare const size: {
    /** Headline — AuthHeading: Inter 600, -0.03em. */
    readonly title: 28;
    readonly titleSm: 24;
    /** The peak number of an alert: the observed value in a two-cell readout. */
    readonly readout: 34;
    /** 26px keeps "1,842 ms" on one line in a half-width cell at 360px. */
    readonly readoutSm: 26;
    /** Readout cells when three or more share the band (dashboards: 24–26px). */
    readonly metric: 26;
    readonly metricSm: 22;
    /** One-time code — CodeInput's mono treatment, scaled for a glance. */
    readonly otp: 34;
    readonly otpSm: 28;
    /** Section heading — a real 14px semibold heading, never an uppercase label. */
    readonly section: 14;
    /** Body copy. */
    readonly body: 14;
    /** Buttons, callout copy, list titles. */
    readonly ui: 13;
    /** Fact values (AuthFact mono is 13px). */
    readonly data: 13;
    /** Sentence-case labels, notes and footer copy. */
    readonly label: 12;
    /** Status pill — 11px sentence case. */
    readonly micro: 11;
    /** Wordmark in the header strip. */
    readonly wordmark: 15;
};
export declare const radius: {
    readonly sm: "4px";
    readonly md: "6px";
    readonly lg: "10px";
    /** Status pills are 4px in the console, not capsules. */
    readonly pill: "4px";
};
export declare const layout: {
    /** Outer email width. Outlook is pinned to this in an `[if mso]` table. */
    readonly width: 620;
    /**
     * Sheet gutter. 40px leaves a 540px measure — about 75 characters of 14px
     * Inter, the top of the comfortable reading range.
     */
    readonly pad: 40;
    readonly padMobile: 22;
};
/**
 * A tone is one lane of the three-channel law, packaged for a component.
 *   `brand`   — the product is speaking (neutral/informational)
 *   `ai`      — a model produced this (cyan, rationed to model output)
 *   `success` — a verdict: healthy / resolved
 *   `danger`  — a verdict: firing / error / 5xx
 *   `warning` — a verdict: degraded / 4xx / attention
 *   `info`    — a verdict: informational / 3xx
 */
export type Tone = 'brand' | 'ai' | 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export interface ToneStyle {
    /** Saturated foreground — text and marks. */
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