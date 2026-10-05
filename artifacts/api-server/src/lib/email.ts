import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger";

/**
 * Transactional email for portal links and client updates.
 *
 * Two providers are supported; the first one configured wins:
 *
 * 1. Gmail SMTP (nodemailer) — sends through Google's own servers, so mail
 *    genuinely comes from the Gmail address and lands in customer inboxes.
 *    Requires an App Password (regular passwords are rejected by Google):
 *
 *      GMAIL_USER           e.g. bridgelegal2@gmail.com
 *      GMAIL_APP_PASSWORD   16-char app password from myaccount.google.com/apppasswords
 *      EMAIL_FROM           optional display override, defaults to "Docketline" <GMAIL_USER>
 *
 *    Free limit: ~500 emails/day (Google's own sending cap).
 *
 * 2. Resend REST API (https://resend.com) — free tier 100 emails/day. Note the
 *    sandbox sender can only reach the Resend account owner until a custom
 *    domain is verified:
 *
 *      RESEND_API_KEY       API key from resend.com
 *      EMAIL_FROM           optional, defaults to the sandbox sender
 *
 * When no provider is configured every send fails soft with reason
 * "not_configured" so the app keeps working and callers can surface a
 * "copy the link instead" fallback.
 */

export type EmailSendResult = { ok: true; id: string } | { ok: false; reason: string };

let gmailTransport: Transporter | null = null;

function getGmailTransport(): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!gmailTransport) {
    gmailTransport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return gmailTransport;
}

export function isEmailConfigured(): boolean {
  return !!getGmailTransport() || !!process.env.RESEND_API_KEY;
}

export async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<EmailSendResult> {
  const transporter = getGmailTransport();
  if (transporter) {
    const user = process.env.GMAIL_USER as string;
    const from = process.env.EMAIL_FROM || `"Docketline" <${user}>`;
    try {
      const info = await transporter.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      logger.info({ to: payload.to, id: info.messageId, provider: "gmail" }, "email sent");
      return { ok: true, id: info.messageId ?? "sent" };
    } catch (err) {
      logger.warn({ err, to: payload.to }, "gmail send failed");
      return { ok: false, reason: err instanceof Error ? err.message : "gmail_error" };
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn({ to: payload.to }, "email skipped: no email provider is configured");
    return { ok: false, reason: "not_configured" };
  }
  const from = process.env.EMAIL_FROM || "Docketline <onboarding@resend.dev>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        ...(payload.text ? { text: payload.text } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.warn({ status: response.status, to: payload.to }, "resend request failed");
      return { ok: false, reason: `resend_${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    logger.info({ to: payload.to, id: data.id, provider: "resend" }, "email sent");
    return { ok: true, id: data.id ?? "sent" };
  } catch (err) {
    logger.warn({ err, to: payload.to }, "email send threw");
    return { ok: false, reason: err instanceof Error ? err.message : "network_error" };
  }
}

/** Brand the portal-link email. Inline styles only — email clients ignore <style> blocks. */
export function portalLinkEmailHtml(clientName: string, url: string): string {
  const safeName = clientName.replace(/[<>&]/g, "");
  const safeUrl = url.replace(/"/g, "%22");
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f3f6;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1d2733;">
    <div style="background:#101826;color:#ffffff;padding:18px 22px;border-radius:10px 10px 0 0;">
      <span style="font-size:15px;font-weight:700;letter-spacing:.04em;">Docketline</span>
      <span style="font-size:11px;color:#9fb0c3;margin-left:10px;">Traffic ticket case management</span>
    </div>
    <div style="background:#ffffff;padding:26px 22px;border:1px solid #e2e7ee;border-top:none;border-radius:0 0 10px 10px;">
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55;">Hello ${safeName},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.55;">Your paralegal has opened a private portal for your case files. Use the button below to check your case status, upcoming court dates, payments and documents at any time — no login or password needed.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="background:#1f6feb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 26px;border-radius:8px;display:inline-block;">Open my case portal</a>
      </div>
      <p style="margin:0 0 6px;font-size:12px;color:#5b6b7c;line-height:1.6;">If the button doesn't work, paste this link into your browser:<br><a href="${safeUrl}" style="color:#1f6feb;word-break:break-all;">${safeUrl}</a></p>
      <p style="margin:18px 0 0;font-size:12px;color:#5b6b7c;line-height:1.6;">This link is personal to you — please don't forward it. The portal is read-only and updates automatically as your file progresses.</p>
    </div>
    <p style="margin:16px 4px 0;font-size:11px;color:#8593a3;line-height:1.6;">Questions about your file? Simply reply to this email or contact the office directly. You are receiving this because a portal link was requested for your case.</p>
  </div>
</body>
</html>`;
}
