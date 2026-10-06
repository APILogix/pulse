/**
 * Email component library — Sentinel Mono, hardened for real inboxes.
 *
 * Every template is composed from the primitives below, so the design language
 * stays consistent and the client-compatibility work is done exactly once.
 *
 * ── The sheet ────────────────────────────────────────────────────────────
 * An email is one engineered sheet, the same way a console page is: chrome is
 * hairlines, the numbers carry the page, and colour only ever states a
 * verdict. It borrows the console's own anatomy rather than the stock SaaS
 * email kit (logo, eyebrow, icon chip, paragraph, button):
 *
 *   ├─ header strip   wordmark left, which part of the product is speaking right
 *   ├─ state line     optional verdict band: drawn status dot, state, timestamp
 *   ├─ headline       28px Inter semibold, the auth pages' heading
 *   ├─ readout band   optional full-bleed instrument: values + threshold meter
 *   ├─ body           facts divided by hairlines, one white action, quiet notes
 *   └─ footer         provenance on the canvas colour
 *
 * The threshold meter is the product's signature motif (the sign-in panel's
 * trace crossing a dashed budget) rebuilt from table cells: the part of the bar
 * past the threshold is the only saturated colour in the band.
 *
 * ── Client-compatibility contract ────────────────────────────────────────
 * 1. **Tables, not divs, for structure.** Outlook 2007–2021 renders with the
 *    Word engine and ignores `display:flex`, `display:grid`, `float` and most
 *    `div` layout. All structure is `<table role="presentation">` with
 *    `border-collapse` and `mso-table-lspace/rspace` zeroed.
 * 2. **Inline styles only.** `<style>` is stripped by Gmail's non-webmail
 *    surfaces and by many corporate gateways. The `<style>` block carries only
 *    progressive enhancements (responsive rules, dark-mode locks, hover) that
 *    the layout never depends on.
 * 3. **Padding, never margin, for vertical rhythm.** Outlook ignores `margin`
 *    on tables. Spacing between surfaces comes from `block()`, which wraps a
 *    surface in a row with bottom padding — padding on `<td>` is universally
 *    honoured.
 * 4. **No SVG, no images, no icon fonts.** Gmail, Outlook and Yahoo strip
 *    inline `<svg>`. Marks (status dots, the meter, the logo tile) are drawn
 *    with table cells: zero requests, no "display images" prompt, nothing to
 *    block.
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
 * Body paragraph. Hierarchy is weight and tint, never extra colours.
 *
 * The bottom margin defaults to zero because paragraphs are composed through
 * `stack()`, which owns the vertical rhythm. A non-zero default would add to
 * the stack gap and double the spacing.
 */
export declare function p(html: string, opts?: {
    muted?: boolean | undefined;
    bottom?: number | undefined;
}): string;
/** Inline link. Links are primary text with an underline — never brand-coloured. */
export declare function link(url: string, label: string): string;
/** Emphasis without a colour change — weight only. */
export declare function strong(text: string): string;
/** Inline identifier inside prose — a route, a matcher, a rule key — set in mono. */
export declare function code(text: string): string;
/**
 * Quiet sentence-case label — 12px Inter, `--text3` by default.
 *
 * This replaces the uppercase tracked-mono eyebrow, which the console refuses
 * on every surface: a label names a value, it does not shout above a heading.
 */
export declare function label(text: string, color?: string): string;
/** @deprecated Kept for API compatibility; renders the sentence-case `label()`. */
export declare const eyebrow: typeof label;
/**
 * Secondary guidance — expiry, "ignore this if…", next-step hints. The email
 * equivalent of the console's `AuthNote`: 12px, `--text3`, no box.
 */
export declare function note(html: string): string;
/** Section heading — a real 14px semibold heading, not an uppercase label. */
export declare function heading(text: string): string;
/**
 * Section heading with an optional count. More space above than below, so the
 * heading belongs to the content it introduces rather than floating between
 * sections.
 */
export declare function sectionHeader(title: string, count?: string | number | undefined): string;
/** A heading and the content it introduces, as one surface. Empty content renders nothing. */
export declare function section(title: string, content: string, count?: string | number | undefined): string;
/**
 * Route line — HTTP method tag, path, and a status code coloured by class
 * (5xx red, 4xx amber). The method tag stays neutral: a verb is not a verdict.
 */
export declare function routeBadge(method?: string | undefined, path?: string | undefined, statusCode?: string | number | undefined): string;
/**
 * Core-font marks. The shell no longer draws them — severity and state are
 * carried by the drawn status dot and a word — but the map stays exported for
 * one-off surfaces and callers that still pass a `chip`.
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
 * @deprecated Icon chips are retired — the console refuses them as decoration.
 * Kept so existing imports compile; renders the mark as plain tone-coloured
 * text with no tinted box.
 */
