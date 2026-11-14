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
  const zh = params.language === "zh";
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: zh
      ? `${params.symbol} 已到达目标价 ${params.target}`
      : `${params.symbol} reached target ${params.target}`,
    text: zh
      ? `你设置的提醒「${params.label}」已触发。\n\n标的：${params.symbol}\n目标价：${params.target}\n最新收盘：${params.current}\n\n请回到 EasyWyckoff 查看当前结构。\n\n仅为研究提醒，不构成投资建议。`
      : `Your alert “${params.label}” has triggered.\n\nSymbol: ${params.symbol}\nTarget: ${params.target}\nLatest close: ${params.current}\n\nOpen EasyWyckoff to review the current structure.\n\nResearch alert only; not investment advice.`,
  });
}
