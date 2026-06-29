const theme = {
    bg: "#0a0a0a",
    panel: "#111111",
    text: "#e8e8e8",
    muted: "#999999",
    border: "#262626",
    brand: "#34d399",
    brandFg: "#04140d",
    warningBg: "#2b200b",
    warningText: "#f59e0b",
    headerGradientStart: "#111111",
    headerGradientEnd: "#0d2818",
    brandDark: "#10b981",
    brandBg: "rgba(52,211,153,0.10)",
    danger: "#ef4444",
    dangerBg: "rgba(239,68,68,0.10)",
};
/* ── Pulsiv logo: inline SVG (email-safe, colors hard-coded) ── */
const PULSIV_LOGO = `<svg width="40" height="46" viewBox="0 0 100 116" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;"><defs><linearGradient id="pl-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#34d399" stop-opacity="0"/><stop offset="60%" stop-color="#34d399" stop-opacity="0.4"/><stop offset="100%" stop-color="#34d399" stop-opacity="0.9"/></linearGradient></defs><path fill-rule="evenodd" clip-rule="evenodd" d="M14 8h36c20.987 0 38 17.013 38 38 0 20.987-17.013 38-38 38H28v24H14V8Zm14 14v46h22c12.7 0 23-10.3 23-23 0-12.7-10.3-23-23-23H28Z" fill="#ffffff"/><g><animateTransform attributeName="transform" type="rotate" from="0 50 45" to="360 50 45" dur="3s" repeatCount="indefinite"/><path d="M50 45l23 0a23 23 0 0 0-23-23Z" fill="url(#pl-sweep)" opacity="0.7"/><circle cx="70" cy="45" r="4" stroke="#34d399" stroke-width="1.5" fill="#0a0a0a"/><circle cx="70" cy="45" r="1.5" fill="#34d399"/></g><circle cx="50" cy="45" r="21" stroke="#34d399" stroke-width="1.5" opacity="0.2" fill="none"/><circle cx="50" cy="45" r="14" stroke="#34d399" stroke-width="1.5" opacity="0.5" fill="none"/><circle cx="50" cy="45" r="7" stroke="#34d399" stroke-width="1.5" opacity="0.7" fill="none"/><circle cx="50" cy="45" r="2.5" fill="#34d399" opacity="0.9"><animate attributeName="opacity" values="0.8;0.4;0.8" dur="2s" repeatCount="indefinite"/></circle></svg>`;
/* ── Hero icon SVG builder ── */
function heroIconMarkup(name, accent) {
    const color = accent || theme.brand;
    const bgStyle = `background:${color}19;border:1px solid ${color}26;`;
    const paths = {
        key: `<circle cx="12" cy="12" r="4" stroke-width="1.5" fill="none"/><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" stroke-width="1.5" fill="none"/>`,
        mail: `<rect x="2" y="4" width="20" height="16" rx="2" stroke-width="1.5" fill="none"/><polyline points="22,7 12,13 2,7" stroke-width="1.5" fill="none"/>`,
        shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-width="1.5" fill="none"/><polyline points="9,12 12,15 17,10" stroke-width="1.5" fill="none"/>`,
        "shield-off": `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-width="1.5" fill="none"/><line x1="9" y1="9" x2="15" y2="15" stroke-width="1.5"/>`,
        unlock: `<rect x="3" y="11" width="18" height="11" rx="2" stroke-width="1.5" fill="none"/><path d="M7 11V7a5 5 0 0 1 9.227-2.727" stroke-width="1.5" fill="none"/>`,
        danger: `<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-width="1.5" fill="none"/><line x1="12" y1="9" x2="12" y2="13" stroke-width="1.5"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="1.5"/>`,
        team: `<path d="M17 21v-2a4 4 0 0 0-3-3.87" stroke-width="1.5" fill="none"/><path d="M8 21v-2a4 4 0 0 1 3-3.87" stroke-width="1.5" fill="none"/><circle cx="12.5" cy="7" r="4" stroke-width="1.5" fill="none"/>`,
        otp: `<rect x="3" y="3" width="18" height="18" rx="2" stroke-width="1.5" fill="none"/><line x1="9" y1="9" x2="9.01" y2="9" stroke-width="1.5"/><line x1="15" y1="9" x2="15.01" y2="9" stroke-width="1.5"/><line x1="9" y1="15" x2="9.01" y2="15" stroke-width="1.5"/><line x1="15" y1="15" x2="15.01" y2="15" stroke-width="1.5"/>`,
        "mail-arrow": `<rect x="2" y="4" width="20" height="16" rx="2" stroke-width="1.5" fill="none"/><polyline points="22,7 12,13 2,7" stroke-width="1.5" fill="none"/><path d="M18 8h4v4M14 12l8-8" stroke-width="1.5" fill="none"/>`,
        lock: `<rect x="3" y="11" width="18" height="11" rx="2" stroke-width="1.5" fill="none"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-width="1.5" fill="none"/>`,
    };
    const d = paths[name] || paths.shield;
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 16px;"><tr><td style="width:48px;height:48px;border-radius:50%;${bgStyle}text-align:center;vertical-align:middle;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;">${d}</svg></td></tr></table>`;
}
/* ── Trust badge footer row ── */
function trustBadgeRow() {
    const s = "font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;color:#999999;";
    return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin-top:20px;padding-top:16px;border-top:1px solid ${theme.border};max-width:620px;"><tr><td align="center"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding:0 12px;${s}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.2" style="vertical-align:-2px;margin-right:4px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>MFA protected</td><td style="padding:0 12px;${s}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.2" style="vertical-align:-2px;margin-right:4px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Encrypted</td><td style="padding:0 12px;${s}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.2" style="vertical-align:-2px;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Audit logging</td></tr></table></td></tr></table>`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function layout(appName, title, body, heroIconName, heroIconColor) {
    const safeApp = escapeHtml(appName);
    const safeTitle = escapeHtml(title);
    const heroBlock = heroIconName ? heroIconMarkup(heroIconName, heroIconColor) : "";
    const logoBlock = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:14px;"><tr><td><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:middle;padding-right:12px;">${PULSIV_LOGO}</td><td style="vertical-align:middle;"><span style="font-family:'Inter',Arial,sans-serif;font-size:20px;font-weight:600;letter-spacing:0.04em;color:${theme.text};">Pulsiv</span></td></tr></table></td></tr></table>`;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
    <!--[if !mso]><!-->
    <style>
      @keyframes pl-fade-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes pl-glow { 0%,100% { box-shadow:0 0 12px rgba(52,211,153,0.15); } 50% { box-shadow:0 0 22px rgba(52,211,153,0.38); } }
      @keyframes pl-icon-pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.07); } }
      .pl-card { animation:pl-fade-in 0.6s ease-out both; }
      .pl-header { animation:pl-glow 3s ease-in-out infinite; }
      .pl-hero-icon { animation:pl-icon-pulse 2.5s ease-in-out infinite; }
    </style>
    <!--<![endif]-->
  </head>
  <body style="margin:0;background:${theme.bg};font-family:'Inter',Arial,sans-serif;color:${theme.text};">
    <table class="pl-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${theme.bg};padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:${theme.panel};border:1px solid ${theme.border};border-radius:10px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          <tr><td class="pl-header" style="padding:28px 32px 20px;background:linear-gradient(180deg,${theme.headerGradientStart} 0%,${theme.headerGradientEnd} 100%);border-bottom:1px solid ${theme.border};">
            ${logoBlock}
            <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${theme.brand};font-family:'JetBrains Mono',monospace;">${safeApp}</div>
            <h1 style="margin:6px 0 0;font-size:24px;line-height:1.25;font-weight:600;color:${theme.text};">${safeTitle}</h1>
          </td></tr>
          <tr><td style="padding:32px;">
            <div class="pl-hero-icon">${heroBlock}</div>
            ${body}
            <p style="margin:28px 0 0;color:${theme.muted};font-size:13px;line-height:1.6;">If you did not request this, secure your account and contact support immediately.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;background:${theme.bg};border-top:1px solid ${theme.border};">
            ${trustBadgeRow()}
            <p style="margin:12px 0 0;color:${theme.muted};font-size:12px;text-align:center;font-family:'JetBrains Mono',monospace;">Security notification from ${safeApp}</p>
          </td></tr>
        </table>
      </td></tr></table>
  </body>
</html>`;
}
function button(url, label) {
    return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${theme.brand};color:${theme.brandFg};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;font-size:14px;border-left:3px solid ${theme.brandDark};">${escapeHtml(label)}</a>`;
}
function textGreeting(userName) {
    return userName ? `Hi ${userName},` : "Hi,";
}
export function passwordResetTemplate(input) {
    const title = "Reset your password";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">Use the secure link below to reset your password. This link expires in ${input.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Reset password")}</p>
    <p style="margin:0 0 8px;font-size:11px;color:${theme.muted};font-family:'JetBrains Mono',monospace;letter-spacing:0.08em;text-transform:uppercase;">Or copy this link</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: password reset request`,
        html: layout(input.appName, title, body, "key", theme.brand),
        text: `${textGreeting(input.userName)}\n\nReset your password: ${input.actionUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
    };
}
export function emailVerificationTemplate(input) {
    const title = "Verify your email";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">Confirm this email address to finish securing your ${escapeHtml(input.appName)} account. This also enables email-based security features like account recovery.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Verify email")}</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: verify your email`,
        html: layout(input.appName, title, body, "mail", theme.brand),
        text: `${textGreeting(input.userName)}\n\nVerify your email: ${input.actionUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
    };
}
export function mfaCodeTemplate(input) {
    const title = input.purpose === "setup"
        ? "Confirm email MFA setup"
        : input.purpose === "login"
            ? "Your login verification code"
            : "Your verification code";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Use this code to continue${input.deviceName ? ` for ${escapeHtml(input.deviceName)}` : ""}. It expires in ${input.expiresInMinutes} minutes.</p>
    <div style="margin:22px 0;padding:18px;border-radius:6px;background:${theme.bg};border:1px solid ${theme.border};color:${theme.text};text-align:center;font-size:32px;font-weight:600;letter-spacing:.28em;font-family:'JetBrains Mono',monospace;box-shadow:0 0 0 3px rgba(52,211,153,0.12);">${escapeHtml(input.code)}</div>
    <div style="margin-top:18px;border-left:2px solid ${theme.warningText};background:${theme.warningBg};color:${theme.warningText};padding:12px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.5;">
      <table role="presentation" cellspacing="0" cellpadding="0"><tr>
        <td style="padding-right:10px;vertical-align:top;font-size:16px;line-height:1;">&#9888;</td>
        <td style="vertical-align:top;">Never share this code. ${escapeHtml(input.appName)} staff will never ask for it.</td>
      </tr></table>
    </div>
  `;
    return {
        subject: `${input.appName}: verification code`,
        html: layout(input.appName, title, body, "otp", theme.brand),
        text: `${textGreeting(input.userName)}\n\nYour verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes.\n\nNever share this code.`,
    };
}
export function mfaStatusTemplate(input) {
    const title = input.enabled ? "MFA enabled" : "MFA disabled";
    const accent = input.enabled ? theme.brand : theme.warningText;
    const badgeBg = input.enabled ? theme.brandBg : "rgba(245,158,11,0.12)";
    const badgeBorder = input.enabled ? "rgba(52,211,153,0.30)" : "rgba(245,158,11,0.30)";
    const badgeLabel = input.enabled ? "ENABLED" : "DISABLED";
    const context = input.enabled
        ? "Your account is now more secure. Consider generating backup recovery codes in your security settings."
        : "Your account is less secure without MFA. We strongly recommend re-enabling it for maximum protection.";
    const iconColor = input.enabled ? theme.brand : theme.warningText;
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Multi-factor authentication was ${input.enabled ? "enabled for" : "disabled on"} your ${escapeHtml(input.appName)} account.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:20px;"><tr><td style="background:${badgeBg};border:1px solid ${badgeBorder};border-radius:9999px;padding:6px 18px;font-weight:600;font-size:13px;color:${accent};display:inline-block;letter-spacing:0.05em;">
      ${input.enabled ? "&#10003; " : "&#9888; "}${badgeLabel}
    </td></tr></table>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${theme.muted};font-style:italic;">${context}</p>
  `;
    return {
        subject: `${input.appName}: ${title}`,
        html: layout(input.appName, title, body, input.enabled ? "shield" : "shield-off", iconColor),
        text: `${textGreeting(input.userName)}\n\nMulti-factor authentication was ${input.enabled ? "enabled for" : "disabled on"} your ${input.appName} account.`,
    };
}
export function emailChangeConfirmTemplate(input) {
    const title = "Confirm your new email address";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Confirm <strong style="color:${theme.brand};">${escapeHtml(input.newEmail)}</strong> as the new sign-in email for ${escapeHtml(input.appName)}. This will update your login credentials and all security notifications.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Confirm new email")}</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: confirm your new email`,
        html: layout(input.appName, title, body, "mail-arrow", theme.brand),
        text: `${textGreeting(input.userName)}\n\nConfirm ${input.newEmail} as your new email: ${input.actionUrl}\n\nExpires in ${input.expiresInMinutes} minutes.`,
    };
}
export function accountUnlockTemplate(input) {
    const title = "Unlock your account";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Your account was locked after too many failed sign-in attempts. Use the link below to restore access. It expires in ${input.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Unlock account")}</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: unlock your account`,
        html: layout(input.appName, title, body, "unlock", theme.warningText),
        text: `${textGreeting(input.userName)}\n\nUnlock your account: ${input.actionUrl}\n\nExpires in ${input.expiresInMinutes} minutes.`,
    };
}
export function accountDeletionConfirmTemplate(input) {
    const title = "Confirm account deletion";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">You requested to delete your ${escapeHtml(input.appName)} account. Confirming will schedule permanent deletion for <strong>${escapeHtml(input.scheduledFor)}</strong>.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Confirm deletion request")}</p>
    <div style="border-left:2px solid ${theme.danger};background:${theme.dangerBg};color:${theme.danger};padding:12px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.5;">This action cannot be undone. All your data will be permanently erased after the scheduled date.</div>
  `;
    return {
        subject: `${input.appName}: confirm account deletion`,
        html: layout(input.appName, title, body, "danger", theme.danger),
        text: `${textGreeting(input.userName)}\n\nConfirm deletion (scheduled ${input.scheduledFor}): ${input.actionUrl}`,
    };
}
export function mfaDisableConfirmTemplate(input) {
    const title = "Confirm disabling multi-factor authentication";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">A request was made to disable multi-factor authentication on your ${escapeHtml(input.appName)} account. This will weaken your account security. The link expires in ${input.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Confirm and disable MFA")}</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
    <div style="margin-top:18px;border-left:2px solid ${theme.warningText};background:${theme.warningBg};color:${theme.warningText};padding:12px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.5;">If you did not initiate this, do nothing &mdash; MFA stays enabled. Then change your password immediately.</div>
  `;
    return {
        subject: `${input.appName}: confirm MFA disable`,
        html: layout(input.appName, title, body, "shield-off", theme.warningText),
        text: `${textGreeting(input.userName)}\n\nA request was made to disable multi-factor authentication on your ${input.appName} account.\n\nConfirm: ${input.actionUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes. If this was not you, do nothing &mdash; MFA stays enabled, then change your password.`,
    };
}
/**
 * Organization invitation email. The CTA points at the frontend invite page
 * with the one-time token. When the invitee has no account yet, the copy nudges
 * them to create one first; the frontend uses the accountExists flag in the URL
 * to render the right screen (sign-in vs. create-account).
 */
