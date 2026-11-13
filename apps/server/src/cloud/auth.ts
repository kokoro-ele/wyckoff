import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { getPool } from "./postgres.js";
import { registerCreditAccount, validateInviteCode } from "../credits/store.js";
import { consumeRateLimit } from "../credits/rateLimit.js";

let instance: ReturnType<typeof betterAuth> | undefined;
const deliveryContext = new AsyncLocalStorage<{ failed: boolean }>();
const emailLocaleContext = new AsyncLocalStorage<"zh" | "en">();
const cookieName = "wyckoff_referral";

function requestLocale(request: Request): "zh" | "en" {
  const cookies = request.headers.get("cookie") ?? "";
  const language = cookies
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("wyckoff_lang="))
    ?.slice("wyckoff_lang=".length);
  if (language === "en" || language === "zh") return language;
  const accept = request.headers.get("accept-language")?.toLowerCase() ?? "";
  return accept.startsWith("en") ? "en" : "zh";
}

export function authAvailability() {
  const workspaceKey = process.env.WORKSPACE_ENCRYPTION_KEY ?? "";
  const ready = Boolean(
    process.env.DATABASE_URL &&
      process.env.BETTER_AUTH_SECRET &&
      process.env.BETTER_AUTH_URL &&
      /^[a-f0-9]{64}$/i.test(workspaceKey),
  );
  return {
    ready,
    email: ready && Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
    google: ready && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

export function signReferralToken(token: string, secret: string): string {
  return `${token}.${createHmac("sha256", secret).update(token).digest("base64url")}`;
}

export function verifyReferralToken(value: string, secret: string): string | null {
  const [token, signature, extra] = value.split(".");
  if (
    !token ||
    !signature ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
    extra ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return null;
  }
  const expected = signReferralToken(token, secret).split(".")[1]!;
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ? token
    : null;
}

async function consumeReferral(headers?: Headers) {
  const value = headers
    ?.get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const token = value && verifyReferralToken(value, process.env.BETTER_AUTH_SECRET!);
  if (!token) return undefined;
  const result = await getPool().query<{ invite_code: string }>(
    "DELETE FROM auth_referral_intents WHERE token_hash=$1 AND expires_at > now() RETURNING invite_code",
    [createHash("sha256").update(token).digest("hex")],
  );
  return result.rows[0]?.invite_code;
}

export async function sendAuthOTP({ email, otp, type }: { email: string; otp: string; type: string }) {
  try {
    if (!authAvailability().email) throw new Error("Email delivery is not configured");
    const port = Number(process.env.SMTP_PORT || 587);
    const requireTLS = process.env.SMTP_REQUIRE_TLS
      ? process.env.SMTP_REQUIRE_TLS === "1"
      : port === 587;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    const language = emailLocaleContext.getStore() ?? "zh";
    const english = language === "en";
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: english
        ? type === "forget-password" ? "Reset your password" : "Verify your email"
        : type === "forget-password" ? "重置密码验证码" : "验证你的邮箱",
      text: english
        ? `Your verification code is ${otp}. It expires in 5 minutes. Do not share this code. If you did not request it, ignore this email.`
        : `你的验证码是 ${otp}，5 分钟内有效。请勿分享此验证码。如果不是你本人操作，请忽略此邮件。`,
    });
  } catch (error) {
    // Better Auth swallows mail errors internally; record the failure so the
    // HTTP boundary can return a real 503 instead of a false success.
    const state = deliveryContext.getStore();
    if (state) state.failed = true;
    throw error;
  }
}

export function authOptions(): BetterAuthOptions {
  if (!authAvailability().ready) {
    throw new Error("DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL and WORKSPACE_ENCRYPTION_KEY are required");
  }
  const options: BetterAuthOptions = {
    database: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL!,
    trustedOrigins: [process.env.BETTER_AUTH_URL!],
    emailAndPassword: {
      enabled: authAvailability().email,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    },
    // The app sends the verification OTP explicitly after sign-up and when an
    // unverified account tries to sign in. Sending here too would rotate the
    // code and deliver two emails, so the server stays quiet by default.
    emailVerification: { sendOnSignUp: false, sendOnSignIn: false, autoSignInAfterVerification: true },
    socialProviders: authAvailability().google
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            requireEmailVerification: true,
          },
        }
      : {},
    account: {
      // Mobile in-app browsers can partition or drop the short-lived OAuth
      // state cookie between the app and Google. Keep the state in Postgres
      // and validate the unguessable state parameter there instead.
      storeStateStrategy: "database",
      skipStateCookieCheck: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Google has already verified this email. Allow it to link to an
        // existing password account even if that local account has not
        // completed its OTP step yet; otherwise Google login returns to the
        // app without a session.
        requireLocalEmailVerified: false,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        disableSignUp: true,
        overrideDefaultEmailVerification: true,
        resendStrategy: "rotate",
        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: sendAuthOTP,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            const headers = context?.headers ?? context?.request?.headers;
            await registerCreditAccount(getPool(), user.id, await consumeReferral(headers));
          },
        },
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  };
  return options;
}

export function getAuth() {
  return (instance ??= betterAuth(authOptions()));
}

/** Better Auth catches mail errors internally; preserve delivery failure at the HTTP boundary. */
export async function runAuthHandler(
  request: Request,
  auth: { handler: (request: Request) => Promise<Response> } = getAuth(),
) {
  return deliveryContext.run({ failed: false }, async () => {
    const response = await auth.handler(request);
    return deliveryContext.getStore()!.failed
      ? Response.json(
          { code: "EMAIL_DELIVERY_FAILED", message: "邮件发送失败，请稍后重新发送验证码" },
          { status: 503 },
        )
      : response;
  });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/providers") {
    return Response.json(authAvailability(), { headers: { "Cache-Control": "no-store" } });
  }
  if (!authAvailability().ready) return Response.json({ message: "登录服务尚未配置" }, { status: 503 });

  if (path === "/api/auth/referral-intent") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin) {
      return new Response(null, { status: 403 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const ipKey = createHash("sha256").update(ip).digest("hex");
    if (!(await consumeRateLimit(getPool(), `referral:${ipKey}`, 10, 60_000))) {
      return Response.json({ message: "请求过于频繁，请稍后再试" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    if (!body || typeof body.code !== "string" || body.code.length > 100) {
      return Response.json({ message: "邀请码无效" }, { status: 400 });
    }
    const secure = new URL(process.env.BETTER_AUTH_URL!).protocol === "https:" ? "; Secure" : "";
    const code = body.code.trim();
    if (!code) {
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": `${cookieName}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } },
      );
    }
    try {
      await validateInviteCode(getPool(), code);
    } catch {
      return Response.json({ message: "邀请码无效" }, { status: 400 });
    }
    const token = randomBytes(32).toString("hex");
    await getPool().query("DELETE FROM auth_referral_intents WHERE expires_at <= now()");
    await getPool().query(
      "INSERT INTO auth_referral_intents(token_hash,invite_code,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
      [createHash("sha256").update(token).digest("hex"), code],
    );
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `${cookieName}=${signReferralToken(
            token,
            process.env.BETTER_AUTH_SECRET!,
          )}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  return emailLocaleContext.run(requestLocale(request), () => runAuthHandler(request));
}
