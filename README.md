# Wyckoff Agent Workbench

[English](./README.en.md) · **简体中文**

面向单标的量价研究的本地 AI 工作台：专业 K 线画布、Wyckoff 结构分析、语义标注、匿名 AI 计划回测，以及可审计的确定性交易回放。

> 本项目用于研究与教育，不构成投资建议、收益承诺或自动交易服务。

![AAPL 自动 Wyckoff 分析：交易区间、事件标记、支撑阻力与趋势线](./docs/screenshots/workbench.jpg)

上图以 AAPL 为演示。点击「自动分析」后，Agent 会把交易区间、Wyckoff 事件、支撑阻力与趋势线直接绘制到 K 线画布，并在右侧保留对应分析与工具轨迹。

## 为什么做这个项目

传统技术分析工具常把“指标、选股、轮换、模型结论”混在一起，结果难解释，也难验证。这个工作台把流程拆成三个清晰层次：

1. **事实层**：K 线、成交量、摆动点与交易区间。
2. **判断层**：AI 只负责解释 Wyckoff 阶段、事件和量价证据。
3. **执行层**：入场触发、仓位、费用、止损和退出由确定性代码处理。

因此每个结论都能追溯到对应 K 线，每份计划都能在历史数据上重新执行。

## 核心功能

- **专业 K 线工作台**：缩放、平移、十字光标、多周期、复权、指标与绘图工具。
- **Wyckoff Agent**：识别 Phase A–E、SC、AR、ST、Spring、SOS、LPS、UTAD、SOW 等结构，并直接绘制到图表。
- **匿名 AI 回测**：单只股票映射为 `ASSET_001`，模型只接收归一化日线 OHLCV 和匿名 BAR 编号。
- **逐份交易计划**：每个历史决策点分别输出观察、入场或退出计划，以及入场、止损、目标、证据、待确认项和失效条件。
- **确定性成交回放**：下一根 K 线起执行，计入仓位、佣金、滑点、最长持有、止盈止损和 A 股 T+1。
- **完整审计**：保存提示词版本、模型、匿名输入哈希、Token、延迟、缓存命中、协议失败和回测数据指纹。
- **本地 Key 设置**：无需手动编辑配置文件；Key 保存后立即生效，并且永不从接口回显。
- **搜索、收藏与分组**：支持代码、名称和拼音首字母搜索，以及本地观察列表。

## 产品界面

| 本地 API Key 设置 | 匿名 AI 计划回测 |
| --- | --- |
| ![安全的 API Key 设置页](./docs/screenshots/key-settings.jpg) | ![匿名 AI Wyckoff 回测页](./docs/screenshots/ai-backtest.jpg) |

## 匿名 AI 回测如何工作

```text
单只股票历史 OHLCV
        ↓
因果候选扫描（只使用当时已有数据）
        ↓
代码/名称/日期移除，价格与成交量归一化
        ↓
每个时点独立进行一次纯 Wyckoff AI 判读
        ↓
严格校验 BAR 证据、Phase、事件和价格边界
        ↓
确定性交易引擎逐根执行计划
        ↓
权益曲线、交易、计划状态与完整审计
```

模型看不到：

- 股票代码、名称或交易所；
- 日期、新闻、财报、行业、指数或宏观信息；
- 均线、MACD、RSI、KDJ、BOLL、ATR 等技术指标；
- 决策时点之后的任何 K 线。

模型只判断结构，不能控制仓位、费用或成交规则。解析失败不会反复采样到“满意答案”，也不会补造交易。

## 快速开始

### 环境要求

- Node.js 20.11 或更高版本
- pnpm 9

### 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- 前端：<http://127.0.0.1:5273>
- 后端：<http://127.0.0.1:8787>
- Wyckoff 方法说明：<http://127.0.0.1:5273/wyckoff.html>

首次启动会同步标的索引到本地 SQLite。TickFlow 免费接口无需 Key，但仅提供日线及以上周期。

## 配置 API Key

推荐方式：启动应用后，点击右侧 Agent 顶部的钥匙按钮，在“API Key 连接设置”中填写：

- OpenAI 或兼容网关的 API Key；
- Base URL；
- 模型 ID；
- 常规 Agent 是否允许联网搜索。

页面保存的配置位于 `data/runtime-settings.json`，保存后立即生效。密码输入框不会预填，API 也不会返回 Key。

也可以继续使用根目录 `.env`：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
OPENAI_WEB_SEARCH=1
```

页面保存的非空 Key 优先于 `.env`；移除页面 Key 后会自动回退到环境变量。

## 密钥安全

- `.env`、`.env.*`、`data/`、数据库、构建产物和本地缓存均已加入 `.gitignore`。
- `.env.example` 只包含空 Key 和安全默认值。
- 本地设置文件采用原子写入，权限强制为 `0600`。
- Key 不进入 Zustand、`localStorage`、`sessionStorage`、URL、日志或 API 响应。
- 服务仅监听 `127.0.0.1`，设置写接口只接受经过严格校验的 JSON。

如果某个 Key 曾经被提交、截图、粘贴到 Issue 或发送到不可信服务，仅仅添加 `.gitignore` 不够，请立即在服务商后台撤销并轮换该 Key。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TICKFLOW_BASE_URL` | `https://free-api.tickflow.org` | TickFlow 行情地址 |
| `TICKFLOW_API_KEY` | 空 | 付费行情 Key，可解锁分钟线与实时能力 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `OPENAI_API_KEY` | 空 | 模型 Key，也可在设置页配置 |
| `OPENAI_MODEL` | `gpt-4o` | 模型 ID |
| `OPENAI_WEB_SEARCH` | `1` | 常规 Agent 是否启用 Responses `web_search`；匿名回测始终关闭联网 |
| `RECOMMEND_ENABLED` | `1` | 是否启用美股收盘后扫描任务 |
| `RECOMMEND_CONCURRENCY` | `3` | 荐股复核并发数 |
| `SMTP_*` / `MAIL_TO` | 空 | 可选邮件推送配置 |
| `PORT` | `8787` | 后端端口 |
| `DATA_DIR` | `./data` | SQLite 与本地运行时设置目录 |

完整模板见 [`.env.example`](./.env.example)。

## 常用命令

```bash
pnpm dev          # 同时启动前后端
pnpm typecheck    # 全仓 TypeScript 检查
pnpm test         # 全量测试
pnpm lint         # ESLint
pnpm build        # 生产构建
```

## 项目结构

```text
apps/web                 React + Vite 产品界面
apps/server              Hono API、模型调用、后台任务与 SQLite
packages/shared          共享类型、Zod 协议与 API 契约
packages/wyckoff         特征、结构、候选扫描与回测引擎
docs/screenshots         README 产品截图
data                     本地数据库与运行时 Key（Git ignored）
```

## 关键实现原则

- Agent 输出领域语义，不输出像素坐标；前端负责映射到 K 线图层。
- 匿名回测在收盘后形成计划，最早从下一根 K 线触发，避免未来函数。
- 同根同时触及止损和目标时按止损优先；日线无法还原根内路径，因此采用保守假设。
- 沪深京股票买入当根不允许退出，按 T+1 模拟。
- 相同模型、提示词版本与匿名输入会命中缓存，减少重复费用。
- AI 计划回测 API 位于 `/api/wyckoff-ai-backtests`；本地连接设置 API 位于 `/api/settings`。
