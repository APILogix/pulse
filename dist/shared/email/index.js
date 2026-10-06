/**
 * Email module barrel — templates and design system only.
 *
 * Import from here for anything new:
 *
 *   import { alertFiringTemplate } from '../../shared/email/index.js';
 *
 * Existing call sites that import `./templates.js` directly keep working; this
 * barrel is additive, not a migration.
 *
 * Transport (`./mailer.js`, `./email.service.js`) is deliberately NOT re-exported
 * here. `mailer.ts` imports `config/env.js`, which validates the process
 * environment at import time — routing that through the barrel would mean a unit
 * test or a preview script could not render a template without a fully
 * configured SMTP environment. Import the transport from its own module.
 */
/* ── Design tokens ── */
export { font, palette, radius, severityGlyph, severityTone, size, tint, tintBorder, toneStyle, tones, } from './theme.js';
/* ── Component library (for one-off surfaces) ── */
export { aiInsight, block, button, buttonRow, callout, code, codeBlock, dataTable, digestList, divider, esc, exceptionBlock, eyebrow, glyph, glyphChip, heading, label, lines, link, linkFallback, meter, metricCompare, note, otpBlock, p, pill, readout, renderLayout, routeBadge, safeUrl, safeUrlText, section, sectionHeader, stack, statStrip, stepTrack, strong, stripControl, TEXT_RULE, textBody, textGreeting, textLinks, textRows, } from './components.js';
/* ── Transactional templates: auth, account, organization ── */
export { accountDeletionConfirmTemplate, accountUnlockTemplate, apiKeyCreatedTemplate, emailVerificationTemplate, mfaCodeTemplate, mfaDisableConfirmTemplate, mfaStatusTemplate, newSignInTemplate, orgInvitationTemplate, passwordChangedTemplate, passwordResetTemplate, standardNotificationTemplate, } from './templates.js';
/* ── Alert & monitoring templates ── */
export { alertAcknowledgedTemplate, alertDigestTemplate, alertEscalatedTemplate, alertFiringTemplate, alertResolvedTemplate, alertSilencedTemplate, anomalyDetectedTemplate, deliveryFailureTemplate, errorAlertTemplate, errorSpikeTemplate, latencyAlertTemplate, quotaAlertTemplate, ruleChangedTemplate, serviceHealthTemplate, } from './alert-templates.js';
//# sourceMappingURL=index.js.map