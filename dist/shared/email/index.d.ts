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
export { font, palette, radius, severityGlyph, severityTone, size, tint, tintBorder, toneStyle, tones, type AlertSeverity, type Tone, type ToneStyle, } from './theme.js';
export { aiInsight, block, button, buttonRow, callout, codeBlock, dataTable, digestList, divider, esc, eyebrow, glyph, glyphChip, heading, link, linkFallback, metricCompare, otpBlock, p, pill, renderLayout, safeUrl, safeUrlText, stack, statStrip, strong, stripControl, TEXT_RULE, textBody, textGreeting, textRows, type ButtonOptions, type DataRow, type DigestItem, type FooterKind, type LayoutOptions, } from './components.js';
export { accountDeletionConfirmTemplate, accountUnlockTemplate, apiKeyCreatedTemplate, emailVerificationTemplate, mfaCodeTemplate, mfaDisableConfirmTemplate, mfaStatusTemplate, newSignInTemplate, orgInvitationTemplate, passwordChangedTemplate, passwordResetTemplate, type ActionTemplateInput, type EmailTemplate, type MfaCodeTemplateInput, type OrgInvitationTemplateInput, type RequestContext, type TemplateInput, } from './templates.js';
export { alertAcknowledgedTemplate, alertDigestTemplate, alertEscalatedTemplate, alertFiringTemplate, alertResolvedTemplate, alertSilencedTemplate, anomalyDetectedTemplate, deliveryFailureTemplate, errorSpikeTemplate, latencyAlertTemplate, quotaAlertTemplate, ruleChangedTemplate, serviceHealthTemplate, type AlertAcknowledgedInput, type AlertDigestInput, type AlertEscalatedInput, type AlertFiringInput, type AlertIdentity, type AlertInsight, type AlertMeasurement, type AlertResolvedInput, type AlertScope, type AlertSilencedInput, type AnomalyDetectedInput, type DeliveryFailureInput, type DigestAlertEntry, type ErrorSpikeInput, type LatencyAlertInput, type QuotaAlertInput, type RuleChangedInput, type ServiceHealthInput, type ServiceHealthStatus, } from './alert-templates.js';
//# sourceMappingURL=index.d.ts.map