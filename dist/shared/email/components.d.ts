/**
 * Email component library — Sentinel Mono, hardened for real inboxes.
 *
 * Every template in this module is composed from the primitives below so the
 * design language stays consistent and the client-compatibility work is done
 * exactly once.
 *
 * ── Client-compatibility contract ────────────────────────────────────────
 * 1. **Tables, not divs.** Outlook 2007–2021 renders with the Word engine and
 *    ignores `display:flex`, `display:grid`, `float` and most `div` layout.
 *    All structure is `<table role="presentation">` with `border-collapse` and
 *    `mso-table-lspace/rspace` zeroed.
 * 2. **Inline styles only.** `<style>` is stripped by Gmail's non-webmail
 *    surfaces and by many corporate gateways. The `<style>` block carries only
 *    progressive enhancements (responsive rules, dark-mode locks) that the
 *    layout never depends on.
 * 3. **Padding, never margin, for vertical rhythm.** Outlook ignores `margin`
 *    on tables. Spacing between surfaces comes from `block()`, which wraps a
 *    surface in a row with bottom padding — padding on `<td>` is universally
 *    honoured.
 * 4. **No SVG, no images, no icon fonts.** Gmail, Outlook and Yahoo strip
 *    inline `<svg>` outright — the previous templates rendered an empty hole
 *    where the logo and hero icons were meant to be. Marks are now drawn with
 *    table cells plus core-font glyphs: zero requests, no "display images"
 *    prompt, and nothing to block.
 * 5. **Bulletproof CTAs.** Every button ships a VML `<v:roundrect>` for Outlook
 *    (which ignores padding on anchors) beside the standard anchor.
 * 6. **Preheader on every send.** A hidden first line owns the inbox preview
 *    snippet instead of leaking the first words of body copy.
 * 7. **Dark by declaration.** `color-scheme: dark` plus `[data-ogsc]`
 *    overrides stop Outlook.com and Gmail force-inverting the palette.
 * 8. **Opaque colours only.** No `rgba()` — Outlook flattens alpha to black.
 *
 * ── Security contract ────────────────────────────────────────────────────
 * `esc()` escapes every interpolated value and `safeUrl()` rejects any scheme
 * other than http/https/mailto, so a poisoned link can never become
 * `javascript:` or `data:`. Templates must never interpolate raw caller input.
 */
import { type Tone } from './theme.js';
/** Escape a value for interpolation into HTML text or an attribute. */
export declare function esc(value: unknown): string;
/** Strip control characters that would corrupt a header or a plaintext body. */
export declare function stripControl(value: unknown): string;
/**
 * Validate a URL before it reaches an `href`.
 *
 * Anything that is not http/https/mailto collapses to `#`. This is the guard
 * that keeps `javascript:` and `data:` URLs out of links even when a caller
 * forgets to validate. The result is HTML-escaped, so it can be dropped
 * straight into an attribute.
 */
export declare function safeUrl(url: string): string;
/** Scheme-checked but unescaped URL — for plaintext bodies. */
export declare function safeUrlText(url: string): string;
/**
 * Wrap a surface so it contributes bottom spacing.
 *
 * This exists because Outlook drops `margin` on tables. Every surface
 * component below returns a bare, margin-free table; `block()` is what gives
 * the stack its rhythm.
 */
export declare function block(html: string, gap?: number): string;
/** Join surfaces with a uniform gap. The final surface gets no trailing gap. */
export declare function stack(blocks: (string | null | undefined | false)[], gap?: number): string;
/**
 * Body paragraph. Hierarchy is weight and tint, never extra colours (§4).
 *
 * The bottom margin defaults to zero because paragraphs are composed through
 * `stack()`, which owns the vertical rhythm. A non-zero default would add to
 * the stack gap and double the spacing.
 */
