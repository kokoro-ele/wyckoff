import { beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mail: vi.fn(), register: vi.fn(), validate: vi.fn() }));
vi.mock("./postgres.js", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("../credits/store.js", () => ({ registerCreditAccount: mocks.register, validateInviteCode: mocks.validate }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.mail }) } }));
import { authAvailability, authOptions, runAuthHandler, handleAuthRequest, signReferralToken, verifyReferralToken } from "./auth.js";

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ DATABASE_URL: "postgres://unused", BETTER_AUTH_SECRET: "test-secret-for-auth-at-least-32-characters", BETTER_AUTH_URL: "https://example.com", WORKSPACE_ENCRYPTION_KEY: "ab".repeat(32), SMTP_HOST: "smtp.example.com", SMTP_USER: "test", SMTP_PASS: "test", SMTP_FROM: "test@example.com" })) vi.stubEnv(key, value);
  mocks.query.mockResolvedValue({ rows: [] }); mocks.mail.mockResolvedValue({});
});
function request(path: string, body: object, cookie?: string) { return new Request(`https://example.com/api/auth${path}`, { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json", "x-forwarded-for": "192.0.2.1", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); }
function testAuth(withHooks = false) {
  const data: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const auth = betterAuth({ ...authOptions(), database: memoryAdapter(data), databaseHooks: withHooks ? authOptions().databaseHooks : {}, logger: { disabled: true }, advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } } });
  return { auth, data };
}
async function signUp(auth: { handler: (request: Request) => Promise<Response> }) {
  const response = await auth.handler(request("/sign-up/email", { email: "person@example.com", name: "Person", password: "a-good-password-123" }));
  expect(response.status).toBe(200);
  const sent = await auth.handler(request("/email-otp/send-verification-otp", { email: "person@example.com", type: "email-verification" }));
  expect(sent.status).toBe(200);
  const mail = mocks.mail.mock.calls.at(-1)![0] as { text: string };
  return mail.text.match(/\d{6}/)![0];
}
describe("configured authentication", () => {
  it("fails closed without core configuration and exposes only provider flags", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(authAvailability()).toEqual({ ready: false, email: false, google: false });
    expect((await handleAuthRequest(request("/sign-up/email", {}))).status).toBe(503);
    expect(await (await handleAuthRequest(new Request("https://example.com/api/auth/providers"))).json()).toEqual({ ready: false, email: false, google: false });
  });
  it("requires email verification, stores hashed OTP, verifies once and rejects replay", async () => {
    const { auth, data } = testAuth(); const otp = await signUp(auth);
    expect(data.user[0]?.emailVerified).toBe(false);
    expect(JSON.stringify(data.verification)).not.toContain(otp);
    expect((await auth.handler(request("/sign-in/email", { email: "person@example.com", password: "a-good-password-123" }))).status).toBe(403);
    // Sign-in rotates the verification OTP.
    const currentOTP = (mocks.mail.mock.calls.at(-1)![0] as { text: string }).text.match(/\d{6}/)![0];
    expect((await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp: currentOTP }))).status).toBe(200);
    expect(data.user[0]?.emailVerified).toBe(true);
    expect((await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp: currentOTP }))).status).toBe(400);
  });
  it("rejects expired OTP and limits resend requests", async () => {
    const { auth, data } = testAuth(); const otp = await signUp(auth);
    for (const value of data.verification) value.expiresAt = new Date(Date.now() - 1_000);
    expect((await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp }))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await auth.handler(request("/email-otp/send-verification-otp", { email: "person@example.com", type: "email-verification" }))).status);
    expect(statuses.at(-1)).toBe(429);
  });
  it("locks out repeated incorrect OTP attempts", async () => {
    const { auth } = testAuth(); const otp = await signUp(auth);
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp: wrong }))).ok).toBe(false);
    expect((await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp }))).ok).toBe(false);
  });
  it("resets a password with one-time email OTP and invalidates the old password", async () => {
    const { auth } = testAuth(); const otp = await signUp(auth);
    await auth.handler(request("/email-otp/verify-email", { email: "person@example.com", otp }));
    expect((await auth.handler(request("/email-otp/request-password-reset", { email: "person@example.com" }))).status).toBe(200);
    const resetOTP = (mocks.mail.mock.calls.at(-1)![0] as { text: string }).text.match(/\d{6}/)![0];
    const reset = { email: "person@example.com", otp: resetOTP, password: "replacement-password-123" };
    expect((await auth.handler(request("/email-otp/reset-password", reset))).status).toBe(200);
    expect((await auth.handler(request("/email-otp/reset-password", reset))).ok).toBe(false);
    expect((await auth.handler(request("/sign-in/email", { email: reset.email, password: "a-good-password-123" }))).ok).toBe(false);
    expect((await auth.handler(request("/sign-in/email", { email: reset.email, password: reset.password }))).status).toBe(200);
  });
  it("requires Google verified email as well as verified email-password accounts", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(authOptions().socialProviders?.google).toMatchObject({ requireEmailVerification: true });
  });
  it("does not report successful delivery when SMTP fails", async () => {
    const { auth } = testAuth(); await signUp(auth); mocks.mail.mockRejectedValue(new Error("SMTP unavailable"));
    expect((await runAuthHandler(request("/email-otp/send-verification-otp", { email: "person@example.com", type: "email-verification" }), auth)).status).toBe(503);
  });
});
describe("referral intent", () => {
  it("rejects forged signatures and malformed cookies", () => {
    const signed = signReferralToken("a".repeat(64), "secret");
    expect(verifyReferralToken(signed, "secret")).toBe("a".repeat(64));
    expect(verifyReferralToken(signed, "other")).toBeNull();
    expect(verifyReferralToken(`${signed}.extra`, "secret")).toBeNull();
    expect(verifyReferralToken(`${"a".repeat(64)}.${"é".repeat(43)}`, "secret")).toBeNull();
  });
  it("consumes referral only on new user creation, never on existing account signup", async () => {
    const { auth } = testAuth(true);
    const cookie = `wyckoff_referral=${signReferralToken("b".repeat(64), process.env.BETTER_AUTH_SECRET!)}`;
    mocks.query.mockResolvedValueOnce({ rows: [{ invite_code: "trusted-invite" }] });
    const body = { email: "person@example.com", name: "Person", password: "a-good-password-123" };
    expect((await auth.handler(request("/sign-up/email", body, cookie))).status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(expect.anything(), expect.any(String), "trusted-invite");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM auth_referral_intents"), [expect.any(String)]);
    await auth.handler(request("/sign-up/email", body, cookie));
    expect(mocks.register).toHaveBeenCalledTimes(1);
    await auth.handler(request("/sign-up/email", { ...body, email: "other@example.com" }, cookie));
    expect(mocks.register).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), undefined);
  });
  it("validates origin and invitation before storing an opaque browser-bound intent", async () => {
    const foreign = request("/referral-intent", { code: "invite" }); foreign.headers.set("origin", "https://evil.example");
    expect((await handleAuthRequest(foreign)).status).toBe(403); expect(mocks.query).not.toHaveBeenCalled();
    const response = await handleAuthRequest(request("/referral-intent", { code: "invite" }));
    expect(response.status).toBe(200); expect(mocks.validate).toHaveBeenCalledWith(expect.anything(), "invite");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Lax"); expect(cookie).toContain("Secure"); expect(cookie).not.toContain("invite");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO auth_referral_intents"), [expect.stringMatching(/^[a-f0-9]{64}$/), "invite"]);
  });
});
