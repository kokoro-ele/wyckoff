import { config } from "../config.js";

export function isMailConfigured(): boolean {
  return Boolean(config.mail.host && config.mail.to);
}

export async function sendMail(subject: string, html: string): Promise<boolean> {
  if (!isMailConfigured()) {
    console.warn("[mail] 未配置 SMTP_HOST / MAIL_TO，跳过邮件推送");
    return false;
  }

  const nodemailer = await import("nodemailer");
  const createTransport = nodemailer.createTransport ?? nodemailer.default.createTransport;
  const transporter = createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });

  const from = config.mail.from || config.mail.user || "wyckoff@localhost";
  await transporter.sendMail({
    from,
    to: config.mail.to,
    subject,
    html,
  });
  return true;
}
