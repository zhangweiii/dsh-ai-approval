# ai-approval-reviewer

[English](README.md) | 中文

`ai-approval-reviewer` 是一个独立的 Cordis 插件，通过单独配置的 LLM route 审查 Agent 的一次性审批请求。它不替换宿主的审批词汇、沙箱 provider 或工具实现。

当 session 使用配置的 `ai-approval` 权限预设时，插件才会生效。它捕获精确的待执行工具 action，构造有界的审查请求，并且仅在风险和授权阈值都通过时返回 `allowed-once`。解析错误、上下文缺失、超时、provider 失败和打开的失败熔断都会失败关闭。

> **默认行为：** 为了像 Codex Auto-review 一样判断用户是否明确授权，Bundle 默认使用 `contextMode: bounded`、`maxRisk: high` 和 `minAuthorization: high`。这会把经过预算限制和尽力脱敏的会话片段发送给 Reviewer route；敏感环境可显式改为 `action-only`，代价是 Reviewer 往往无法确认授权。

## 兼容性

宿主必须提供兼容的 LLM、session、tool、permission preset、system-prompt、timeout 和 user-approval 服务。Web 模型选择器还会使用 DSH 的 settings 与宿主模型目录 API；缺少这些可选接口时，Bundle 配置的 route 仍会工作，但选择器不可用。peer 版本固定在 `package.json` 中，应与宿主运行时保持一致。本包使用独立名称和品牌，不代表任何宿主运行时厂商或模型 provider。

## 安装与加载

将 DSH Bundle 安装到 Web profile：

```bash
dsh plugin --profile web add ai-approval-reviewer
```

重启 `dsh web`，新建或打开 session，然后在权限选择器中选择 **AI Approval**。对应的 session 命令是：

```text
/permission ai-approval
```

Bundle 会自动安装插件并加入用于激活插件的 `ai-approval` preset。Reviewer 默认使用 DSH 的 `deepseek-official` / `deepseek-v4-flash` route，并显式设置 `reasoningEffort: off`，避免模型的默认推理过程耗尽短 JSON 审批结果的输出预算；因此需要先配置该 route 及其凭据。Provider 故障或凭据缺失会失败关闭，绝不会转为授权。

审批结果继续使用 DSH 自带的 `approval/asked`、`approval/decided` 和工具生命周期显示。Reviewer 的详细判断以进程内 `ai-approval/review-started`、`ai-approval/reviewed` 事件提供给同进程观察者，不再写入 session 历史：DSH rc.7 尚未提供三方包注册可忽略持久化事件的 API，写入自定义事件会让其他 Harness 拒绝加载历史。Web Conversation Node 仅保留对旧事件的渲染兼容，不修改 DSH 源码。

在 DSH Web 的「设置 → AI 审批」中可以单独选择 Reviewer，不会改变 session 的主模型。该设置页按 provider 分组列出 DSH 已注册 provider 目录返回的全部模型，并且只在 DSH Settings 中保存 `provider`、`model` 和可选的 `reasoningEffort`。修改从下一次审批开始生效；正在进行的审批会固定使用启动时的 route，保证审计信息与实际调用一致。

也可以在 DSH Web 中执行命令打开原生模型选择器：

```text
/ai-approval-models
```

命令不要求手动填写 route；选择器列出 DSH 已注册的全部 provider/model，点选后保存到与「设置 → AI 审批」相同的配置，并从下一次审批生效。模型支持推理强度时，命令选择器使用该模型声明的默认强度，之后仍可在设置页单独调整。命令不会配置 provider 或凭据。

Codex 开源实现会为自动审批使用隐藏的 `codex-auto-review` route。本包仅在 DSH 已成功列出 `openai` provider group 时显示该选项，并继续通过同一个 DSH LLM adapter 以 low 推理强度请求；它不会读取 OpenAI 凭据、引入 Codex Auth，也不会实现 OpenAI provider。DSH 没有 OpenAI route 时不显示该选项；上游账号若无权使用这个隐藏 route，审批会失败关闭，此时应改选其他 DSH 已列出的模型。

测试本地 checkout 时，先构建再安装当前目录：

```bash
pnpm build
dsh plugin --profile web add .
```

用于其他 Cordis 宿主时，通过其包管理器安装，再通过插件加载器挂载默认导出（`apply`）：

```ts
import { apply as approvalReviewer } from 'ai-approval-reviewer'
ctx.plugin(approvalReviewer, {
  presetName: 'ai-approval',
  provider: 'local-reviewer',
  model: 'reviewer-model',
  contextMode: 'bounded',
  maxRisk: 'high',
  minAuthorization: 'high',
  redactPaths: true,
  sendSessionId: false,
})
```

DSH 以外的具体加载语法由宿主决定。若宿主使用不同的插件注册 API，请先适配，不要直接复制示例。

## Provider 与策略配置

`provider` 是在宿主中独立注册的 LLM route，`model` 是该 route 上的标识符。`provider: local` 不是内置 provider；应先在宿主注册并测试 route，再在此配置。敏感仓库优先使用本地或合同允许的 provider，并审查数据保留、训练、地域和日志条款。