export declare function glyphChip(mark: string, tone: Tone): string;
export interface ButtonOptions {
    /**
     * `primary` is white (the brand), `ghost` a hairline, `danger` red — the
     * console's three button voices. There is no amber or cyan button.
     */
    variant?: 'primary' | 'ghost' | 'danger' | undefined;
    /**
     * @deprecated State colour belongs to verdicts, not controls. Only `danger`
     * is honoured (as the destructive variant); every other tone renders white.
     */
    tone?: Tone | undefined;
}
/**
 * Bulletproof CTA — 44px, 6px radius, Inter semibold, like `AuthButton`.
 *
 * Outlook ignores padding on `<a>`, so the anchor is mirrored by a VML
 * `roundrect` inside an `[if mso]` branch — the standard bulletproof-button
 * pattern. `<w:anchorlock/>` stops Outlook turning the shape into a
 * text-selectable region. Under 620px the button spans the column, the way the
 * console's auth actions do.
 */
export declare function button(url: string, label: string, opts?: ButtonOptions): string;
/**
 * Primary + secondary CTAs side by side, stacking under 620px.
 *
 * The secondary is always the hairline ghost, so exactly one white control
 * leads the eye. The primary is red only when the caller marks it `danger`.
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
 * Tertiary actions as underlined text links — "Acknowledge · Silence". The
 * console's `AuthTextButton`: quiet, `--text2`, never a third button.
 */
export declare function textLinks(links: {
    url: string;
    label: string;
}[]): string;
/**
 * Copy-me link fallback.
 *
 * Every CTA is paired with one of these: corporate gateways rewrite or strip
 * anchors, and text-only clients render no button at all. It is a quiet note,
 * not a box — the URL is set in mono because it is an identifier.
 *
 * The URL goes through the same scheme check as the anchor. An unsafe URL
 * renders nothing rather than printing a `javascript:` payload as copyable
 * text — some clients auto-linkify plain text, so an empty slot is a better
 * failure mode than a live one.
 */
export declare function linkFallback(url: string, labelText?: string): string;
/**
 * Callout — the one boxed element the sheet allows, reserved for information
 * that changes what the reader does next.
 *
 * Like the console's `AuthCallout`, tone lives only in the status dot and the
 * tinted hairline; the title and body stay neutral, so a warning reads as a
 * fact rather than an alarm.
 */
export declare function callout(tone: Tone, html: string, title?: string | undefined): string;
/** Monospace code / source excerpt, set in a well one step darker than the sheet. */
export declare function codeBlock(value: string, title?: string | undefined): string;
/**
 * One-time-code display — the console's `CodeInput` in read-only form: a
 * `--bg2` well, mono digits, wide tracking. The left padding repeats the
 * tracking so the trailing letter-space does not pull the code off centre.
 */
export declare function otpBlock(code: string): string;
/** Status pill — 11px sentence case on a 4px tint of its state colour. */
export declare function pill(labelText: string, tone: Tone): string;
/** Hairline divider. */
export declare function divider(): string;
/**
 * Exception readout — the error type in the verdict colour, the message in
 * primary text, and the frame as a Node-style `at fn (file:line:col)` line.
 * Rendered inside the readout band, it reads like the top of a stack trace.
 */
export declare function exceptionBlock(input: {
    type: string;
    message?: string | undefined;
    frame?: string | undefined;
    fn?: string | undefined;
    tone: Tone;
}): string;
export interface DataRow {
    label: string;
    value: string;
    /** Render the value in the tone colour instead of primary text. */
    tone?: Tone | undefined;
    /** Use the sans family for prose values. Defaults to mono. */
    sans?: boolean | undefined;
}
/**
 * Facts — key-value rows divided by hairlines, the console's detail-sheet
 * pattern: a 12px sentence-case label left of the value, no box, no fill.
 *
 * Two fixed columns rather than a stacking grid: the labels stay short enough
 * to survive a 320px viewport without a breakpoint.
 */
export declare function dataTable(rows: DataRow[]): string;
/**
 * Single-column hairline list — slowest operations, changed parameters. Mono
 * by default because these lines are identifiers and measurements, not prose.
 */