export declare function p(html: string, opts?: {
    muted?: boolean | undefined;
    bottom?: number | undefined;
}): string;
/** Inline link in the brand channel (white in Mono). */
export declare function link(url: string, label: string): string;
/** Emphasis without a colour change — weight only (§4 text-clarity rule). */
export declare function strong(text: string): string;
/** Mono uppercase eyebrow label (§4). */
export declare function eyebrow(text: string, color?: string): string;
/** Section heading inside the body — Inter 600 (§4 card/panel title). */
export declare function heading(text: string): string;
/**
 * Developer section header — crisp uppercase mono with tracking and optional count badge.
 */
export declare function sectionHeader(title: string, count?: string | number | undefined): string;
/**
 * Route / Endpoint badge showing HTTP method and path cleanly formatted.
 */
export declare function routeBadge(method?: string | undefined, path?: string | undefined, statusCode?: string | number | undefined): string;
/**
 * Marks restricted to characters present in the websafe core fonts, so they
 * render in Outlook 2016 and Gmail alike. Emoji are deliberately excluded:
 * they render full-colour and destroy the mono register.
 */
export declare const glyph: {
    readonly key: "&#8226;&#8226;&#8226;";
    readonly mail: "&#64;";
    readonly check: "&#10003;";
    readonly cross: "&#215;";
    readonly bang: "!";
    readonly dot: "&#9679;";
    readonly triangle: "&#9650;";
    readonly arrowUp: "&#8593;";
    readonly arrowRight: "&#8594;";
    readonly refresh: "&#8635;";
    readonly square: "&#9632;";
    readonly plus: "&#43;";
    readonly wave: "&#126;";
    readonly spark: "&#9670;";
    readonly pause: "&#8214;";
    readonly infinity: "&#8734;";
    readonly gauge: "&#8599;";
};
/**
 * Tinted square chip holding one glyph — the modern replacement for the old
 * circular SVG hero icon. `border-radius` degrades to a square in Outlook,
 * which is a graceful loss rather than a missing element.
 */
export declare function glyphChip(mark: string, tone: Tone): string;
export interface ButtonOptions {
    /** Solid fill (default) or a tinted outline. */
    variant?: 'primary' | 'ghost' | undefined;
    /** Tone for the fill. Defaults to `brand` — white in Mono. */
    tone?: Tone | undefined;
}
/**
 * Bulletproof CTA.
 *
 * Outlook ignores padding on `<a>`, so the anchor is mirrored by a VML
 * `roundrect` inside an `[if mso]` branch — the standard bulletproof-button
 * pattern. `<w:anchorlock/>` stops Outlook turning the shape into a
 * text-selectable region.
 */
export declare function button(url: string, label: string, opts?: ButtonOptions): string;
/**
 * Primary + secondary CTAs side by side, stacking under 620px.
 *
 * Alerts always offer two paths — the destination and the mitigation
 * ("View alert" / "Acknowledge") — because an on-call reader is triaging, not
 * browsing.
 */
export declare function buttonRow(primary: {
    url: string;
    label: string;
    tone?: Tone | undefined;
}, secondary: {
    url: string;
    label: string;
}): string;
/**
 * Copy-me link fallback.
 *
 * Every CTA is paired with one of these: corporate gateways rewrite or strip
 * anchors, and text-only clients render no button at all.
 *
 * The URL goes through the same scheme check as the anchor. An unsafe URL
 * renders nothing rather than printing a `javascript:` payload as copyable
 * text — some clients auto-linkify plain text, so an empty panel is a better
 * failure mode than a live one.
 */
export declare function linkFallback(url: string, label?: string): string;
/**
 * Left-ruled callout.
 *
 * The 3px rule in the tone colour is the same device the app uses for selected
 * rows and anomaly rows (§6, §7), so a warning in an email reads exactly the
 * way it reads in the product.
 */
export declare function callout(tone: Tone, html: string, title?: string | undefined): string;
/** Monospace code / token block. */
export declare function codeBlock(value: string, title?: string | undefined): string;
/**
 * One-time-code display. Mono, wide tracking, tabular figures — the same
 * treatment metric values get in the product.
 */