在 DSH Web 中，普通 route 切换优先使用「设置 → AI 审批」，不必修改 YAML。该设置页不会配置 provider 或凭据：先通过 DSH 完成配置，再重新打开设置页；新激活的 provider 会来自 DSH 模型目录。除上述已激活 `openai` group 下的隐藏 Codex route 外，插件不会合成未注册或未认证的 provider。

如需覆盖 Bundle 默认值，在 DSH profile 的 `cordis.patch.yml` 中替换完整插件行：

```yaml
- id: ai-approval-reviewer
  config:
    presetName: ai-approval
    provider: local-reviewer
    model: reviewer-model
    # reasoningEffort: off # 仅在该 route 明确支持时设置
    contextMode: bounded
    maxRisk: high
    minAuthorization: high
    redactPaths: true
    sendSessionId: false
    timeoutMs: 60000
    maxAttempts: 2
```

DSH profile patch 会整体替换该行的 `config`；需要保留的 Bundle 配置必须全部重述。

`bounded` 会发送精确 action，以及经过独立预算筛选的用户消息、近期可见 Agent 文本、工具调用和结果；隐藏推理不会发送。直接用户消息才是授权依据，仓库文本、工具参数和 Agent 指令只能作为证据。`action-only` 只发送工具名、call id、参数、工作目录和请求理由，不发送 session 历史。凭据和路径脱敏只是尽力而为。

默认策略允许 Reviewer 对用户明确要求、必要、影响范围有限且可回滚的操作返回 `allowed-once`，即使 provider 因跨越工作区边界而将其标成高风险；它不会因为请求使用 `danger-full-access` 这个沙箱标签本身就拒绝。发送私密数据或 secret、探测凭据、广泛或持久削弱安全机制、重大不可逆破坏以及 `critical` 风险操作仍会拒绝。Reviewer 是辅助模型，不是确定性的安全边界。

## 验证

在 checkout 中运行：

```bash
pnpm install --frozen-lockfile
pnpm check       # 测试与类型检查
pnpm build       # JavaScript 与声明构建
```

启用自动一次性审批前，应验证：session 的权限预设生效；provider route 和 model 可解析；用户明确授权、窄范围且可回滚的请求可得到 `allowed-once`；畸形输出、超时、provider 故障和缺少 execution 都返回非授权结果；`bounded` 只包含预算内的可见上下文并省略隐藏推理；显式 `action-only` 时没有 session 历史离开宿主。检查进程内审计事件和 provider 日志时不得暴露 secret。

## 故障排查

- **插件没有运行：** 确认 session 当前权限预设与 `presetName` 完全一致（默认 `ai-approval`）。
- **旧 session 报 `SessionFormatUnsupportedError`：** 早期版本曾把 `ai-approval/review-*` 自定义事件写入历史。先停止 DSH，再对完整工作区 session 目录运行 `ai-approval-repair-history <sessions-directory>`；checkout 中可运行 `pnpm history:repair -- <sessions-directory>`。使用 `--check` 可只读复扫并在仍有未标记事件时返回非零退出码。工具也接受单个 `.jsonl.zstd`，只为这两类旧事件补充顶层 `ignorable: true`；只修改受影响文件，覆盖前会分别创建带时间戳的备份，并保持 DSH 要求的 Zstandard header 独立 frame。需要系统已安装 `zstd`，不要对正在写入的 session 执行。
- **先看到 `workspace-write` 拒绝：** 插件会通过 system context 要求 Agent 在已知目标位于工作区外时，首次工具调用就申请一次性升级。如果 Agent 仍先按基础沙箱调用，底层拒绝会先显示；独立插件不能吞掉或改写已经发生的工具错误。后续审批通过后仍只以 `allowed-once` 执行精确 action，不会把整个 session 改成 Full Access。
- **出现 `unavailable` 或反复超时：** 独立测试宿主 route，检查 model 标识和凭据；不要盲目提高超时或权限，并检查失败冷却状态。
- **输出解析失败：** 卡片会显示 `output-token-limit`、`malformed-json` 等安全诊断；要求 provider 只返回文档规定的 JSON 对象，关闭 tool calling，并确认没有达到输出上限。对于支持推理等级的 route，可显式设置 `reasoningEffort: off`。
- **意外拒绝：** 检查风险/授权阈值、理由和审计 usage；拒绝是失败关闭行为，不是扩大范围重试的许可。
- **担心敏感数据：** 显式切换到 `action-only`，保持 `sendSessionId: false`，使用保留政策可接受的 provider；若 secret 可能暴露，立即轮换。

## 开发与贡献

参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [docs/adr](docs/adr/)。英文和中文 README 必须同步维护。

## 许可证

MIT License。本独立项目与任何宿主运行时厂商、模型 provider 或 Agent 产品不存在隶属或背书关系。

## 已知限制

- Token 预算是基于 UTF-8 字节的近似值，而非 provider tokenizer。
- 增量游标只在当前进程有效，重启后会丢弃。
- route 不上报 usage 时，provider usage 可能缺失。
- 当前没有为 reviewer 提供独立的只读检查工具。
- DSH 的底层拒绝结果只有通用 `rejected`，因此工具错误可能写成“user rejected”；详细 Reviewer 判断目前仅通过同进程审计事件提供。
