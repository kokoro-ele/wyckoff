# 登录与邮箱配置

登录始终启用，包括本地开发。没有数据库、认证密钥或固定站点地址时，API 拒绝认证、私人数据和分析请求，前端显示未配置状态。运营方负责设置环境变量；终端用户不需要配置模型密钥。

## 必填环境变量

- `DATABASE_URL`：PostgreSQL 服务端连接字符串。
- `BETTER_AUTH_SECRET`：至少 32 个字符的随机密钥。可用 `openssl rand -base64 32` 生成；不要提交到仓库。
- `BETTER_AUTH_URL`：固定站点 origin，例如 `https://workbench.example.com`；本地使用 `http://localhost:5273`。不要填写路径或随意信任预览域名。
- `WORKSPACE_ENCRYPTION_KEY`：32 字节随机值的十六进制形式，可用 `openssl rand -hex 32` 生成。保持稳定，否则无法解密已有工作区。
- `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`：运营方模型服务配置，仅在服务端使用。

`.env.example` 包含配置名称。开发服务与数据库迁移脚本都会读取仓库根目录的 `.env` 和 `.env.local`（后者优先），也可通过进程环境提供配置。生产环境在部署平台设置相同变量，更新后重启/重新部署。不要把真实密钥放进浏览器变量或提交到 Git。

## Google 登录

在 Google OAuth 中创建 Web 应用客户端，设置网站的 JavaScript origin 为 `BETTER_AUTH_URL`，授权重定向 URI 为 `BETTER_AUTH_URL/api/auth/callback/google`。将客户端 ID 和 secret 分别设置到 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。测试模式下只允许 Google 控制台已添加的测试用户。

仅 Google 返回的已验证邮箱可通过 OAuth 登录；服务端仍检查邮箱验证状态再开放私人数据与额度。邀请码由注册前同源请求保存为 15 分钟有效的服务端记录，浏览器持有带签名的 HttpOnly/SameSite=Lax Cookie；OAuth 跳转后仅创建新账号时消费一次。已有账号登录不会绑定新邀请人。

## 邮箱注册与密码找回

设置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_FROM`；需要认证的发件服务再填写 `SMTP_USER`、`SMTP_PASS`。端口默认 587，要求 STARTTLS；465 使用隐式 TLS。`SMTP_FROM` 应为邮件服务商已验证的发件地址。本地 Mailpit 等无认证 catcher 可以不填用户名密码。缺少 `SMTP_HOST`/`SMTP_FROM` 时邮箱注册和找回按钮不可用；Google 可独立使用。

邮箱注册要求至少 12 字符密码。注册后发送六位验证码，有效期 5 分钟，数据库仅保存哈希，最多允许 3 次尝试。重发会替换旧验证码；发送和验证端点有每 IP 每分钟 3 次限流，认证全局每分钟 30 次限流，状态保存在数据库。密码找回同样使用验证码，重置后旧密码和已有会话失效。SMTP 失败会返回 503，界面不会声称发送成功；已创建的未验证账号可回到登录并重新发送验证码。

## 初始化与验收

1. 在部署前运行 `pnpm -F @wyckoff/server db:migrate`。它创建 Better Auth、工作区、账单和额度表，并为数据库限流/邮箱验证码提供存储。数据库账号需要迁移权限。
2. 检查 `/api/auth/providers`：只返回 `ready`、`email`、`google` 三个布尔值，不返回凭据。
3. 使用运营方明确指定的测试邮箱注册，确认收到验证码、错误码被拒绝、正确码只能使用一次、验证后进入工作区。
4. 用邀请码完成另一新账号注册；该账号验证后领取 3 次，邀请人增加 3 次，重复登录不再增加。
5. 测试 Google 回调、新账号邀请、退出登录、密码找回及旧密码失效。

自动测试通过内存适配器调用真实 Better Auth HTTP 端点，覆盖验证前拒绝登录、OTP 哈希/过期/重放/错误尝试/限流、密码重置、SMTP 失败及新用户邀请钩子；SMTP 传输为 mock，不会发送真实邮件。

额度与工作区的 Postgres 事务测试需要独立测试库：

```bash
TEST_DATABASE_URL=postgres://… pnpm -F @wyckoff/server test
```

这些测试会清空 fixture 表，禁止指向生产库。真实 Google OAuth、SMTP 收信以及生产 PostgreSQL 配置仍需运营方在配置完成后按上述步骤联调。未经指定目标邮箱，不发送试信。
