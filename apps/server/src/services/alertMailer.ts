import nodemailer from "nodemailer";

export async function sendPriceAlertEmail(params: {
  to: string;
  language: "zh" | "en";
  symbol: string;
  label: string;
  target: number;
  current: number;
}) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new Error("邮件服务尚未配置");
  const port = Number(process.env.SMTP_PORT || 587);
  const requireTLS = process.env.SMTP_REQUIRE_TLS ? process.env.SMTP_REQUIRE_TLS === "1" : port === 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS,
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  // Alert email is English-only; the stored/preferred UI language is ignored.
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: `${params.symbol} reached target ${params.target}`,
    text: `Your alert “${params.label}” has triggered.\n\nSymbol: ${params.symbol}\nTarget: ${params.target}\nLatest close: ${params.current}\n\nOpen EasyWyckoff to review the current structure.\n\nResearch alert only; not investment advice.`,
  });
}
