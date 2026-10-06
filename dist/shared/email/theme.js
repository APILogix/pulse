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
/* ════════════════════════════════════════════════════════════════════════
   PALETTE — [data-theme="mono"]
   ════════════════════════════════════════════════════════════════════════ */
export const palette = {
    /* neutrals — pure cool zinc, zero blue cast */
    bg: '#09090b',
    bg1: '#111113',
    bg2: '#18181b',
    bg3: '#232326',
    border: '#26262a',
    border2: '#3f3f46',
    text: '#fafafa',
    text2: '#a1a1aa',
    text3: '#8a8a94',
    /* brand — identity channel becomes white in Mono */
    brand: '#fafafa',
    brandD: '#e4e4e7',
    brandFg: '#09090b',
    /* ai — model channel, never changes between themes */
    ai: '#22d3ee',
    aiD: '#06b6d4',
    aiFg: '#032a33',
    /* truth channel — never changes between themes */
    green: '#34d399',
    greenD: '#10b981',
    red: '#ef4444',
    redD: '#dc2626',
    amber: '#f59e0b',
    blue: '#60a5fa',
    violet: '#a78bfa',
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
export const tint = {
    brand: '#1d1d20', // rgba(250,250,250,0.08) over #111113
    ai: '#132a30', // rgba(34,211,238,0.10) over #111113
    green: '#152420', // rgba(52,211,153,0.08) over #111113
    red: '#1e1517', // rgba(239,68,68,0.08)  over #111113
    amber: '#1e1a15', // rgba(245,158,11,0.08) over #111113
    blue: '#161c26', // rgba(96,165,250,0.10) over #111113
    violet: '#1b1a24', // rgba(167,139,250,0.10) over #111113
    neutral: '#18181b', // --bg2
};
/** Hairlines for tinted surfaces — the accent at ~30% over #111113. */
export const tintBorder = {
    brand: '#3f3f42',
    ai: '#1c4954',
    green: '#1d4237',
    red: '#3f2124',
    amber: '#3f2f14',
    blue: '#25334a',
    violet: '#2f2b41',
    neutral: '#3f3f46', // --border2: the neutral callout hairline in the app
};
/* ════════════════════════════════════════════════════════════════════════
   TYPOGRAPHY — three families, strict roles, sentence case everywhere
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Font stacks, in the same roles the console gives them.
 *
 * Web fonts are linked in the head for clients that honour them (Apple Mail,
 * iOS Mail, Samsung Mail, Thunderbird); everything else walks down the stack.
 * Outlook desktop never sees the web-font link (it sits in an `[if !mso]`
 * branch), so it resolves the first installed family — Segoe UI and Consolas
 * on Windows — instead of falling back to Times New Roman.
 */
export const font = {
    /** Space Grotesk — the brand voice only: wordmark and monogram. */
    display: "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    /** Inter — every heading, sentence, label and control. */
    sans: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    /** JetBrains Mono — measurements, identifiers, codes, timestamps, URLs. Never prose. */
    mono: "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace",
};
/** Type scale in px. Kept as numbers so callers can compose `${n}px`. */
export const size = {
    /** Headline — AuthHeading: Inter 600, -0.03em. */
    title: 28,
    titleSm: 24,
    /** The peak number of an alert: the observed value in a two-cell readout. */
    readout: 34,
    /** 26px keeps "1,842 ms" on one line in a half-width cell at 360px. */
    readoutSm: 26,
    /** Readout cells when three or more share the band (dashboards: 24–26px). */
    metric: 26,
    metricSm: 22,
    /** One-time code — CodeInput's mono treatment, scaled for a glance. */
    otp: 34,
    otpSm: 28,
    /** Section heading — a real 14px semibold heading, never an uppercase label. */
    section: 14,
    /** Body copy. */
    body: 14,
    /** Buttons, callout copy, list titles. */
    ui: 13,
    /** Fact values (AuthFact mono is 13px). */
    data: 13,
    /** Sentence-case labels, notes and footer copy. */
    label: 12,
    /** Status pill — 11px sentence case. */
    micro: 11,
    /** Wordmark in the header strip. */
    wordmark: 15,
};
/* ════════════════════════════════════════════════════════════════════════
   RADII, LAYOUT
   ════════════════════════════════════════════════════════════════════════ */
export const radius = {
    sm: '4px', // status pills, method tags
    md: '6px', // --radius: buttons, callouts, code wells
    lg: '10px', // --radius-lg: the sheet, the code display, AI insight
    /** Status pills are 4px in the console, not capsules. */
    pill: '4px',
};
export const layout = {
    /** Outer email width. Outlook is pinned to this in an `[if mso]` table. */
    width: 620,
    /**
     * Sheet gutter. 40px leaves a 540px measure — about 75 characters of 14px
     * Inter, the top of the comfortable reading range.
     */
    pad: 40,
    padMobile: 22,
};
export const tones = {
    brand: { fg: palette.brand, bg: tint.brand, border: tintBorder.brand, on: palette.brandFg },
    ai: { fg: palette.ai, bg: tint.ai, border: tintBorder.ai, on: palette.aiFg },
    success: { fg: palette.green, bg: tint.green, border: tintBorder.green, on: palette.brandFg },
    danger: { fg: palette.red, bg: tint.red, border: tintBorder.red, on: '#ffffff' },
    warning: { fg: palette.amber, bg: tint.amber, border: tintBorder.amber, on: palette.brandFg },
    info: { fg: palette.blue, bg: tint.blue, border: tintBorder.blue, on: palette.brandFg },
    neutral: { fg: palette.text2, bg: tint.neutral, border: tintBorder.neutral, on: palette.brandFg },
};
export function toneStyle(tone) {
    return tones[tone];
}
const SEVERITY_TONE = {
    info: 'info',
    warning: 'warning',
    error: 'danger',
    critical: 'danger',
};
export function severityTone(severity) {
    return SEVERITY_TONE[severity];
}
/**
 * Severity glyph, kept for plaintext-adjacent callers and one-off surfaces.
 *
 * The HTML shell no longer draws glyphs: severity is carried by the state
 * line's drawn status dot and its label, which survive every client without
 * leaning on a font's symbol coverage.
 */
const SEVERITY_GLYPH = {
    info: '&#9679;', // ● black circle
    warning: '!',
    error: '&#215;', // × multiplication sign
    critical: '&#9650;', // ▲ black up-pointing triangle
};
export function severityGlyph(severity) {
    return SEVERITY_GLYPH[severity];
}
//# sourceMappingURL=theme.js.map