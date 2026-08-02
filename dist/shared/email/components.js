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
import { font, layout, palette, radius, shadow, size, tint, toneStyle, } from './theme.js';
/* ════════════════════════════════════════════════════════════════════════
   ESCAPING & URL SAFETY
   ════════════════════════════════════════════════════════════════════════ */
/** Escape a value for interpolation into HTML text or an attribute. */
export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
/** Strip control characters that would corrupt a header or a plaintext body. */
export function stripControl(value) {
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
export function safeUrl(url) {
    const trimmed = stripControl(url).trim();
    if (!SAFE_SCHEME.test(trimmed))
        return '#';
    return esc(trimmed);
}
/** Scheme-checked but unescaped URL — for plaintext bodies. */
export function safeUrlText(url) {
    const trimmed = stripControl(url).trim();
    return SAFE_SCHEME.test(trimmed) ? trimmed : '';
}
/* ════════════════════════════════════════════════════════════════════════
   SHARED STYLE FRAGMENTS
   ════════════════════════════════════════════════════════════════════════ */
/** Reset a layout table so Outlook does not inject its own spacing. */
const TABLE = 'border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;';
/** Outlook rounds line-height up unless told to honour it exactly. */
const LH = 'mso-line-height-rule:exactly;';
function px(n) {
    return `${n}px`;
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
export function block(html, gap = 22) {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr><td style="padding:0 0 ${px(gap)};">${html}</td></tr>
</table>`;
}
/** Join surfaces with a uniform gap. The final surface gets no trailing gap. */
export function stack(blocks, gap = 20) {
    const items = blocks.filter((b) => typeof b === 'string' && b.length > 0);
    return items.map((html, i) => (i === items.length - 1 ? html : block(html, gap))).join('\n');
}
/* ════════════════════════════════════════════════════════════════════════
   TEXT
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Body paragraph. Hierarchy is weight and tint, never extra colours (§4).
 *
 * The bottom margin defaults to zero because paragraphs are composed through
 * `stack()`, which owns the vertical rhythm. A non-zero default would add to
 * the stack gap and double the spacing.
 */
export function p(html, opts = {}) {
    const color = opts.muted ? palette.text3 : palette.text2;
    const mb = opts.bottom ?? 0;
    return `<p style="margin:0 0 ${px(mb)};padding:0;font-family:${font.sans};font-size:${px(size.body)};line-height:22px;${LH}color:${color};">${html}</p>`;
}
/** Inline link in the brand channel (white in Mono). */
export function link(url, label) {
    return `<a href="${safeUrl(url)}" style="color:${palette.text};text-decoration:underline;">${esc(label)}</a>`;
}
/** Emphasis without a colour change — weight only (§4 text-clarity rule). */
export function strong(text) {
    return `<strong style="font-weight:600;color:${palette.text};">${esc(text)}</strong>`;
}
/** Mono uppercase eyebrow label (§4). */
export function eyebrow(text, color = palette.text3) {
    return `<div style="font-family:${font.mono};font-size:${px(size.eyebrow)};line-height:14px;${LH}letter-spacing:0.1em;text-transform:uppercase;color:${color};">${esc(text)}</div>`;
}
/** Section heading inside the body — Inter 600 (§4 card/panel title). */
export function heading(text) {
    return `<div style="font-family:${font.sans};font-size:${px(size.cardTitle)};font-weight:600;line-height:21px;${LH}color:${palette.text};padding-bottom:10px;">${esc(text)}</div>`;
}
/* ════════════════════════════════════════════════════════════════════════
   BRAND MARK
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Logo lockup: a 30px rounded tile carrying the `P` monogram plus the wordmark.
 *
 * The tile is the one place the design system permits a linear gradient
 * (§3 — brand → AI, i.e. white → cyan in Mono). `background-color` is declared
 * first so Outlook, which ignores `background-image`, lands on solid white
 * instead of transparent.
 */
function logoLockup() {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
  <tr>
    <td width="30" height="30" align="center" valign="middle" bgcolor="${palette.brand}" style="width:30px;height:30px;background-color:${palette.brand};background-image:linear-gradient(135deg,${palette.brand} 0%,${palette.ai} 100%);border-radius:7px;text-align:center;vertical-align:middle;font-family:${font.display};font-size:17px;font-weight:700;line-height:30px;${LH}color:${palette.brandFg};">P</td>
    <td style="padding-left:11px;vertical-align:middle;font-family:${font.display};font-size:18px;font-weight:600;letter-spacing:-0.02em;line-height:30px;${LH}color:${palette.text};">Pulsiv</td>
  </tr>
</table>`;
}
/* ════════════════════════════════════════════════════════════════════════
   GLYPH CHIP  —  replaces the old (invisible) SVG hero icons
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Marks restricted to characters present in the websafe core fonts, so they
 * render in Outlook 2016 and Gmail alike. Emoji are deliberately excluded:
 * they render full-colour and destroy the mono register.
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
};
/**
 * Tinted square chip holding one glyph — the modern replacement for the old
 * circular SVG hero icon. `border-radius` degrades to a square in Outlook,
 * which is a graceful loss rather than a missing element.
 */
export function glyphChip(mark, tone) {
    const t = toneStyle(tone);
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
  <tr>
    <td width="40" height="40" align="center" valign="middle" bgcolor="${t.bg}" style="width:40px;height:40px;background-color:${t.bg};border:1px solid ${t.border};border-radius:${radius.lg};text-align:center;vertical-align:middle;font-family:${font.mono};font-size:15px;font-weight:500;line-height:38px;${LH}color:${t.fg};">${mark}</td>
  </tr>
</table>`;
}
/* ════════════════════════════════════════════════════════════════════════
   BUTTONS
   ════════════════════════════════════════════════════════════════════════ */
/** Approximate a label's rendered width so VML can be given a fixed px value. */
function vmlWidth(label) {
    return Math.max(150, Math.round(label.length * 8.4) + 44);
}
/**
 * Bulletproof CTA.
 *
 * Outlook ignores padding on `<a>`, so the anchor is mirrored by a VML
 * `roundrect` inside an `[if mso]` branch — the standard bulletproof-button
 * pattern. `<w:anchorlock/>` stops Outlook turning the shape into a
 * text-selectable region.
 */
export function button(url, label, opts = {}) {
    const variant = opts.variant ?? 'primary';
    const t = toneStyle(opts.tone ?? 'brand');
    const href = safeUrl(url);
    const text = esc(label);
    const w = vmlWidth(label);
    const fill = variant === 'primary' ? t.fg : t.bg;
    const fg = variant === 'primary' ? t.on : t.fg;
    const stroke = variant === 'primary' ? fill : t.border;
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
  <tr>
    <td align="center" bgcolor="${fill}" style="background-color:${fill};border:1px solid ${stroke};border-radius:${radius.md};">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:${w}px;" arcsize="14%" stroke="f" fillcolor="${fill}"><w:anchorlock/><center style="color:${fg};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">${text}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${font.sans};font-size:${px(size.body)};font-weight:600;line-height:18px;${LH}color:${fg};text-decoration:none;border-radius:${radius.md};">${text}</a><!--<![endif]-->
    </td>
  </tr>
</table>`;
}
/**
 * Primary + secondary CTAs side by side, stacking under 620px.
 *
 * Alerts always offer two paths — the destination and the mitigation
 * ("View alert" / "Acknowledge") — because an on-call reader is triaging, not
 * browsing.
 */
export function buttonRow(primary, secondary) {
    const primaryOpts = primary.tone ? { tone: primary.tone } : {};
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
  <tr>
    <td class="sm-stack" valign="top" style="padding:0 10px 0 0;">${button(primary.url, primary.label, primaryOpts)}</td>
    <td class="sm-stack sm-stack-top" valign="top" style="padding:0;">${button(secondary.url, secondary.label, { variant: 'ghost', tone: 'neutral' })}</td>
  </tr>
</table>`;
}
/* ════════════════════════════════════════════════════════════════════════
   SURFACES
   ════════════════════════════════════════════════════════════════════════ */
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
export function linkFallback(url, label = 'Or paste this link into your browser') {
    const safe = safeUrlText(url);
    if (!safe)
        return '';
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr><td style="padding:0 0 8px;">${eyebrow(label)}</td></tr>
  <tr>
    <td bgcolor="${palette.bg}" style="background-color:${palette.bg};border:1px solid ${palette.border};border-radius:${radius.md};padding:13px 14px;font-family:${font.mono};font-size:${px(size.monoData)};line-height:19px;${LH}color:${palette.text3};word-break:break-all;">${esc(safe)}</td>
  </tr>
</table>`;
}
/**
 * Left-ruled callout.
 *
 * The 3px rule in the tone colour is the same device the app uses for selected
 * rows and anomaly rows (§6, §7), so a warning in an email reads exactly the
 * way it reads in the product.
 */
export function callout(tone, html, title) {
    const t = toneStyle(tone);
    const heading2 = title
        ? `<div style="font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:18px;${LH}color:${t.fg};padding-bottom:5px;">${esc(title)}</div>`
        : '';
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr>
    <td width="3" bgcolor="${t.fg}" style="width:3px;background-color:${t.fg};font-size:0;line-height:0;">&nbsp;</td>
    <td bgcolor="${t.bg}" style="background-color:${t.bg};padding:13px 16px;font-family:${font.sans};font-size:${px(size.ui)};line-height:20px;${LH}color:${palette.text2};">${heading2}${html}</td>
  </tr>
</table>`;
}
/** Monospace code / token block. */
export function codeBlock(value) {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr>
    <td bgcolor="${palette.bg2}" style="background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.md};padding:14px 16px;font-family:${font.mono};font-size:${px(size.monoData)};line-height:20px;${LH}color:${palette.text2};word-break:break-all;">${esc(value)}</td>
  </tr>
</table>`;
}
/**
 * One-time-code display. Mono, wide tracking, tabular figures — the same
 * treatment metric values get in the product.
 */
export function otpBlock(code) {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr>
    <td align="center" bgcolor="${palette.bg2}" style="background-color:${palette.bg2};border:1px solid ${palette.border2};border-radius:${radius.lg};padding:22px 12px;text-align:center;">
      <div class="sm-otp" style="font-family:${font.mono};font-size:32px;font-weight:500;line-height:38px;${LH}letter-spacing:0.26em;color:${palette.text};font-variant-numeric:tabular-nums;">${esc(code)}</div>
    </td>
  </tr>
</table>`;
}
/** Status pill — tinted bg + saturated text, mono uppercase (§7). */
export function pill(label, tone) {
    const t = toneStyle(tone);
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
  <tr>
    <td bgcolor="${t.bg}" style="background-color:${t.bg};border:1px solid ${t.border};border-radius:${radius.pill};padding:5px 13px;font-family:${font.mono};font-size:${px(size.micro)};font-weight:500;line-height:13px;${LH}letter-spacing:0.09em;text-transform:uppercase;color:${t.fg};white-space:nowrap;">${esc(label)}</td>
  </tr>
</table>`;
}
/** Hairline divider. */
export function divider() {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
  <tr><td height="1" bgcolor="${palette.border}" style="height:1px;background-color:${palette.border};line-height:1px;font-size:0;">&nbsp;</td></tr>
</table>`;
}
/**
 * Definition table for alert context — rule, project, metric, threshold,
 * fingerprint, timestamps.
 *
 * Two fixed columns rather than a stacking grid: at 11px mono the labels stay
 * under ~105px even on a 320px viewport, so the pairing survives without a
 * breakpoint and without the double-hairline artefact that stacking produces.
 */
export function dataTable(rows) {
    if (rows.length === 0)
        return '';
    const body = rows
        .map((row, i) => {
        const t = row.tone ? toneStyle(row.tone) : null;
        const valueColor = t ? t.fg : palette.text;
        const family = row.sans ? font.sans : font.mono;
        const rule = i === 0 ? '' : `border-top:1px solid ${palette.border};`;
        return `  <tr>
    <td width="36%" valign="top" style="${rule}padding:11px 12px 11px 16px;font-family:${font.mono};font-size:${px(size.eyebrow)};line-height:18px;${LH}letter-spacing:0.07em;text-transform:uppercase;color:${palette.text3};">${esc(row.label)}</td>
    <td valign="top" style="${rule}padding:11px 16px 11px 0;font-family:${family};font-size:${px(size.monoData)};font-weight:500;line-height:18px;${LH}color:${valueColor};word-break:break-word;font-variant-numeric:tabular-nums;">${esc(row.value)}</td>
  </tr>`;
    })
        .join('\n');
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${palette.bg2}" style="${TABLE}width:100%;background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.lg};">
${body}
</table>`;
}
/**
 * The headline number of an alert: observed value against its threshold.
 *
 * Mono 30px for the value (§4 "page metric"). Showing both numbers side by side
 * means the reader never has to infer the breach direction or magnitude.
 */
export function metricCompare(input) {
    const t = toneStyle(input.tone);
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${palette.bg2}" style="${TABLE}width:100%;background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.lg};">
  <tr>
    <td class="sm-stack" width="50%" valign="top" style="padding:18px 16px 18px 20px;">
      ${eyebrow(input.label)}
      <div style="padding-top:7px;font-family:${font.mono};font-size:${px(size.metric)};font-weight:500;line-height:34px;${LH}letter-spacing:-0.02em;color:${t.fg};font-variant-numeric:tabular-nums;">${esc(input.value)}</div>
    </td>
    <td class="sm-stack sm-divider" width="50%" valign="top" style="padding:18px 20px 18px 16px;border-left:1px solid ${palette.border};">
      ${eyebrow(input.thresholdLabel ?? 'Threshold')}
      <div style="padding-top:7px;font-family:${font.mono};font-size:${px(size.metric)};font-weight:500;line-height:34px;${LH}letter-spacing:-0.02em;color:${palette.text3};font-variant-numeric:tabular-nums;">${esc(input.threshold)}</div>
    </td>
  </tr>
</table>`;
}
/**
 * AI insight card — the signature component (§7).
 *
 * Cyan is rationed to model output only: if a reader sees cyan in a Pulsiv
 * email, a model wrote that sentence. The confidence pill is mandatory when a
 * score exists, so the claim always arrives with its own uncertainty attached.
 */
export function aiInsight(input) {
    const confRow = typeof input.confidence === 'number'
        ? `<tr><td style="padding:12px 0 0;">${pill(`${Math.round(input.confidence)}% confidence`, 'ai')}</td></tr>`
        : '';
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${tint.ai}" style="${TABLE}width:100%;background-color:${tint.ai};border:1px solid ${toneStyle('ai').border};border-radius:${radius.lg};">
  <tr>
    <td style="padding:16px 18px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
        <tr>
          <td width="22" height="22" align="center" valign="middle" bgcolor="${palette.ai}" style="width:22px;height:22px;background-color:${palette.ai};border-radius:6px;text-align:center;vertical-align:middle;font-family:${font.mono};font-size:12px;line-height:22px;${LH}color:${palette.aiFg};">${glyph.spark}</td>
          <td style="padding-left:10px;vertical-align:middle;font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:22px;${LH}color:${palette.ai};">AI insight</td>
        </tr>
      </table>
      <div style="padding-top:11px;font-family:${font.sans};font-size:${px(size.ui)};line-height:20px;${LH}color:${palette.text2};">${esc(input.text)}</div>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">${confRow}</table>
    </td>
  </tr>
</table>`;
}
/** Compact scannable alert list used by the digest template. */
export function digestList(items) {
    if (items.length === 0)
        return '';
    const rows = items
        .map((item, i) => {
        const t = toneStyle(item.tone);
        const rule = i === 0 ? '' : `border-top:1px solid ${palette.border};`;
        return `  <tr>
    <td style="${rule}padding:13px 16px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
        <tr>
          <td width="22" valign="top" style="padding:1px 0 0;font-family:${font.mono};font-size:13px;line-height:18px;${LH}color:${t.fg};">${item.mark}</td>
          <td valign="top">
            <div style="font-family:${font.sans};font-size:${px(size.ui)};font-weight:600;line-height:18px;${LH}color:${palette.text};">${esc(item.title)}</div>
            <div style="padding-top:4px;font-family:${font.mono};font-size:${px(size.micro)};line-height:15px;${LH}letter-spacing:0.05em;color:${palette.text3};">${esc(item.severityLabel.toUpperCase())} &middot; ${esc(item.meta)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
    })
        .join('\n');
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${palette.bg2}" style="${TABLE}width:100%;background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.lg};">
${rows}
</table>`;
}
/** Three-up counter strip for digests — firing / resolved / acknowledged. */
export function statStrip(cells) {
    if (cells.length === 0)
        return '';
    const tds = cells
        .map((cell, i) => {
        const t = toneStyle(cell.tone);
        const rule = i === 0 ? '' : `border-left:1px solid ${palette.border};`;
        return `    <td class="sm-stack sm-divider" valign="top" align="center" style="${rule}padding:16px 10px;text-align:center;">
      <div style="font-family:${font.mono};font-size:26px;font-weight:500;line-height:30px;${LH}color:${t.fg};font-variant-numeric:tabular-nums;">${esc(cell.value)}</div>
      <div style="padding-top:6px;font-family:${font.mono};font-size:${px(size.micro)};line-height:14px;${LH}letter-spacing:0.09em;text-transform:uppercase;color:${palette.text3};">${esc(cell.label)}</div>
    </td>`;
    })
        .join('\n');
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${palette.bg2}" style="${TABLE}width:100%;background-color:${palette.bg2};border:1px solid ${palette.border};border-radius:${radius.lg};">
  <tr>
${tds}
  </tr>
</table>`;
}
const FOOTER_BADGES = {
    security: 'MFA protected &nbsp;&middot;&nbsp; Encrypted in transit &nbsp;&middot;&nbsp; Audit logged',
    alert: 'Automated alert &nbsp;&middot;&nbsp; Deduplicated &nbsp;&middot;&nbsp; Audit logged',
};
/**
 * Trust line. Rendered as one wrapping text run rather than a multi-cell table
 * so it reflows on a 320px viewport instead of overflowing.
 */
function footerBlock(appName, kind, footerLink) {
    const badgeRow = kind === 'plain'
        ? ''
        : `<tr><td align="center" style="text-align:center;padding:0 0 12px;font-family:${font.mono};font-size:${px(size.micro)};line-height:17px;${LH}letter-spacing:0.07em;text-transform:uppercase;color:${palette.text3};">${FOOTER_BADGES[kind]}</td></tr>`;
    const linkRow = footerLink
        ? `<tr><td align="center" style="text-align:center;padding:12px 0 0;font-family:${font.sans};font-size:${px(size.micro)};line-height:16px;${LH}color:${palette.text3};"><a href="${safeUrl(footerLink.url)}" style="color:${palette.text2};text-decoration:underline;">${esc(footerLink.label)}</a></td></tr>`
        : '';
    const note = kind === 'alert'
        ? `Automated notification from ${esc(appName)}. Replies are not monitored.`
        : kind === 'security'
            ? `Security notification from ${esc(appName)}.`
            : `Sent by ${esc(appName)}.`;
    return `<tr>
  <td class="sm-pad dm-bg-deep" bgcolor="${palette.bg}" style="background-color:${palette.bg};border-top:1px solid ${palette.border};padding:22px ${px(layout.pad)};">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="${TABLE}width:100%;">
      ${badgeRow}
      <tr><td align="center" style="text-align:center;font-family:${font.mono};font-size:${px(size.micro)};line-height:16px;${LH}color:${palette.text3};">${note}</td></tr>
      ${linkRow}
    </table>
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
function preheaderBlock(text) {
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
 * - Motion is one subtle entrance and is disabled under
 *   `prefers-reduced-motion` (§9 of the design system: motion is functional).
 */
function styleBlock() {
    return `<style type="text/css">
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    a { text-decoration:none; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    .pl-card { animation:pl-rise 420ms cubic-bezier(0.16,1,0.3,1) both; }
    @keyframes pl-rise { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
    @media (prefers-reduced-motion:reduce) { .pl-card { animation:none !important; } }

    /* Outlook.com dark mode — re-assert the palette it tries to rewrite. */
    [data-ogsc] .dm-bg, [data-ogsb] .dm-bg { background-color:${palette.bg1} !important; }
    [data-ogsc] .dm-bg-deep, [data-ogsb] .dm-bg-deep { background-color:${palette.bg} !important; }
    [data-ogsc] .dm-text { color:${palette.text} !important; }
    [data-ogsc] .dm-text2 { color:${palette.text2} !important; }

    @media only screen and (max-width:620px) {
      .sm-full { width:100% !important; max-width:100% !important; }
      .sm-pad { padding-left:22px !important; padding-right:22px !important; }
      .sm-title { font-size:20px !important; line-height:27px !important; }
      .sm-otp { font-size:26px !important; letter-spacing:0.18em !important; }
      .sm-stack { display:block !important; width:100% !important; box-sizing:border-box !important; }
      .sm-stack-top { padding:10px 0 0 0 !important; }
      .sm-divider { border-left:0 !important; }
      .sm-hide { display:none !important; }
    }
  </style>`;
}
const DEFAULT_CLOSING = 'If you did not request this, secure your account and contact support immediately.';
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
export function renderLayout(opts) {
    const tone = opts.tone ?? 'brand';
    const t = toneStyle(tone);
    const chipHtml = opts.chip ? block(glyphChip(opts.chip, tone), 18) : '';
    const closingHtml = opts.closing === null ? '' : p(esc(opts.closing ?? DEFAULT_CLOSING), { muted: true });
    // `stack()` leaves no trailing gap on its last surface, so the closing note
    // has to supply the separation itself.
    const bodyHtml = closingHtml ? `${block(opts.body, 26)}\n${closingHtml}` : opts.body;
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
  <!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;family=Space+Grotesk:wght@600;700&amp;display=swap" rel="stylesheet" /><!--<![endif]-->
${styleBlock()}
</head>
<body class="dm-bg-deep" style="margin:0;padding:0;width:100%;background-color:${palette.bg};font-family:${font.sans};color:${palette.text2};">
${preheaderBlock(opts.preheader)}
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="dm-bg-deep" bgcolor="${palette.bg}" style="${TABLE}width:100%;background-color:${palette.bg};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${w}"><tr><td><![endif]-->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="pl-card sm-full dm-bg" bgcolor="${palette.bg1}" style="${TABLE}width:100%;max-width:${px(w)};background-color:${palette.bg1};border:1px solid ${palette.border};border-radius:${radius.lg};box-shadow:${shadow.card};">

          <tr><td height="3" bgcolor="${t.fg}" style="height:3px;background-color:${t.fg};line-height:3px;font-size:0;">&nbsp;</td></tr>

          <tr>
            <td class="sm-pad" style="padding:26px ${px(layout.pad)} 22px;border-bottom:1px solid ${palette.border};">
              ${logoLockup()}
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
                <tr><td height="22" style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>
              </table>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="${TABLE}">
                <tr>
                  <td width="7" height="7" bgcolor="${t.fg}" style="width:7px;height:7px;background-color:${t.fg};border-radius:50%;font-size:0;line-height:7px;">&nbsp;</td>
                  <td style="padding-left:9px;">${eyebrow(opts.eyebrowText, t.fg)}</td>
                </tr>
              </table>
              <h1 class="sm-title dm-text" style="margin:11px 0 0;padding:0;font-family:${font.display};font-size:${px(size.title)};font-weight:600;letter-spacing:-0.02em;line-height:31px;${LH}color:${palette.text};">${esc(opts.title)}</h1>
            </td>
          </tr>

          <tr>
            <td class="sm-pad dm-text2" style="padding:28px ${px(layout.pad)} 30px;">
${chipHtml}${bodyHtml}
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
export function textBody(...blocks) {
    return blocks
        .filter((b) => typeof b === 'string' && b.length > 0)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Aligned `LABEL   value` block for plaintext bodies. */
export function textRows(rows) {
    const width = rows.reduce((max, r) => Math.max(max, r.label.length), 0);
    return rows.map((r) => `${r.label.toUpperCase().padEnd(width)}  ${stripControl(r.value)}`).join('\n');
}
/** Horizontal rule for plaintext bodies. */
export const TEXT_RULE = '------------------------------------------------------';
export function textGreeting(userName) {
    const name = stripControl(userName).trim();
    return name ? `Hi ${name},` : 'Hi,';
}
//# sourceMappingURL=components.js.map