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

import {
  font,
  layout,
  palette,
  radius,
  size,
  tint,
  tintBorder,
  toneStyle,
  type Tone,
} from './theme.js';

/* ════════════════════════════════════════════════════════════════════════
   ESCAPING & URL SAFETY
   ════════════════════════════════════════════════════════════════════════ */

/** Escape a value for interpolation into HTML text or an attribute. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Strip control characters that would corrupt a header or a plaintext body. */
export function stripControl(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ');
}

const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * Validate a URL before it reaches an `href`.
 *
 * Anything that is not http/https/mailto collapses to `#`. This is the guard
 * that keeps `javascript:` and `data:` URLs out of links even when a caller
 * forgets to validate. The result is HTML-escaped, so it can be dropped
 * straight into an attribute.
 */
export function safeUrl(url: string): string {
  const trimmed = stripControl(url).trim();
  if (!SAFE_SCHEME.test(trimmed)) return '#';
  return esc(trimmed);
}

/** Scheme-checked but unescaped URL — for plaintext bodies. */
export function safeUrlText(url: string): string {
  const trimmed = stripControl(url).trim();
  return SAFE_SCHEME.test(trimmed) ? trimmed : '';
}

/* ════════════════════════════════════════════════════════════════════════
   SHARED STYLE FRAGMENTS
   ════════════════════════════════════════════════════════════════════════ */

/** Reset a layout table so Outlook does not inject its own spacing. */
const TABLE = 'border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;';

/**
 * Reset for a table that carries a rounded, bordered surface. In the collapsed
 * border model browsers round the fill but draw the border square, which
 * leaves dark notches inside every corner; the separated model rounds both.
 */
const TABLE_ROUND = 'border-collapse:separate;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;';

/** Outlook rounds line-height up unless told to honour it exactly. */
const LH = 'mso-line-height-rule:exactly;';

/** Opening tag for a presentational layout table. */
const T = 'role="presentation" border="0" cellpadding="0" cellspacing="0"';

function px(n: number): string {
  return `${n}px`;
}

