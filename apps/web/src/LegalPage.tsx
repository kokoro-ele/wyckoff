import { ArrowLeft } from "lucide-react";
import { useI18n } from "./i18n.js";
import { useSeo } from "./lib/seo.js";

type Kind = "privacy" | "terms" | "refund" | "contact";

const copy = {
  zh: {
    privacy: {
      title: "隐私政策",
      intro: "这份政策说明 EasyWyckoff 收集哪些数据、为什么收集、存放在哪里，以及你可以如何联系我们。上线收费前请再次审阅。",
      sections: [
        ["我们收集什么", "账号信息（邮箱、昵称、Google 账号标识与头像）；登录会话与验证码；自选、聊天、分析记录、图上标注；分析次数与订单记录；为排查故障产生的必要访问日志。"],
        ["模型设置与 API Key", "如果你选择使用自己的模型，Base URL、模型名和 API Key 会保存在你的 AES 加密工作区中。服务端只在执行你的分析时解密使用，不会把完整 Key 回传到浏览器，也不会写入普通日志。请求内容会发送到你填写的模型地址。"],
        ["第三方服务", "我们使用 Vercel 托管前端与后端、Supabase 提供 PostgreSQL、Resend 发送验证码邮件、Google 提供 OAuth 登录。使用平台模型时，分析内容会发送给运营方配置的模型供应商；使用自己的模型时，发送给你选择的供应商。"],
        ["保存期限与安全", "工作区快照在 PostgreSQL 中以 AES-256-GCM 加密；删除账号或按你的请求清理时，相关数据会按适用法律和备份周期删除。请不要在聊天中提交不必要的敏感个人信息。"],
        ["你的选择", "你可以不登录浏览行情；可以随时在设置中切换平台模型/自己的模型并清除自己的 Key。访问、更正或删除数据，请联系我们。"],
        ["Cookie", "我们使用必要的会话 Cookie 保持登录，不使用广告追踪 Cookie。"],
      ],
    },
    terms: {
      title: "服务条款",
      intro: "使用 EasyWyckoff 即表示你同意以下条款。它们是产品草案，正式上线前应由专业人士审阅。",
      sections: [
        ["服务性质", "EasyWyckoff 是价格、成交量与市场结构的研究工具，不构成投资建议、收益承诺、自动交易或代客理财服务。"],
        ["账号", "你需要提供真实可用的邮箱并完成验证；Google 登录由 Google 认证。请妥善保管密码和 API Key，不要与他人共享账号。"],
        ["分析次数与模型", "平台模型分析会消耗分析次数；使用你自己配置的模型不消耗平台次数。次数、免费额度和价格可能随产品调整，变更前会尽量通知。"],
        ["可接受使用", "不得利用本服务从事违法活动、攻击系统、绕过访问控制、抓取他人数据，或提交你无权处理的资料。模型输出可能不准确，请自行核验。"],
        ["知识产权", "工作台、图表、文案和代码归运营方或相应权利人所有；你保留自己上传内容和标注的权利，并授权我们为提供服务而处理这些内容。"],
        ["可用性与责任", "服务按现状提供，可能中断、延迟或调整。法律允许的最大范围内，我们不对因使用或无法使用服务造成的间接损失承担责任。"],
        ["变更与联系", "条款更新会在本页公布。问题请联系 support@easywyckoff.online。"],
      ],
    },
    refund: {
      title: "退款与取消",
      intro: "当前在线支付尚未正式开通；在开通前不会产生平台订阅费用。以下是开通后的草案政策。",
      sections: [
        ["数字服务", "分析次数、研究订阅和模型调用属于即时交付的数字服务。已消费的次数通常不支持退款，但重复扣款、未交付或未经授权的支付除外。"],
        ["订阅取消", "如提供按月订阅，你可以在当期结束前取消，已使用当期服务不按比例退款；取消后不再自动续费。"],
        ["自己的模型", "使用自己的模型时，模型费用由你直接向模型供应商支付，EasyWyckoff 不代收也不退还这部分费用。"],
        ["申请方式", "请在付款后 14 天内联系 support@easywyckoff.online，附上账号、订单号和原因。我们会按适用法律和支付渠道规则处理。"],
      ],
    },
    contact: {
      title: "联系我们",
      intro: "产品、账号、隐私、账单和合规问题都可以发邮件。",
      sections: [
        ["邮箱", "support@easywyckoff.online"],
        ["安全问题", "如果你发现认证、API Key、数据隔离或支付方面的安全问题，请勿公开披露，先通过邮件联系我们。"],
        ["响应时间", "通常会在 2 个工作日内回复；涉及账号或支付的问题请附上注册邮箱和订单号（如有）。"],
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy Policy",
      intro: "This policy explains what EasyWyckoff collects, why, where it is stored, and how to contact us. Review it again before paid plans go live.",
      sections: [
        ["What we collect", "Account details (email, name, Google account identifier and avatar); sessions and verification codes; watchlists, chats, analyses and chart annotations; credit and order records; necessary access logs for debugging."],
        ["Model settings and API keys", "If you choose your own model, the Base URL, model ID and API key are stored in your AES-encrypted workspace. The server decrypts them only while running your analysis; the full key is never returned to the browser or written to ordinary logs. Request content is sent to the model endpoint you provide."],
        ["Third parties", "We use Vercel for hosting, Supabase for PostgreSQL, Resend for verification email, and Google for OAuth. With the platform model, analysis content goes to the operator's model provider; with your own model, it goes to the provider you choose."],
        ["Retention and security", "Workspace snapshots are encrypted with AES-256-GCM in PostgreSQL. Account deletion and verified requests are handled under applicable law and backup cycles. Do not submit unnecessary sensitive personal information in chat."],
        ["Your choices", "You can browse quotes without signing in; switch between the platform model and your own model at any time; and clear your own key in Settings. Contact us to access, correct or delete data."],
        ["Cookies", "We use essential session cookies for authentication. We do not use advertising tracking cookies."],
      ],
    },
    terms: {
      title: "Terms of Service",
      intro: "By using EasyWyckoff you agree to these terms. This is a product draft and should be reviewed by a qualified professional before launch.",
      sections: [
        ["What this is", "EasyWyckoff is a research tool for price, volume and market structure. It is not investment advice, a return promise, automated trading, or discretionary asset management."],
        ["Accounts", "Provide a working email and verify it; Google sign-in is authenticated by Google. Keep your password and API keys private and do not share accounts."],
        ["Credits and models", "Platform-model analyses consume credits; your own configured model does not consume platform credits. Free allowances, quotas and prices may change as the product evolves, with reasonable notice where possible."],
        ["Acceptable use", "Do not use the service for unlawful activity, attacks, access-control bypasses, scraping other users' data, or material you have no right to process. Model output may be inaccurate; verify it independently."],
        ["Intellectual property", "The workbench, charts, copy and code belong to the operator or their licensors. You retain rights to your own content and annotations and grant us permission to process them to provide the service."],
        ["Availability and liability", "The service is provided as-is and may be interrupted, delayed or changed. To the maximum extent permitted by law, we are not liable for indirect losses arising from use or inability to use the service."],
        ["Changes and contact", "Updates will be posted here. Contact support@easywyckoff.online."],
      ],
    },
    refund: {
      title: "Refunds and Cancellation",
      intro: "Online payment is not live yet; no platform subscription fee is charged before it is enabled. This is a draft policy for when it launches.",
      sections: [
        ["Digital services", "Credits, research subscriptions and model calls are digital services delivered immediately. Consumed credits are generally non-refundable, except for duplicate charges, non-delivery or unauthorized payments."],
        ["Subscription cancellation", "If monthly subscriptions are offered, you may cancel before the current period ends. Used periods are not prorated; automatic renewal stops after cancellation."],
        ["Your own model", "When you use your own model, model fees are paid directly to your provider. EasyWyckoff does not collect or refund those fees."],
        ["How to request", "Contact support@easywyckoff.online within 14 days of payment with your account, order ID and reason. We will apply the law and payment-provider rules."],
      ],
    },
    contact: {
      title: "Contact",
      intro: "Reach us for product, account, privacy, billing or compliance questions.",
      sections: [
        ["Email", "support@easywyckoff.online"],
        ["Security", "If you find an authentication, API-key, isolation or payment issue, do not disclose it publicly; email us first."],
        ["Response time", "We usually reply within two business days. Include your account email and order ID, if any."],
      ],
    },
  },
} as const;

export function LegalPage({ kind }: { kind: Kind }) {
  const { lang } = useI18n();
  const page = copy[lang][kind];
  useSeo({
    title: `${page.title} · EasyWyckoff`,
    description: page.intro,
    path: `/${kind}`,
    lang,
  });
  return (
    <div className="legal-shell">
      <header className="legal-topbar">
        <a className="site-brand" href="/"><span className="site-brand-mark">W</span>EasyWyckoff</a>
        <a className="hand-btn px-3 py-1.5 text-xs" href="/"><ArrowLeft size={13} />{lang === "zh" ? "返回首页" : "Back home"}</a>
      </header>
      <main className="legal-main">
        <div className="site-kicker">EASYWYCKOFF · LEGAL</div>
        <h1>{page.title}</h1>
        <p className="legal-intro">{page.intro}</p>
        <div className="legal-sections">
          {page.sections.map(([title, body]) => (
            <section key={title} className="hand-card legal-card">
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <p className="legal-foot">{lang === "zh" ? "最后更新：2026-11-12 · 研究与教育用途，不构成投资建议。" : "Last updated: 2026-11-12 · Research and education only; not investment advice."}</p>
      </main>
    </div>
  );
}