export function orgInvitationTemplate(input) {
    const title = `You're invited to ${input.orgName}`;
    const inviter = input.inviterName ? `${escapeHtml(input.inviterName)} invited you` : "You have been invited";
    const nextStep = input.accountExists
        ? "Sign in to accept the invitation."
        : "Create your account to accept the invitation.";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${inviter} to join <strong>${escapeHtml(input.orgName)}</strong> on ${escapeHtml(input.appName)} as <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:${theme.muted};">${escapeHtml(nextStep)} This invitation expires in ${input.expiresInDays} days.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Accept invitation")}</p>
    <div style="border:1px solid ${theme.border};border-radius:6px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};font-family:'JetBrains Mono',monospace;">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: invitation to join ${input.orgName}`,
        html: layout(input.appName, title, body, "team", theme.brand),
        text: `${textGreeting(input.userName)}\n\n${input.inviterName ? `${input.inviterName} invited you` : "You have been invited"} to join ${input.orgName} on ${input.appName} as ${input.roleLabel}.\n\n${nextStep}\n\nAccept: ${input.actionUrl}\n\nThis invitation expires in ${input.expiresInDays} days.`,
    };
}
export function passwordChangedTemplate(input) {
    const title = "Your password was changed";
    const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">The password for your ${escapeHtml(input.appName)} account was recently changed. If this was you, no further action is needed.</p>
    <div style="border-left:2px solid ${theme.warningText};background:${theme.warningBg};color:${theme.warningText};padding:12px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.5;">If this was not you, your account may be compromised. Change your password immediately and enable multi-factor authentication.</div>
  `;
    return {
        subject: `${input.appName}: password changed`,
        html: layout(input.appName, title, body, "lock", theme.brand),
        text: `${textGreeting(input.userName)}\n\nThe password for your ${input.appName} account was recently changed.`,
    };
}
//# sourceMappingURL=templates.js.map