/** Uppercase the first letter only — sentence case for enum values. */
function sentence(value: string): string {
  const v = stripControl(value).trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

/** Readable colour for a tone when it paints text on the sheet. */
function toneText(tone: Tone | undefined): string {
  if (!tone || tone === 'brand') return palette.text;
  if (tone === 'neutral') return palette.text2;
  return toneStyle(tone).fg;
}

/* ════════════════════════════════════════════════════════════════════════
   SPACING
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Wrap a surface so it contributes bottom spacing.
 *
 * This exists because Outlook drops `margin` on tables. Every surface
 * component below returns a bare, margin-free table; `block()` is what gives
 * the stack its rhythm.
 */
export function block(html: string, gap = 22): string {
  return `<table ${T} width="100%" style="${TABLE}width:100%;">
  <tr><td style="padding:0 0 ${px(gap)};">${html}</td></tr>
</table>`;
}

/** Join surfaces with a uniform gap. The final surface gets no trailing gap. */
export function stack(blocks: (string | null | undefined | false)[], gap = 20): string {
  const items = blocks.filter((b): b is string => typeof b === 'string' && b.length > 0);
  return items.map((html, i) => (i === items.length - 1 ? html : block(html, gap))).join('\n');
}

/* ════════════════════════════════════════════════════════════════════════
   MARKS
   ════════════════════════════════════════════════════════════════════════ */

/**
 * A drawn status dot — the console's state mark, built from one table cell so
 * it renders in every client without depending on a font's symbol coverage.
 * `border-radius` degrades to a small square in Outlook, which still reads.
 */
function dot(color: string, d = 7): string {
  return `<table ${T} style="${TABLE}"><tr><td width="${d}" height="${d}" bgcolor="${color}" style="width:${px(d)};height:${px(d)};background-color:${color};border-radius:50%;font-size:1px;line-height:${px(d)};${LH}">&nbsp;</td></tr></table>`;
}

/* ════════════════════════════════════════════════════════════════════════
   TEXT
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Body paragraph. Hierarchy is weight and tint, never extra colours.
 *
 * The bottom margin defaults to zero because paragraphs are composed through
 * `stack()`, which owns the vertical rhythm. A non-zero default would add to
 * the stack gap and double the spacing.
 */
export function p(
  html: string,
  opts: { muted?: boolean | undefined; bottom?: number | undefined } = {},
): string {
  const color = opts.muted ? palette.text3 : palette.text2;
  const mb = opts.bottom ?? 0;
  return `<p style="margin:0 0 ${px(mb)};padding:0;font-family:${font.sans};font-size:${px(size.body)};line-height:22px;${LH}color:${color};">${html}</p>`;
}

/** Inline link. Links are primary text with an underline — never brand-coloured. */
export function link(url: string, label: string): string {
  return `<a class="pl-link" href="${safeUrl(url)}" style="color:${palette.text};text-decoration:underline;">${esc(label)}</a>`;
}

/** Emphasis without a colour change — weight only. */
export function strong(text: string): string {
  return `<strong style="font-weight:600;color:${palette.text};">${esc(text)}</strong>`;
}

/** Inline identifier inside prose — a route, a matcher, a rule key — set in mono. */
export function code(text: string): string {
  return `<code style="font-family:${font.mono};font-size:13px;color:${palette.text};word-break:normal;overflow-wrap:anywhere;">${esc(text)}</code>`;
}

/**
 * Quiet sentence-case label — 12px Inter, `--text3` by default.
 *
 * This replaces the uppercase tracked-mono eyebrow, which the console refuses
 * on every surface: a label names a value, it does not shout above a heading.
 */
export function label(text: string, color: string = palette.text3): string {
  return `<div style="font-family:${font.sans};font-size:${px(size.label)};line-height:16px;${LH}color:${color};">${esc(text)}</div>`;
}

/** @deprecated Kept for API compatibility; renders the sentence-case `label()`. */
export const eyebrow = label;

/**
 * Secondary guidance — expiry, "ignore this if…", next-step hints. The email
 * equivalent of the console's `AuthNote`: 12px, `--text3`, no box.
 */
export function note(html: string): string {
  return `<p style="margin:0;padding:0;font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text3};">${html}</p>`;
}

/** Section heading — a real 14px semibold heading, not an uppercase label. */
export function heading(text: string): string {
  return sectionHeader(text);
}

/**
 * Section heading with an optional count. More space above than below, so the
 * heading belongs to the content it introduces rather than floating between
 * sections.
 */
export function sectionHeader(title: string, count?: string | number | undefined): string {
  const hasCount = count !== undefined && count !== null && String(count).trim() !== '';
  const countHtml = hasCount
    ? `<span style="padding-left:8px;font-family:${font.mono};font-size:${px(size.label)};font-weight:400;color:${palette.text3};">${esc(String(count))}</span>`
    : '';
  return `<div style="padding:10px 0 12px;font-family:${font.sans};font-size:${px(size.section)};font-weight:600;line-height:20px;${LH}letter-spacing:-0.01em;color:${palette.text};">${esc(title)}${countHtml}</div>`;
}

/** A heading and the content it introduces, as one surface. Empty content renders nothing. */
export function section(title: string, content: string, count?: string | number | undefined): string {
  if (!content) return '';
  return `${sectionHeader(title, count)}${content}`;
}

/**
 * Route line — HTTP method tag, path, and a status code coloured by class
 * (5xx red, 4xx amber). The method tag stays neutral: a verb is not a verdict.
 */
export function routeBadge(
  method?: string | undefined,
  path?: string | undefined,
  statusCode?: string | number | undefined,
): string {
  if (!path && !method) return '';
  const m = method ? String(method).toUpperCase() : '';
  const code = statusCode !== undefined && statusCode !== null ? String(statusCode).trim() : '';
  const n = Number(code);
  const codeColor = n >= 500 ? palette.red : n >= 400 ? palette.amber : palette.text2;

  const methodHtml = m
    ? `<span style="padding:2px 6px;background-color:${palette.bg3};border-radius:${radius.sm};font-family:${font.mono};font-size:${px(size.micro)};font-weight:600;line-height:16px;color:${palette.text2};">${esc(m)}</span>&nbsp;&nbsp;`
    : '';
  const codeHtml = code
    ? `&nbsp;&nbsp;<span style="font-family:${font.mono};font-weight:600;color:${codeColor};">${esc(code)}</span>`
    : '';

  return `<div style="font-family:${font.mono};font-size:${px(size.data)};line-height:22px;${LH}color:${palette.text};word-break:break-all;">${methodHtml}${esc(path ?? '')}${codeHtml}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   BRAND MARK
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Logo lockup: the rounded `P` tile beside the wordmark, both in the display
 * face — the same role Space Grotesk plays in the console.
 *
 * The tile is the one place the system permits a linear gradient (brand → AI,
 * white → cyan). `background-color` is declared first so Outlook, which
 * ignores `background-image`, lands on solid white instead of transparent.
 */
function logoLockup(): string {
  return `<table ${T} style="${TABLE}">
  <tr>
    <td width="22" height="22" align="center" valign="middle" bgcolor="${palette.brand}" style="width:22px;height:22px;background-color:${palette.brand};background-image:linear-gradient(135deg,${palette.brand} 0%,${palette.ai} 100%);border-radius:6px;text-align:center;vertical-align:middle;font-family:${font.display};font-size:13px;font-weight:700;line-height:22px;${LH}color:${palette.brandFg};">P</td>
    <td style="padding-left:10px;vertical-align:middle;font-family:${font.display};font-size:${px(size.wordmark)};font-weight:600;letter-spacing:-0.02em;line-height:22px;${LH}color:${palette.text};">Pulsiv</td>
  </tr>
</table>`;
}

/* ════════════════════════════════════════════════════════════════════════
   GLYPHS  (retained for API compatibility)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Core-font marks. The shell no longer draws them — severity and state are
 * carried by the drawn status dot and a word — but the map stays exported for
 * one-off surfaces and callers that still pass a `chip`.
 */
export const glyph = {
  key: '&#8226;&#8226;&#8226;', // ••• a masked secret
  mail: '&#64;', // @
  check: '&#10003;', // ✓
  cross: '&#215;', // ×
  bang: '!',
  dot: '&#9679;', // ●
  triangle: '&#9650;', // ▲
  arrowUp: '&#8593;', // ↑
  arrowRight: '&#8594;', // →
  refresh: '&#8635;', // ↻
  square: '&#9632;', // ■
  plus: '&#43;', // +
  wave: '&#126;', // ~
  spark: '&#9670;', // ◆
  pause: '&#8214;', // ‖
  infinity: '&#8734;', // ∞
  gauge: '&#8599;', // ↗
} as const;

/**
 * @deprecated Icon chips are retired — the console refuses them as decoration.
 * Kept so existing imports compile; renders the mark as plain tone-coloured
 * text with no tinted box.
 */
export function glyphChip(mark: string, tone: Tone): string {
  return `<span style="font-family:${font.mono};font-size:13px;line-height:20px;color:${toneText(tone)};">${mark}</span>`;
}

/* ════════════════════════════════════════════════════════════════════════
   BUTTONS
   ════════════════════════════════════════════════════════════════════════ */

/** Approximate a label's rendered width so VML can be given a fixed px value. */
function vmlWidth(label: string): number {
  return Math.max(160, Math.round(label.length * 8.6) + 52);
}

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

type ButtonVoice = 'primary' | 'ghost' | 'danger';

/**
 * Danger fills with `--red-d`, not `--red`: white 14px semibold on #ef4444 is
 * 3.8:1, under the 4.5:1 floor for normal text; on #dc2626 it is 4.8:1.
 */
const BUTTON_VOICE: Record<ButtonVoice, { fill: string; fg: string; stroke: string }> = {
  primary: { fill: palette.brand, fg: palette.brandFg, stroke: palette.brand },
  danger: { fill: palette.redD, fg: '#ffffff', stroke: palette.redD },
  ghost: { fill: palette.bg1, fg: palette.text, stroke: palette.border2 },
};

/**
 * Bulletproof CTA — 44px, 6px radius, Inter semibold, like `AuthButton`.
 *
 * Outlook ignores padding on `<a>`, so the anchor is mirrored by a VML
 * `roundrect` inside an `[if mso]` branch — the standard bulletproof-button
 * pattern. `<w:anchorlock/>` stops Outlook turning the shape into a
 * text-selectable region. Under 620px the button spans the column, the way the
 * console's auth actions do.
 */
export function button(url: string, label: string, opts: ButtonOptions = {}): string {
  const voice: ButtonVoice =
    opts.variant === 'ghost'
      ? 'ghost'
      : opts.variant === 'danger' || opts.tone === 'danger'
        ? 'danger'
        : 'primary';
  const v = BUTTON_VOICE[voice];
  const href = safeUrl(url);
  const text = esc(label);
  const w = vmlWidth(label);
  const vmlStroke = voice === 'ghost' ? `strokecolor="${v.stroke}" strokeweight="1px"` : 'stroke="f"';

  return `<table ${T} class="sm-btn" style="${TABLE_ROUND}">
  <tr>
    <td class="pl-btn-${voice}" align="center" bgcolor="${v.fill}" style="background-color:${v.fill};border:1px solid ${v.stroke};border-radius:${radius.md};text-align:center;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:${w}px;" arcsize="14%" ${vmlStroke} fillcolor="${v.fill}"><w:anchorlock/><center style="color:${v.fg};font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;">${text}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:12px 24px;font-family:${font.sans};font-size:${px(size.body)};font-weight:600;line-height:18px;${LH}color:${v.fg};text-decoration:none;border-radius:${radius.md};">${text}</a><!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/**
 * Primary + secondary CTAs side by side, stacking under 620px.
 *
 * The secondary is always the hairline ghost, so exactly one white control
 * leads the eye. The primary is red only when the caller marks it `danger`.
 */
export function buttonRow(
  primary: { url: string; label: string; tone?: Tone | undefined },
  secondary: { url: string; label: string },
): string {
  const primaryOpts: ButtonOptions = primary.tone === 'danger' ? { variant: 'danger' } : {};
  return `<table ${T} class="sm-full" style="${TABLE}">
  <tr>
    <td class="sm-stack sm-flush" valign="top" style="padding:0 10px 0 0;">${button(primary.url, primary.label, primaryOpts)}</td>
    <td class="sm-stack sm-stack-top" valign="top" style="padding:0;">${button(secondary.url, secondary.label, { variant: 'ghost' })}</td>
  </tr>
</table>`;
}

/**
 * Tertiary actions as underlined text links — "Acknowledge · Silence". The
 * console's `AuthTextButton`: quiet, `--text2`, never a third button.
 */
export function textLinks(links: { url: string; label: string }[]): string {
  const safe = links.filter((l) => safeUrlText(l.url));
  if (safe.length === 0) return '';
  const items = safe
    .map(
      (l) =>
        `<a class="pl-link" href="${safeUrl(l.url)}" style="color:${palette.text2};text-decoration:underline;">${esc(l.label)}</a>`,
    )
    .join(`<span style="color:${palette.text3};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
  return `<div style="font-family:${font.sans};font-size:${px(size.ui)};line-height:20px;${LH}color:${palette.text3};">${items}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   SURFACES
   ════════════════════════════════════════════════════════════════════════ */

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
export function linkFallback(url: string, labelText = 'Or paste this link into your browser'): string {
  const safe = safeUrlText(url);
  if (!safe) return '';
  return `<table ${T} width="100%" style="${TABLE}width:100%;">
  <tr><td style="padding:0 0 4px;font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text3};">${esc(labelText)}</td></tr>
  <tr><td style="font-family:${font.mono};font-size:${px(size.label)};line-height:18px;${LH}word-break:break-all;"><a href="${safeUrl(url)}" style="color:${palette.text2};text-decoration:none;">${esc(safe)}</a></td></tr>
</table>`;
}

/**
 * Callout — the one boxed element the sheet allows, reserved for information
 * that changes what the reader does next.
 *
 * Like the console's `AuthCallout`, tone lives only in the status dot and the
 * tinted hairline; the title and body stay neutral, so a warning reads as a
 * fact rather than an alarm.
 */
export function callout(tone: Tone, html: string, title?: string | undefined): string {
  const quiet = tone === 'neutral' || tone === 'brand';
  const hairline = quiet ? palette.border2 : toneStyle(tone).border;
  const mark = quiet ? palette.text2 : toneStyle(tone).fg;
  const titleHtml = title
    ? `<div style="font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:20px;${LH}color:${palette.text};">${esc(title)}</div>`
    : '';
  return `<table ${T} width="100%" style="${TABLE_ROUND}width:100%;">
  <tr>
    <td bgcolor="${palette.bg1}" style="background-color:${palette.bg1};border:1px solid ${hairline};border-radius:${radius.md};padding:13px 16px 14px 14px;">
      <table ${T} width="100%" style="${TABLE}width:100%;">
        <tr>
          <td width="18" valign="top" style="width:18px;padding-top:7px;">${dot(mark, 6)}</td>
          <td valign="top">${titleHtml}<div style="padding-top:${title ? 2 : 0}px;font-family:${font.sans};font-size:${px(size.ui)};line-height:20px;${LH}color:${palette.text2};">${html}</div></td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** Monospace code / source excerpt, set in a well one step darker than the sheet. */
export function codeBlock(value: string, title?: string | undefined): string {
  const headerHtml = title
    ? `<tr><td style="border-bottom:1px solid ${palette.border};padding:9px 16px;font-family:${font.sans};font-size:${px(size.label)};line-height:16px;${LH}color:${palette.text3};">${esc(title)}</td></tr>`
    : '';
  return `<table ${T} width="100%" bgcolor="${palette.bg}" style="${TABLE_ROUND}width:100%;background-color:${palette.bg};border:1px solid ${palette.border};border-radius:${radius.md};">
  ${headerHtml}
  <tr>
    <td style="padding:14px 16px;font-family:${font.mono};font-size:${px(size.label)};line-height:19px;${LH}color:${palette.text2};word-break:break-all;white-space:pre-wrap;">${esc(value)}</td>
  </tr>
</table>`;
}

/**
 * One-time-code display — the console's `CodeInput` in read-only form: a
 * `--bg2` well, mono digits, wide tracking. The left padding repeats the
 * tracking so the trailing letter-space does not pull the code off centre.
 */
export function otpBlock(code: string): string {
  return `<table ${T} width="100%" style="${TABLE_ROUND}width:100%;">
  <tr>
    <td align="center" bgcolor="${palette.bg2}" style="background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.lg};padding:22px 12px;text-align:center;">
      <div class="sm-otp" style="padding-left:0.4em;font-family:${font.mono};font-size:${px(size.otp)};font-weight:500;line-height:40px;${LH}letter-spacing:0.4em;color:${palette.text};font-variant-numeric:tabular-nums;">${esc(code)}</div>
    </td>
  </tr>
</table>`;
}

/** Status pill — 11px sentence case on a 4px tint of its state colour. */
export function pill(labelText: string, tone: Tone): string {
  const t = toneStyle(tone);
  return `<table ${T} style="${TABLE}">
  <tr>
    <td bgcolor="${t.bg}" style="background-color:${t.bg};border-radius:${radius.pill};padding:3px 8px;font-family:${font.sans};font-size:${px(size.micro)};font-weight:500;line-height:16px;${LH}color:${toneText(tone)};white-space:nowrap;">${esc(labelText)}</td>
  </tr>
</table>`;
}

/** Hairline divider. */
export function divider(): string {
  return `<table ${T} width="100%" style="${TABLE}width:100%;">
  <tr><td height="1" bgcolor="${palette.border}" style="height:1px;background-color:${palette.border};line-height:1px;font-size:0;">&nbsp;</td></tr>
</table>`;
}

/**
 * Exception readout — the error type in the verdict colour, the message in
 * primary text, and the frame as a Node-style `at fn (file:line:col)` line.
 * Rendered inside the readout band, it reads like the top of a stack trace.
 */
export function exceptionBlock(input: {
  type: string;
  message?: string | undefined;
  frame?: string | undefined;
  fn?: string | undefined;
  tone: Tone;
}): string {
  const where = input.fn && input.frame
    ? `at ${input.fn} (${input.frame})`
    : input.frame
      ? `at ${input.frame}`
      : input.fn
        ? `at ${input.fn}`
        : '';
  const message = input.message
    ? `<div style="padding-top:6px;font-family:${font.mono};font-size:${px(size.data)};line-height:20px;${LH}color:${palette.text};word-break:break-word;">${esc(input.message)}</div>`
    : '';
  const frame = where
    ? `<div style="padding-top:10px;font-family:${font.mono};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text3};word-break:break-all;">${esc(where)}</div>`
    : '';
  return `<div style="font-family:${font.mono};font-size:15px;font-weight:600;line-height:22px;${LH}color:${toneText(input.tone)};word-break:break-word;">${esc(input.type)}</div>${message}${frame}`;
}

/* ════════════════════════════════════════════════════════════════════════
   DATA DISPLAY
   ════════════════════════════════════════════════════════════════════════ */

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
export function dataTable(rows: DataRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map((row, i) => {
      const family = row.sans ? font.sans : font.mono;
      const valueSize = row.sans ? size.body : size.data;
      const rule = `${i === 0 ? `border-top:1px solid ${palette.border};` : ''}border-bottom:1px solid ${palette.border};`;
      return `  <tr>
    <td width="34%" valign="top" style="${rule}padding:11px 16px 11px 0;font-family:${font.sans};font-size:${px(size.label)};line-height:20px;${LH}color:${palette.text3};">${esc(row.label)}</td>
    <td valign="top" style="${rule}padding:11px 0;font-family:${family};font-size:${px(valueSize)};font-weight:500;line-height:20px;${LH}color:${toneText(row.tone)};word-break:break-word;font-variant-numeric:tabular-nums;">${esc(row.value)}</td>
  </tr>`;
    })
    .join('\n');

  return `<table ${T} width="100%" style="${TABLE}width:100%;">
${body}
</table>`;
}

/**
 * Single-column hairline list — slowest operations, changed parameters. Mono
 * by default because these lines are identifiers and measurements, not prose.
 */
export function lines(items: string[], opts: { mono?: boolean | undefined } = {}): string {
  const clean = items.map((item) => stripControl(item).trim()).filter((item) => item.length > 0);
  if (clean.length === 0) return '';
  const family = opts.mono === false ? font.sans : font.mono;
  const rows = clean
    .map((item, i) => {
      const rule = `${i === 0 ? `border-top:1px solid ${palette.border};` : ''}border-bottom:1px solid ${palette.border};`;
      return `  <tr><td style="${rule}padding:10px 0;font-family:${family};font-size:${px(size.data)};line-height:20px;${LH}color:${palette.text};word-break:break-word;">${esc(item)}</td></tr>`;
    })
    .join('\n');
  return `<table ${T} width="100%" style="${TABLE}width:100%;">
${rows}
</table>`;
}

/* ── Measurements ──────────────────────────────────────────────────────── */

interface Measure {
  value: number;
  family: string;
}

const TIME_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  'µs': 1e-3,
  'μs': 1e-3,
  ms: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  min: 60_000,
  mins: 60_000,
};

const BYTES: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** Case-sensitive on purpose: `M` is a million, `m` is not. */
const COUNT: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6 };

const MEASURE = /^\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([A-Za-zµμ%]*)\s*$/;

/**
 * Parse a pre-formatted measurement ("1,842 ms", "12.4%", "8.6M", "52 GB")
 * into a comparable number. Returns `null` for anything it cannot read with
 * certainty — the meter is only drawn when both sides parse into the same
 * unit family, so a mismatch hides the bar instead of drawing a wrong one.
 */
function parseMeasure(raw: string): Measure | null {
  const m = MEASURE.exec(stripControl(raw));
  if (!m) return null;
  const n = Number(`${(m[1] ?? '').replace(/,/g, '')}${m[2] ?? ''}`);
  if (!Number.isFinite(n)) return null;
  const unit = m[3] ?? '';
  if (unit === '') return { value: n, family: 'number' };
  if (unit === '%') return { value: n, family: 'percent' };
  const lower = unit.toLowerCase();
  const time = TIME_MS[lower];
  if (time !== undefined) return { value: n * time, family: 'time' };
  const bytes = BYTES[lower];
  if (bytes !== undefined) return { value: n * bytes, family: 'bytes' };
  const count = COUNT[unit];
  if (count !== undefined) return { value: n * count, family: 'number' };
  return { value: n, family: `unit:${lower}` };
}

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
export function meter(input: { value: number; threshold: number; tone: Tone }): string {
  const { value, threshold } = input;
  if (!Number.isFinite(value) || !Number.isFinite(threshold) || value < 0 || threshold <= 0) return '';

  const fg = toneText(input.tone === 'neutral' || input.tone === 'brand' ? 'neutral' : input.tone);
  const scale = 90 / Math.max(value, threshold);
  const v = value * scale;
  const th = threshold * scale;

  type Segment = { pct: number; color: string } | 'tick';
  const raw: Segment[] =
    value > threshold
      ? [{ pct: th, color: palette.border2 }, 'tick', { pct: v - th, color: fg }, { pct: 100 - v, color: palette.bg3 }]
      : [{ pct: v, color: fg }, { pct: th - v, color: palette.bg3 }, 'tick', { pct: 100 - th, color: palette.bg3 }];
  const segments = raw.filter((s) => s === 'tick' || s.pct >= 0.5);

  const colored = segments.filter((s): s is { pct: number; color: string } => s !== 'tick');
  const firstBar = colored[0];
  const lastBar = colored[colored.length - 1];

  const row = (h: number, paintBar: boolean): string =>
    segments
      .map((s) => {
        if (s === 'tick') {
          return `<td width="2" height="${h}" bgcolor="${palette.text}" style="width:2px;height:${px(h)};background-color:${palette.text};font-size:1px;line-height:${px(h)};${LH}">&nbsp;</td>`;
        }
        const w = `${s.pct.toFixed(1)}%`;
        if (!paintBar) {
          return `<td width="${w}" height="${h}" style="width:${w};height:${px(h)};font-size:1px;line-height:${px(h)};${LH}">&nbsp;</td>`;
        }
        const r = s === firstBar && s === lastBar
          ? 'border-radius:3px;'
          : s === firstBar
            ? 'border-radius:3px 0 0 3px;'
            : s === lastBar
              ? 'border-radius:0 3px 3px 0;'
              : '';
        return `<td width="${w}" height="${h}" bgcolor="${s.color}" style="width:${w};height:${px(h)};background-color:${s.color};${r}font-size:1px;line-height:${px(h)};${LH}">&nbsp;</td>`;
      })
      .join('');

  return `<table ${T} aria-hidden="true" width="100%" style="${TABLE}width:100%;table-layout:fixed;">
  <tr>${row(5, false)}</tr>
  <tr>${row(6, true)}</tr>
  <tr>${row(5, false)}</tr>
</table>`;
}

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
export function readout(cells: ReadoutCell[], opts: { after?: string | undefined } = {}): string {
  if (cells.length === 0) return '';
  const peak = cells.length <= 2;
  const valueSize = peak ? size.readout : size.metric;
  const valueLh = peak ? 40 : 32;
  const sizeClass = peak ? 'sm-readout' : 'sm-metric';
  const stackOnMobile = cells.length >= 3;
  const width = Math.floor(100 / cells.length);

  const tds = cells
    .map((c, i) => {
      const first = i === 0;
      const last = i === cells.length - 1;
      const color = c.muted ? palette.text2 : c.tone === 'neutral' ? palette.text : toneText(c.tone);
      const rule = first ? '' : `border-left:1px solid ${palette.border};`;
      const pad = `padding:0 ${last ? 0 : 20}px 0 ${first ? 0 : 20}px;`;
      const classes = stackOnMobile ? ` class="sm-stack${first ? '' : ' sm-divider'}"` : '';
      return `
    <td${classes} width="${width}%" valign="bottom" style="${rule}${pad}">
      <div style="font-family:${font.sans};font-size:${px(size.label)};line-height:16px;${LH}color:${palette.text2};">${esc(c.label)}</div>
      <div class="${sizeClass}" style="padding-top:8px;font-family:${font.mono};font-size:${px(valueSize)};font-weight:500;line-height:${px(valueLh)};${LH}letter-spacing:-0.02em;color:${color};font-variant-numeric:tabular-nums;word-break:break-word;">${esc(c.value)}</div>
    </td>`;
    })
    .join('');

  const after = opts.after
    ? `\n  <tr><td colspan="${cells.length}" style="padding:22px 0 0;">${opts.after}</td></tr>`
    : '';

  return `<table ${T} width="100%" style="${TABLE}width:100%;">
  <tr>${tds}
  </tr>${after}
</table>`;
}

/**
 * The headline number of an alert: observed value against its threshold, with
 * the crossing drawn beneath. Showing both numbers means the reader never has
 * to infer the breach direction or magnitude; the meter shows it pre-verbally.
 */
export function metricCompare(input: {
  label: string;
  value: string;
  threshold: string;
  tone: Tone;
  thresholdLabel?: string | undefined;
  /** Further cells after the pair, e.g. a deviation or a utilization figure. */
  extra?: ReadoutCell[] | undefined;
}): string {
  const observed = parseMeasure(input.value);
  const limit = parseMeasure(input.threshold);
  const bar =
    observed && limit && observed.family === limit.family
      ? meter({ value: observed.value, threshold: limit.value, tone: input.tone })
      : '';
  return readout(
    [
      { label: input.label, value: input.value, tone: input.tone },
      { label: input.thresholdLabel ?? 'Threshold', value: input.threshold, muted: true },
      ...(input.extra ?? []),
    ],
    { after: bar },
  );
}

/**
 * Segmented track — an escalation policy's steps, drawn. Steps already taken
 * fill in the verdict colour; the rest stay on the track. Same 6px bar and
 * rounded ends as the threshold meter, so the two read as one instrument.
 */
export function stepTrack(input: { current: number; total: number; tone: Tone }): string {
  const total = Math.min(Math.max(Math.round(input.total), 1), 12);
  const current = Math.min(Math.max(Math.round(input.current), 0), total);
  if (!Number.isFinite(total) || !Number.isFinite(current)) return '';
  const fill = toneText(input.tone === 'neutral' || input.tone === 'brand' ? 'neutral' : input.tone);
  const cells: string[] = [];
  for (let i = 1; i <= total; i++) {
    const color = i <= current ? fill : palette.bg3;
    cells.push(
      `<td height="6" bgcolor="${color}" style="height:6px;background-color:${color};border-radius:3px;font-size:1px;line-height:6px;${LH}">&nbsp;</td>`,
    );
    if (i < total) {
      cells.push(`<td width="4" style="width:4px;font-size:1px;line-height:6px;${LH}">&nbsp;</td>`);
    }
  }
  return `<table ${T} aria-hidden="true" width="100%" style="${TABLE}width:100%;table-layout:fixed;">
  <tr>${cells.join('')}</tr>
</table>`;
}

/**
 * AI insight — the only cyan surface.
 *
 * If a reader sees cyan in a Pulsiv email, a model wrote that sentence. The
 * confidence score rides on the same line as the label, so the claim always
 * arrives with its own uncertainty attached.
 */
export function aiInsight(input: { text: string; confidence?: number | undefined }): string {
  const conf =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? `<td align="right" valign="middle" style="text-align:right;font-family:${font.mono};font-size:${px(size.label)};line-height:20px;${LH}color:${palette.ai};white-space:nowrap;">${esc(`${Math.round(input.confidence)}% confidence`)}</td>`
      : '';
  return `<table ${T} width="100%" bgcolor="${tint.ai}" style="${TABLE_ROUND}width:100%;background-color:${tint.ai};border:1px solid ${tintBorder.ai};border-radius:${radius.lg};">
  <tr>
    <td style="padding:15px 18px 17px;">
      <table ${T} width="100%" style="${TABLE}width:100%;">
        <tr>
          <td width="16" valign="middle" style="width:16px;">${dot(palette.ai, 6)}</td>
          <td valign="middle" style="font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:20px;${LH}color:${palette.ai};">AI insight</td>
          ${conf}
        </tr>
      </table>
      <div style="padding-top:8px;font-family:${font.sans};font-size:${px(size.body)};line-height:22px;${LH}color:${palette.text};">${esc(input.text)}</div>
    </td>
  </tr>
</table>`;
}

export interface DigestItem {
  severityLabel: string;
  tone: Tone;
  /** @deprecated Retained for compatibility; the list draws a status dot instead. */
  mark: string;
  title: string;
  meta: string;
}

/** Scannable alert list for the digest — hairline rows, a dot, the severity word in its colour. */
export function digestList(items: DigestItem[]): string {
  if (items.length === 0) return '';
  const rows = items
    .map((item, i) => {
      const color = toneText(item.tone);
      const rule = `${i === 0 ? `border-top:1px solid ${palette.border};` : ''}border-bottom:1px solid ${palette.border};`;
      return `  <tr>
    <td style="${rule}padding:13px 0;">
      <table ${T} width="100%" style="${TABLE}width:100%;">
        <tr>
          <td width="18" valign="top" style="width:18px;padding-top:7px;">${dot(color, 7)}</td>
          <td valign="top">
            <div style="font-family:${font.sans};font-size:${px(size.body)};font-weight:600;line-height:20px;${LH}color:${palette.text};">${esc(item.title)}</div>
            <div style="padding-top:3px;font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text3};"><span style="color:${color};">${esc(sentence(item.severityLabel))}</span>&nbsp;&middot;&nbsp;${esc(item.meta)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
    })
    .join('\n');

  return `<table ${T} width="100%" style="${TABLE}width:100%;">
${rows}
</table>`;
}

/** Counter strip for digests — a readout band of firing / resolved / acknowledged. */
export function statStrip(cells: { label: string; value: string; tone: Tone }[]): string {
  return readout(cells.map((c) => ({ label: c.label, value: c.value, tone: c.tone })));
}

/* ════════════════════════════════════════════════════════════════════════
   FOOTER
   ════════════════════════════════════════════════════════════════════════ */

export type FooterKind = 'security' | 'alert' | 'plain';

const FOOTER_BADGES: Record<Exclude<FooterKind, 'plain'>, string> = {
  security: 'MFA protected&nbsp;&nbsp;&middot;&nbsp;&nbsp;Encrypted in transit&nbsp;&nbsp;&middot;&nbsp;&nbsp;Audit logged',
  alert: 'Automated alert&nbsp;&nbsp;&middot;&nbsp;&nbsp;Deduplicated&nbsp;&nbsp;&middot;&nbsp;&nbsp;Audit logged',
};

/**
 * Provenance strip on the canvas colour, left-aligned like everything else on
 * the sheet. One wrapping text run per line so it reflows on a 320px viewport.
 */
function footerBlock(
  appName: string,
  kind: FooterKind,
  footerLink: { url: string; label: string } | undefined,
): string {
  const noteText =
    kind === 'alert'
      ? `Automated notification from ${esc(appName)}. Replies are not monitored.`
      : kind === 'security'
        ? `Security notification from ${esc(appName)}.`
        : `Sent by ${esc(appName)}.`;

  const badges =
    kind === 'plain'
      ? ''
      : `<div style="padding-top:4px;font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text3};">${FOOTER_BADGES[kind]}</div>`;

  const linkHtml = footerLink
    ? `<div style="padding-top:14px;font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}"><a class="pl-link" href="${safeUrl(footerLink.url)}" style="color:${palette.text2};text-decoration:underline;">${esc(footerLink.label)}</a></div>`
    : '';

  return `<tr>
  <td class="sm-pad dm-bg-deep" bgcolor="${palette.bg}" style="background-color:${palette.bg};border-top:1px solid ${palette.border};border-radius:0 0 9px 9px;padding:22px ${px(layout.pad)} 24px;">
    <div style="font-family:${font.sans};font-size:${px(size.label)};line-height:18px;${LH}color:${palette.text2};">${noteText}</div>${badges}${linkHtml}
  </td>
</tr>`;
}

/* ════════════════════════════════════════════════════════════════════════
   PREHEADER
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Hidden inbox-preview line.
 *
 * Without it the client scrapes the first visible words — usually "Hi," — and
 * the preview is wasted. The trailing zero-width entities pad the snippet so
 * body copy cannot bleed in behind the intended text.
 */
function preheaderBlock(text: string): string {
  const pad = '&#847;&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${palette.bg};">${esc(text)}${pad}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   PROGRESSIVE-ENHANCEMENT STYLESHEET
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Nothing in here is load-bearing — strip the whole block and the email still
 * renders correctly, just without the mobile refinements.
 *
 * - `color-scheme` / `supported-color-schemes` tell Apple Mail and Gmail the
 *   design is already dark, so they skip their auto-inversion pass.
 * - `[data-ogsc]` / `[data-ogsb]` are the hooks Outlook.com injects when it
 *   rewrites colours for dark mode; re-asserting the palette there prevents a
 *   half-inverted, unreadable render.
 * - Selection and hover are themed from the palette, like the console's own
 *   browser surfaces, in the clients that honour them.
 * - Motion is one authored moment — the sheet settles 8px into place from an
 *   already-visible start — and is disabled under `prefers-reduced-motion`.
 */
function styleBlock(): string {
  return `<style type="text/css">
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    a { text-decoration:none; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    ::selection { background-color:${palette.text}; color:${palette.bg}; }
    code, kbd, samp, pre { font-family:${font.mono}; font-variant-numeric:tabular-nums; }
    .pl-sheet { animation:pl-settle 560ms cubic-bezier(0.16,1,0.3,1) both; }
    @keyframes pl-settle { from { transform:translateY(8px); } to { transform:none; } }
    @media (prefers-reduced-motion:reduce) { .pl-sheet { animation:none !important; } }
    .pl-btn-primary:hover { background-color:${palette.brandD} !important; border-color:${palette.brandD} !important; }
    .pl-btn-danger:hover { border-color:${palette.red} !important; }
    .pl-btn-ghost:hover { background-color:${palette.bg2} !important; border-color:${palette.text3} !important; }
    .pl-link:hover { color:${palette.text} !important; }
    a:focus-visible { outline:2px solid ${palette.text}; outline-offset:3px; border-radius:${radius.sm}; }

    /* Outlook.com dark mode — re-assert the palette it tries to rewrite. */
    [data-ogsc] .dm-bg, [data-ogsb] .dm-bg { background-color:${palette.bg1} !important; }
    [data-ogsc] .dm-bg-deep, [data-ogsb] .dm-bg-deep { background-color:${palette.bg} !important; }
    [data-ogsc] .dm-text { color:${palette.text} !important; }
    [data-ogsc] .dm-text2 { color:${palette.text2} !important; }

    @media only screen and (max-width:620px) {
      .sm-canvas { padding:12px 8px 24px !important; }
      .sm-full { width:100% !important; max-width:100% !important; }
      .sm-pad { padding-left:${px(layout.padMobile)} !important; padding-right:${px(layout.padMobile)} !important; }
      .sm-title { font-size:${px(size.titleSm)} !important; line-height:30px !important; }
      .sm-readout { font-size:${px(size.readoutSm)} !important; line-height:32px !important; }
      .sm-metric { font-size:${px(size.metricSm)} !important; line-height:28px !important; }
      .sm-otp { font-size:${px(size.otpSm)} !important; line-height:34px !important; letter-spacing:0.3em !important; padding-left:0.3em !important; }
      .sm-stack { display:block !important; width:100% !important; box-sizing:border-box !important; }
      .sm-flush { padding:0 !important; }
      .sm-stack-top { padding:10px 0 0 0 !important; }
      .sm-divider { border-left:0 !important; border-top:1px solid ${palette.border} !important; padding:14px 0 0 0 !important; margin-top:14px !important; }
      .sm-meta { display:block !important; width:100% !important; box-sizing:border-box !important; text-align:left !important; padding:4px 0 0 18px !important; white-space:normal !important; }
      .sm-btn { width:100% !important; }
      .sm-btn a { display:block !important; padding-left:0 !important; padding-right:0 !important; }
      .sm-hide { display:none !important; }
    }
  </style>`;
}

/* ════════════════════════════════════════════════════════════════════════
   LAYOUT
   ════════════════════════════════════════════════════════════════════════ */

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
  footerLink?: { url: string; label: string } | undefined;
  /** Closing note under the body. Pass `null` to omit. */
  closing?: string | null | undefined;
}

const DEFAULT_CLOSING =
  'If you did not request this, secure your account and contact support immediately.';

const VERDICT_TONES: ReadonlySet<Tone> = new Set<Tone>(['success', 'danger', 'warning', 'info', 'ai']);

function headerStrip(context: string): string {
  const contextHtml = context
    ? `<td align="right" valign="middle" style="padding-left:16px;text-align:right;font-family:${font.sans};font-size:${px(size.label)};line-height:16px;${LH}color:${palette.text3};">${esc(context)}</td>`
    : '';
  return `<tr>
            <td class="sm-pad" style="padding:18px ${px(layout.pad)};border-bottom:1px solid ${palette.border};">
              <table ${T} width="100%" style="${TABLE}width:100%;">
                <tr>
                  <td valign="middle">${logoLockup()}</td>${contextHtml}
                </tr>
              </table>
            </td>
          </tr>`;
}

function stateLine(status: LayoutStatus): string {
  const t = toneStyle(status.tone);
  const fg = toneText(status.tone);
  const meta = status.meta
    ? `<td class="sm-meta" align="right" valign="middle" style="padding-left:16px;text-align:right;font-family:${font.mono};font-size:${px(size.label)};line-height:20px;${LH}color:${palette.text2};">${esc(status.meta)}</td>`
    : '';
  return `<tr>
            <td class="sm-pad" bgcolor="${t.bg}" style="background-color:${t.bg};border-bottom:1px solid ${t.border};padding:12px ${px(layout.pad)};">
              <table ${T} width="100%" style="${TABLE}width:100%;">
                <tr>
                  <td class="sm-stack" valign="middle">
                    <table ${T} style="${TABLE}">
                      <tr>
                        <td width="18" valign="middle" style="width:18px;">${dot(fg, 8)}</td>
                        <td valign="middle" style="font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:20px;${LH}color:${fg};">${esc(status.label)}</td>
                      </tr>
                    </table>
                  </td>${meta}
                </tr>
              </table>
            </td>
          </tr>`;
}

function heroBand(html: string): string {
  return `<tr>
            <td style="padding:28px 0 0;">
              <table ${T} width="100%" bgcolor="${palette.bg}" class="dm-bg-deep" style="${TABLE}width:100%;background-color:${palette.bg};">
                <tr>
                  <td class="sm-pad" style="border-top:1px solid ${palette.border};border-bottom:1px solid ${palette.border};padding:24px ${px(layout.pad)} 26px;">${html}</td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/**
 * The single email shell every template renders into. See the anatomy at the
 * top of this file.
 *
 * The `[if mso]` wrapper table pins the width for Outlook, which ignores
 * `max-width`; every other client uses the fluid `max-width` table.
 */
export function renderLayout(opts: LayoutOptions): string {
  const context = opts.context ?? opts.eyebrowText ?? '';
  const status: LayoutStatus | undefined =
    opts.status ??
    (opts.tone && VERDICT_TONES.has(opts.tone) && context
      ? { label: context, tone: opts.tone }
      : undefined);
  // A state line that repeats the header context says nothing new.
  const headerContext = status && !opts.status ? '' : context;

  const closingHtml = opts.closing === null ? '' : note(esc(opts.closing ?? DEFAULT_CLOSING));
  // `stack()` leaves no trailing gap on its last surface, so the closing note
  // has to supply the separation itself.
  const bodyHtml = closingHtml ? `${block(opts.body, 28)}\n${closingHtml}` : opts.body;
  const w = layout.width;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
  <title>${esc(opts.title)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500;600&amp;family=Space+Grotesk:wght@600;700&amp;display=swap" rel="stylesheet" /><!--<![endif]-->
${styleBlock()}
</head>
<body class="dm-bg-deep" style="margin:0;padding:0;width:100%;background-color:${palette.bg};font-family:${font.sans};color:${palette.text2};">
${preheaderBlock(opts.preheader)}
  <table ${T} width="100%" class="dm-bg-deep" bgcolor="${palette.bg}" style="${TABLE}width:100%;background-color:${palette.bg};">
    <tr>
      <td class="sm-canvas" align="center" style="padding:40px 16px 48px;">
        <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${w}"><tr><td><![endif]-->
        <table ${T} width="100%" class="pl-sheet sm-full dm-bg" bgcolor="${palette.bg1}" style="${TABLE_ROUND}width:100%;max-width:${px(w)};background-color:${palette.bg1};border:1px solid ${palette.border};border-radius:${radius.lg};">
          ${headerStrip(headerContext)}
          ${status ? stateLine(status) : ''}
          <tr>
            <td class="sm-pad" style="padding:32px ${px(layout.pad)} 0;">
              <h1 class="sm-title dm-text" style="margin:0;padding:0;font-family:${font.sans};font-size:${px(size.title)};font-weight:600;letter-spacing:-0.03em;line-height:34px;${LH}color:${palette.text};text-wrap:balance;word-break:break-word;overflow-wrap:anywhere;">${esc(opts.title)}</h1>
            </td>
          </tr>
          ${opts.hero ? heroBand(opts.hero) : ''}
          <tr>
            <td class="sm-pad dm-text2" style="padding:${opts.hero ? 28 : 24}px ${px(layout.pad)} 40px;">
${bodyHtml}
            </td>
          </tr>
${footerBlock(opts.appName, opts.footer ?? 'security', opts.footerLink)}
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ════════════════════════════════════════════════════════════════════════
   PLAINTEXT HELPERS
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Plaintext is a first-class body, not an afterthought: it is what screen
 * readers, `text/plain`-only clients, smartwatch previews and spam scanners
 * read. A missing or degenerate text part measurably hurts deliverability.
 */
export function textBody(...blocks: (string | null | undefined | false)[]): string {
  return blocks
    .filter((b): b is string => typeof b === 'string' && b.length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Aligned `LABEL   value` block for plaintext bodies. */
export function textRows(rows: { label: string; value: string }[]): string {
  const width = rows.reduce((max, r) => Math.max(max, r.label.length), 0);
  return rows.map((r) => `${r.label.toUpperCase().padEnd(width)}  ${stripControl(r.value)}`).join('\n');
}

/** Horizontal rule for plaintext bodies. */
export const TEXT_RULE = '------------------------------------------------------';

export function textGreeting(userName?: string | undefined): string {
  const name = stripControl(userName).trim();
  return name ? `Hi ${name},` : 'Hi,';
}
