import { workspaceContext } from "./context.js";
import { handleBillingWebhook } from "../billing/index.js";
import { getPool } from "./postgres.js";
import { createCreditsRouter } from "../credits/index.js";
import { grantVerifiedCredits } from "../credits/store.js";
import { waitUntil } from "@vercel/functions";
import { app } from "../app.js";
import { getAuth, handleAuthRequest } from "./auth.js";
import { WorkspaceTooLargeError, withWorkspace } from "./workspace.js";
import { withPublicWorkspace } from "./public.js";

const encoder = new TextEncoder();

function startJobs(userId: string, jobs: Array<() => Promise<unknown>>) {
  if (!jobs.length) return;
  waitUntil(
    (async () => {
      for (const job of jobs) {
        await withWorkspace(userId, true, async () => {
          await job();
        });
      }
    })().catch(() => {
      console.error("[workspace] Background task failed");
    }),
  );
}

const PUBLIC_GET_PATHS = new Set([
  "/api/klines",
  "/api/capabilities",
  "/api/search",
  "/api/research",
  "/api/chat/status",
]);

function isPublicRequest(request: Request, path: string): boolean {
  return (
    request.method === "GET" &&
    (PUBLIC_GET_PATHS.has(path) || path.startsWith("/api/instrument/"))
  );
}

function trustedOrigin(request: Request): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall back to the request origin below */
    }
  }
  return new URL(request.url).origin;
}

export async function cloudFetch(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/billing/webhooks/stripe") {
      return await handleBillingWebhook(request, getPool());
    }
    if (path === "/api/billing/webhooks/wechat") {
      return Response.json({ code: "NOT_FOUND", message: "接口不存在" }, { status: 404 });
    }

    if (path.startsWith("/api/auth/")) return await handleAuthRequest(request);
    if (path === "/api/health") return Response.json({ ok: true, backend: "vercel", storage: "postgres" });

    if (isPublicRequest(request, path)) {
      const response = await withPublicWorkspace(async () => await app.fetch(request));
      response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return response;
    }

    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return Response.json({ code: "UNAUTHORIZED", message: "请先登录" }, { status: 401 });
    if (!session.user.emailVerified) {
      return Response.json({ code: "EMAIL_UNVERIFIED", message: "请先验证邮箱" }, { status: 401 });
    }

    const origin = request.headers.get("origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin !== trustedOrigin(request)) {
      return Response.json({ code: "FORBIDDEN", message: "请求来源无效" }, { status: 403 });
    }

    // A referral bookkeeping failure must not take down every authenticated API.
    try {
      await grantVerifiedCredits(getPool(), session.user.id);
    } catch (error) {
      console.error("[credits] verified grant failed:", error instanceof Error ? error.message : error);
    }

    if (path.startsWith("/api/credits/")) {
      const billing = createCreditsRouter(getPool(), session.user.id);
      const url = new URL(request.url);
      url.pathname = path.slice("/api/credits".length);
      const response = await billing.fetch(new Request(url, request));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    if (request.method === "POST" && (path === "/api/chat" || path === "/api/chat/")) {
      const channel = new TransformStream<Uint8Array, Uint8Array>();
      const writer = channel.writable.getWriter();
      let clientGone = false;

      const write = async (chunk: Uint8Array) => {
        if (clientGone) return;
        try {
          await writer.write(chunk);
        } catch {
          // The browser disconnected. Keep draining the agent stream so the
          // completed analysis can still be persisted and accounted for.
          clientGone = true;
        }
      };
      const writeEvent = async (event: unknown) => {
        await write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      waitUntil(
        withWorkspace(session.user.id, true, async () => {
          const response = await app.fetch(request);
          if (!response.ok) {
            const detail = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
            await writeEvent({ type: "error", message: detail.message ?? detail.error ?? "请求失败，请重试" });
            return;
          }
          if (response.body) {
            const reader = response.body.getReader();
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                if (clientGone) continue;
                await write(chunk.value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          return workspaceContext.getStore()?.state.get("chatDone");
        })
          .then(async ({ value, deferred }) => {
            if (value) await writeEvent(value);
            startJobs(session.user.id, deferred);
            if (!clientGone) await writer.close().catch(() => undefined);
          })
          .catch(async (error: unknown) => {
            const message =
              error instanceof WorkspaceTooLargeError
                ? error.message
                : "对话未能保存，请重试";
            console.error("[workspace] Chat failed:", error instanceof Error ? error.message : error);
            await writeEvent({ type: "error", message });
            if (!clientGone) await writer.close().catch(() => undefined);
          }),
      );

      return new Response(channel.readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const { value, deferred } = await withWorkspace(
      session.user.id,
      !["GET", "HEAD"].includes(request.method),
      async () => await app.fetch(request),
    );
    startJobs(session.user.id, deferred);
    value.headers.set("Cache-Control", "private, no-store");
    return value;
  } catch (error) {
    console.error("[cloud] Request failed:", error instanceof Error ? error.message : error);
    if (error instanceof WorkspaceTooLargeError) {
      return Response.json({ code: "WORKSPACE_FULL", message: error.message }, { status: 413 });
    }
    return Response.json(
      { code: "SERVICE_UNAVAILABLE", message: "云端服务暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }
}
