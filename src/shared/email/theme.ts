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

/* ════════════════════════════════════════════════════════════════════════
   PALETTE — [data-theme="mono"]
   ════════════════════════════════════════════════════════════════════════ */

export const palette = {
  /* neutrals — pure cool zinc, zero blue cast (§2.1) */
  bg: '#09090b',
  bg1: '#111113',
  bg2: '#18181b',
  bg3: '#232326',
  border: '#26262a',
  border2: '#3f3f46',
  text: '#fafafa',
  text2: '#a1a1aa',
  text3: '#8a8a94',

  /* brand — identity channel becomes white in Mono (§2.3) */
  brand: '#fafafa',
  brandD: '#e4e4e7',
  brandFg: '#09090b',

  /* ai — model channel, never changes between themes (§2.4) */
  ai: '#22d3ee',
  aiD: '#06b6d4',
  aiFg: '#032a33',

  /* truth channel — never changes between themes (§2.2) */
  green: '#34d399',
  greenD: '#10b981',
  red: '#ef4444',
  redD: '#dc2626',
  amber: '#f59e0b',
  blue: '#60a5fa',
  violet: '#a78bfa',
} as const;

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
} as const;

/** Borders for tinted chips/callouts — the accent at ~30% over #111113. */
export const tintBorder = {
  brand: '#3f3f42',
  ai: '#1c4954',
  green: '#1d4237',
  red: '#3f2124',
  amber: '#3f2f14',
  blue: '#25334a',
  violet: '#2f2b41',
  neutral: '#26262a',
} as const;

/* ════════════════════════════════════════════════════════════════════════
   TYPOGRAPHY (§4) — three families, strict roles, sentence case everywhere
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Font stacks. Web fonts are linked in the head for clients that honour them
 * (Apple Mail, iOS Mail, Samsung Mail, Thunderbird); everything else falls back
 * down the stack. Outlook desktop always lands on the final generic family, so
 * every stack ends in a metric-safe websafe font.
 */
export const font = {
  /** Space Grotesk — display only: titles, big human-facing numbers. */
  display: "'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  /** Inter — all UI text, body copy, buttons, labels. */
  sans: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  /** JetBrains Mono — IDs, metrics, timestamps, eyebrows, status badges. */
  mono: "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace",
} as const;

/** Type scale in px (§4). Kept as numbers so callers can compose `${n}px`. */
export const size = {
  title: 24, // page title — Space Grotesk 600, -0.02em
  titleSm: 20, // long titles on narrow screens
  metric: 30, // page metric — JetBrains Mono 500
  cardTitle: 15, // panel / card title — Inter 600
  subHeading: 14, // section sub-heading — Inter 500
  body: 14, // body copy — Inter 400
  ui: 13, // buttons, table cells — Inter 400/500
  monoData: 12, // IDs, log lines, code — JetBrains Mono
  eyebrow: 11, // mono uppercase label, 0.1em tracking
  micro: 10, // severity badges, footer meta
} as const;

/* ════════════════════════════════════════════════════════════════════════
   RADII, BORDERS, SHADOW, SPACING (§5, §6)
   ════════════════════════════════════════════════════════════════════════ */

export const radius = {
  sm: '4px',
  md: '6px', // --radius: buttons, inputs, badges, small cards
  lg: '10px', // --radius-lg: cards, panels, modals
  pill: '100px', // status pills, eyebrows
} as const;

export const layout = {
  /** Outer email width. 620px keeps the focus rail readable on desktop. */
  width: 620,
  /** Card internal padding (§5.2: 16–24px). */
  pad: 32,
  padMobile: 22,
} as const;

/**
 * Modal-grade elevation (§6). Shadows are functional, not decorative — the card
 * gets a hairline border AND a soft lift so it separates from the page canvas
 * in clients that render box-shadow (Apple Mail, iOS, Thunderbird).
 */
export const shadow = {
  card: '0 24px 60px rgba(0,0,0,0.7)',
} as const;

/* ════════════════════════════════════════════════════════════════════════
   TONES — the truth channel, resolved into a usable bundle
   ════════════════════════════════════════════════════════════════════════ */

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

export const tones: Record<Tone, ToneStyle> = {
  brand: { fg: palette.brand, bg: tint.brand, border: tintBorder.brand, on: palette.brandFg },
  ai: { fg: palette.ai, bg: tint.ai, border: tintBorder.ai, on: palette.aiFg },
  success: { fg: palette.green, bg: tint.green, border: tintBorder.green, on: palette.brandFg },
  danger: { fg: palette.red, bg: tint.red, border: tintBorder.red, on: '#ffffff' },
  warning: { fg: palette.amber, bg: tint.amber, border: tintBorder.amber, on: palette.brandFg },
  info: { fg: palette.blue, bg: tint.blue, border: tintBorder.blue, on: palette.brandFg },
  neutral: { fg: palette.text2, bg: tint.neutral, border: tintBorder.neutral, on: palette.brandFg },
};

export function toneStyle(tone: Tone): ToneStyle {
  return tones[tone];
}

/* ════════════════════════════════════════════════════════════════════════
   ALERT SEVERITY → TONE
   ════════════════════════════════════════════════════════════════════════ */

/** Mirrors `AlertSeveritySchema` in `src/modules/alerting/common.ts`. */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  info: 'info',
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
};

export function severityTone(severity: AlertSeverity): Tone {
  return SEVERITY_TONE[severity];
}

/**
 * Severity glyph. Deliberately restricted to characters present in the websafe
 * core fonts so they render in Outlook 2016 and Gmail alike — no SVG (stripped
 * by Gmail/Outlook/Yahoo) and no emoji (renders full-colour and breaks the
 * mono register).
 */
const SEVERITY_GLYPH: Record<AlertSeverity, string> = {
  info: '&#9679;', // ● black circle
  warning: '!',
  error: '&#215;', // × multiplication sign
  critical: '&#9650;', // ▲ black up-pointing triangle
};

export function severityGlyph(severity: AlertSeverity): string {
  return SEVERITY_GLYPH[severity];
}