export declare function otpBlock(code: string): string;
/** Status pill — tinted bg + saturated text, mono uppercase (§7). */
export declare function pill(label: string, tone: Tone): string;
/** Hairline divider. */
export declare function divider(): string;
export interface DataRow {
    label: string;
    value: string;
    /** Render the value in the tone colour instead of primary text. */
    tone?: Tone | undefined;
    /** Use the sans family for prose values. Defaults to mono. */
    sans?: boolean | undefined;
}
/**
 * Definition table for alert context — rule, project, metric, threshold,
 * fingerprint, timestamps.
 *
 * Two fixed columns rather than a stacking grid: at 11px mono the labels stay
 * under ~105px even on a 320px viewport, so the pairing survives without a
 * breakpoint and without the double-hairline artefact that stacking produces.
 */
export declare function dataTable(rows: DataRow[]): string;
/**
 * The headline number of an alert: observed value against its threshold.
 *
 * Mono 30px for the value (§4 "page metric"). Showing both numbers side by side
 * means the reader never has to infer the breach direction or magnitude.
 */
export declare function metricCompare(input: {
    label: string;
    value: string;
    threshold: string;
    tone: Tone;
    thresholdLabel?: string | undefined;
}): string;
/**
 * AI insight card — the signature component (§7).
 *
 * Cyan is rationed to model output only: if a reader sees cyan in a Pulsiv
 * email, a model wrote that sentence. The confidence pill is mandatory when a
 * score exists, so the claim always arrives with its own uncertainty attached.
 */
export declare function aiInsight(input: {
    text: string;
    confidence?: number | undefined;
}): string;
export interface DigestItem {
    severityLabel: string;
    tone: Tone;
    mark: string;
    title: string;
    meta: string;
}
/** Compact scannable alert list used by the digest template. */
export declare function digestList(items: DigestItem[]): string;
/** Three-up counter strip for digests — firing / resolved / acknowledged. */
export declare function statStrip(cells: {
    label: string;
    value: string;
    tone: Tone;
}[]): string;
export type FooterKind = 'security' | 'alert' | 'plain';
export interface LayoutOptions {
    /** Product name as configured for the tenant. */
    appName: string;
    /** Sentence-case headline. Never Title Case (§4). */
    title: string;
    /** Inbox preview line — one per template, always supplied. */
    preheader: string;
    /** Mono uppercase label above the title. */
    eyebrowText: string;
    /** Drives the top rail, the eyebrow dot and the glyph-chip tone. */
    tone?: Tone | undefined;
    /** Optional glyph chip above the body (see `glyph`). */
    chip?: string | undefined;
    /** Composed body HTML. */
    body: string;
    /** Which footer to render. Defaults to `security`. */
    footer?: FooterKind | undefined;
    /** Optional footer link, e.g. notification preferences. */
    footerLink?: {
        url: string;
        label: string;
    } | undefined;
    /** Closing paragraph above the footer. Pass `null` to omit. */
    closing?: string | null | undefined;
}
/**
 * The single email shell every template renders into.
 *
 * Anatomy, top to bottom:
 *   ├─ 3px tone rail   — severity readable before a single word is parsed
 *   ├─ header (bg1)    — logo lockup, mono eyebrow with status dot, title
 *   ├─ body (bg1)      — optional glyph chip, template content, closing note
 *   └─ footer (bg)     — trust line, provenance, optional preferences link
 *
 * The `[if mso]` wrapper table pins the width for Outlook, which ignores
 * `max-width`; every other client uses the fluid `max-width` table.
 */
export declare function renderLayout(opts: LayoutOptions): string;
/**
 * Plaintext is a first-class body, not an afterthought: it is what screen
 * readers, `text/plain`-only clients, smartwatch previews and spam scanners
 * read. A missing or degenerate text part measurably hurts deliverability.
 */
export declare function textBody(...blocks: (string | null | undefined | false)[]): string;
/** Aligned `LABEL   value` block for plaintext bodies. */
export declare function textRows(rows: {
    label: string;
    value: string;
}[]): string;
/** Horizontal rule for plaintext bodies. */
export declare const TEXT_RULE = "------------------------------------------------------";
export declare function textGreeting(userName?: string | undefined): string;
//# sourceMappingURL=components.d.ts.map