export declare function lines(items: string[], opts?: {
    mono?: boolean | undefined;
}): string;
/**
 * Threshold meter — the crossing, drawn.
 *
 * One 6px bar on a fixed scale where the larger of the two values sits at 90%.
 * A 2px white tick marks the threshold and runs past the bar on both sides.
 * Over the threshold, the stretch beyond the tick is painted in the verdict
 * colour and everything below it stays neutral; under it, the fill itself
 * carries the tone. Pure table cells, `aria-hidden` — the numbers above it are
 * the accessible reading.
 */
export declare function meter(input: {
    value: number;
    threshold: number;
    tone: Tone;
}): string;
export interface ReadoutCell {
    label: string;
    value: string;
    /** Verdict colour for the value. `neutral`/`brand` read as primary text. */
    tone?: Tone | undefined;
    /** Secondary reading — a threshold or baseline beside the observed value. */
    muted?: boolean | undefined;
}
/**
 * Readout — hairline-divided cells of sentence-case label over a mono value,
 * the console's readout band. Two cells get the peak size; three or more drop
 * to the dashboard size and stack under 620px. `after` hangs a full-width row
 * (the meter) beneath the cells.
 */
export declare function readout(cells: ReadoutCell[], opts?: {
    after?: string | undefined;
}): string;
/**
 * The headline number of an alert: observed value against its threshold, with
 * the crossing drawn beneath. Showing both numbers means the reader never has
 * to infer the breach direction or magnitude; the meter shows it pre-verbally.
 */
export declare function metricCompare(input: {
    label: string;
    value: string;
    threshold: string;
    tone: Tone;
    thresholdLabel?: string | undefined;
    /** Further cells after the pair, e.g. a deviation or a utilization figure. */
    extra?: ReadoutCell[] | undefined;
}): string;
/**
 * Segmented track — an escalation policy's steps, drawn. Steps already taken
 * fill in the verdict colour; the rest stay on the track. Same 6px bar and
 * rounded ends as the threshold meter, so the two read as one instrument.
 */
export declare function stepTrack(input: {
    current: number;
    total: number;
    tone: Tone;
}): string;
/**
 * AI insight — the only cyan surface.
 *
 * If a reader sees cyan in a Pulsiv email, a model wrote that sentence. The
 * confidence score rides on the same line as the label, so the claim always
 * arrives with its own uncertainty attached.
 */
export declare function aiInsight(input: {
    text: string;
    confidence?: number | undefined;
}): string;
export interface DigestItem {
    severityLabel: string;
    tone: Tone;
    /** @deprecated Retained for compatibility; the list draws a status dot instead. */
    mark: string;
    title: string;
    meta: string;
}
/** Scannable alert list for the digest — hairline rows, a dot, the severity word in its colour. */
export declare function digestList(items: DigestItem[]): string;
/** Counter strip for digests — a readout band of firing / resolved / acknowledged. */
export declare function statStrip(cells: {
    label: string;
    value: string;
    tone: Tone;
}[]): string;
export type FooterKind = 'security' | 'alert' | 'plain';
/** The verdict band under the header strip. */
export interface LayoutStatus {
    /** Sentence-case state, e.g. "Firing · critical", "Password updated". */
    label: string;
    tone: Tone;
    /** Right-aligned mono fact — usually when it happened. */
    meta?: string | undefined;
}
export interface LayoutOptions {
    /** Product name as configured for the tenant. */
    appName: string;
    /** Sentence-case headline. Never Title Case. */
    title: string;
    /** Inbox preview line — one per template, always supplied. */
    preheader: string;
    /**
     * Header-strip context: which part of the product is speaking — "Security",
     * "Invitation", or an alert's scope ("checkout-api · production").
     */
    context?: string | undefined;
    /** @deprecated Former eyebrow text; used as `context` when that is absent. */
    eyebrowText?: string | undefined;
    /**
     * @deprecated Tone now lives on `status`. When `status` is absent and this is
     * a verdict tone, the shell renders a state line labelled with the context.
     */
    tone?: Tone | undefined;
    /** State line — the verdict band. Omit for mail that states no verdict. */
    status?: LayoutStatus | undefined;
    /** @deprecated Glyph chips are retired; the value is ignored. */
    chip?: string | undefined;
    /** Full-bleed readout band between the headline and the body. */
    hero?: string | undefined;
    /** Composed body HTML. */
    body: string;
    /** Which footer to render. Defaults to `security`. */
    footer?: FooterKind | undefined;
    /** Optional footer link, e.g. notification preferences. */
    footerLink?: {
        url: string;
        label: string;
    } | undefined;
    /** Closing note under the body. Pass `null` to omit. */
    closing?: string | null | undefined;
}
/**
 * The single email shell every template renders into. See the anatomy at the
 * top of this file.
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