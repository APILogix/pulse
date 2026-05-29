const theme = {
    bg: "#f6f8fb",
    panel: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    border: "#dbe4ef",
    brand: "#0f766e",
    brandDark: "#115e59",
    warningBg: "#fff7ed",
    warningText: "#9a3412",
};
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function layout(appName, title, body) {
    const safeApp = escapeHtml(appName);
    const safeTitle = escapeHtml(title);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:${theme.bg};font-family:Arial,Helvetica,sans-serif;color:${theme.text};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${theme.bg};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:${theme.panel};border:1px solid ${theme.border};border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:${theme.text};color:#fff;">
                <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#99f6e4;">${safeApp}</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${body}
                <p style="margin:28px 0 0;color:${theme.muted};font-size:13px;line-height:1.6;">If you did not request this, secure your account and contact support immediately.</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:${theme.muted};font-size:12px;">Security notification from ${safeApp}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
function button(url, label) {
    return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${theme.brand};color:#fff;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:10px;">${escapeHtml(label)}</a>`;
}
function textGreeting(userName) {
    return userName ? `Hi ${userName},` : "Hi,";
}
export function passwordResetTemplate(input) {
    const title = "Reset your password";
    const body = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:16px;line-height:1.7;">Use the secure link below to reset your password. This link expires in ${input.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Reset password")}</p>
    <div style="border:1px solid ${theme.border};border-radius:12px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: password reset request`,
        html: layout(input.appName, title, body),
        text: `${textGreeting(input.userName)}\n\nReset your password: ${input.actionUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
    };
}
export function emailVerificationTemplate(input) {
    const title = "Verify your email";
    const body = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:16px;line-height:1.7;">Confirm this email address to finish securing your ${escapeHtml(input.appName)} account.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Verify email")}</p>
    <div style="border:1px solid ${theme.border};border-radius:12px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: verify your email`,
        html: layout(input.appName, title, body),
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
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Use this code to continue${input.deviceName ? ` for ${escapeHtml(input.deviceName)}` : ""}. It expires in ${input.expiresInMinutes} minutes.</p>
    <div style="margin:22px 0;padding:18px;border-radius:14px;background:${theme.text};color:#fff;text-align:center;font-size:32px;font-weight:800;letter-spacing:.28em;">${escapeHtml(input.code)}</div>
    <div style="border-left:4px solid ${theme.brand};background:${theme.warningBg};color:${theme.warningText};padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.5;">Never share this code. ${escapeHtml(input.appName)} staff will never ask for it.</div>
  `;
    return {
        subject: `${input.appName}: verification code`,
        html: layout(input.appName, title, body),
        text: `${textGreeting(input.userName)}\n\nYour verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes.\n\nNever share this code.`,
    };
}
export function mfaStatusTemplate(input) {
    const title = input.enabled ? "MFA enabled" : "MFA disabled";
    const body = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0;font-size:16px;line-height:1.7;">Multi-factor authentication was ${input.enabled ? "enabled for" : "disabled on"} your ${escapeHtml(input.appName)} account.</p>
  `;
    return {
        subject: `${input.appName}: ${title}`,
        html: layout(input.appName, title, body),
        text: `${textGreeting(input.userName)}\n\nMulti-factor authentication was ${input.enabled ? "enabled for" : "disabled on"} your ${input.appName} account.`,
    };
}
/**
 * Email sent when a user starts the MFA-disable flow. Contains a one-time
 * confirmation link the user must click to actually disable MFA. Until the
 * link is consumed, MFA remains in force, so a phished password + a stolen
 * TOTP cannot disable MFA on its own.
 */
export function mfaDisableConfirmTemplate(input) {
    const title = "Confirm disabling multi-factor authentication";
    const body = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 22px;font-size:16px;line-height:1.7;">A request was made to disable multi-factor authentication on your ${escapeHtml(input.appName)} account. This will weaken your account security. The link below expires in ${input.expiresInMinutes} minutes.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Confirm and disable MFA")}</p>
    <div style="border:1px solid ${theme.border};border-radius:12px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};">${escapeHtml(input.actionUrl)}</div>
    <div style="margin-top:18px;border-left:4px solid ${theme.brand};background:${theme.warningBg};color:${theme.warningText};padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.5;">If you did not initiate this, do nothing — MFA stays enabled. Then change your password immediately.</div>
  `;
    return {
        subject: `${input.appName}: confirm MFA disable`,
        html: layout(input.appName, title, body),
        text: `${textGreeting(input.userName)}\n\nA request was made to disable multi-factor authentication on your ${input.appName} account.\n\nConfirm: ${input.actionUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes. If this was not you, do nothing — MFA stays enabled, then change your password.`,
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
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${escapeHtml(textGreeting(input.userName))}</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${inviter} to join <strong>${escapeHtml(input.orgName)}</strong> on ${escapeHtml(input.appName)} as <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${theme.muted};">${escapeHtml(nextStep)} This invitation expires in ${input.expiresInDays} days.</p>
    <p style="margin:0 0 24px;">${button(input.actionUrl, "Accept invitation")}</p>
    <div style="border:1px solid ${theme.border};border-radius:12px;padding:14px;background:${theme.bg};word-break:break-all;font-size:13px;color:${theme.muted};">${escapeHtml(input.actionUrl)}</div>
  `;
    return {
        subject: `${input.appName}: invitation to join ${input.orgName}`,
        html: layout(input.appName, title, body),
        text: `${textGreeting(input.userName)}\n\n${input.inviterName ? `${input.inviterName} invited you` : "You have been invited"} to join ${input.orgName} on ${input.appName} as ${input.roleLabel}.\n\n${nextStep}\n\nAccept: ${input.actionUrl}\n\nThis invitation expires in ${input.expiresInDays} days.`,
    };
}
//# sourceMappingURL=templates.js.map