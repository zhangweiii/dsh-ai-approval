# dsh-ai-approval

[English](README.md) | 中文

`dsh-ai-approval` 是一个独立的 Cordis 插件，通过单独配置的 LLM route 审查 Agent 的一次性审批请求。它不替换宿主的审批词汇、沙箱 provider 或工具实现。

当 session 使用配置的 `ai-approval` 权限预设时，插件才会生效。它捕获精确的待执行工具 action，构造有界的审查请求，并且仅在风险和授权阈值都通过时返回 `allowed-once`。解析错误、上下文缺失、超时、provider 失败和打开的失败熔断都会失败关闭。

> **默认行为：** 为了像 Codex Auto-review 一样判断用户是否明确授权，Bundle 默认使用 `contextMode: bounded`、`maxRisk: high` 和 `minAuthorization: high`。这会把经过预算限制和尽力脱敏的会话片段发送给 Reviewer route；敏感环境可显式改为 `action-only`，代价是 Reviewer 往往无法确认授权。

## 兼容性

宿主必须提供兼容的 LLM、session、tool、permission preset、system-prompt、timeout 和 user-approval 服务。运维命令还会使用 DSH 可选的 commands 服务；Web 模型选择器会使用 DSH settings 与宿主模型目录 API。缺少这些可选接口时，审批审查仍会工作，但对应的运维 UI 不可用。peer 版本固定在 `package.json` 中，目标运行时为 DSH `0.1.7-alpha.2`，应与宿主保持一致。本包使用独立名称和品牌，不代表任何宿主运行时厂商或模型 provider。

### DSH 0.1.7 的 settings 模型

DSH 0.1.7 用「profile 条目配置表单」取代了 settings _命名空间注册_。插件不再拥有 `ctx.settings.register()`，也没有自己的 settings 命名空间；审批模型改为放在本插件自身的 `Config` 条目上，其中四个 route 字段（`provider`、`model`、`reasoningEffort`、`imageMode`）声明为 `volatile()` —— 这个标记才使字段变为实时可编辑。DSH 的 settings 服务会把这些字段投影到「AI 审批」页面，写入则通过同一 entry 上的 `ctx.configEditor.edit()` 完成。插件注册 `configure({ auto: false })`，让自定义页面成为该条目的界面，而不是与自动生成表单并存。`provider` 与 `model` 仍是必填 schema 字段，因此未配置的 route 会明确报错，而不会用空 route 静默审查。

## 安装与加载

将 DSH Bundle 安装到 Web profile：

```bash
dsh plugin --profile web add dsh-ai-approval
```

重启 `dsh web`，新建或打开 session，然后在权限选择器中选择 **AI Approval**。对应的 session 命令是：

```text
/permission ai-approval
```

Bundle 会自动安装插件并加入用于激活插件的 `ai-approval` preset。Reviewer 默认使用 DSH 的 `deepseek-official` / `deepseek-v4-flash` route，并显式设置 `reasoningEffort: off`，避免模型的默认推理过程耗尽短 JSON 审批结果的输出预算；因此需要先配置该 route 及其凭据。Provider 故障或凭据缺失会失败关闭，绝不会转为授权。

审批结果继续使用 DSH 自带的 `approval/asked`、`approval/decided` 和工具生命周期显示。每次 AI 审批结束后，还会追加一组经过隐私过滤、明确标记为插件来源的 `command/run` / `command/done` 生命周期，其中包含结果、风险、授权判断、理由、策略限制和审批模型。它是 DSH 持久化且不进入模型上下文的通用会话输出通道，因此 Web 与 TUI 会显示同一份审批结果，刷新或重连后仍然保留。Reviewer 的详细判断仍以进程内 `ai-approval/review-started`、`ai-approval/reviewed` 事件提供给同进程观察者，但这些自定义事件不写入 session 历史：截至 DSH 0.1.7-alpha.2，Harness 只在读取路径识别 `ignorable` envelope 标记，生成的已知事件目录也明确推迟了仓库外插件事件的注册接口。Web Conversation Node 仅保留对修复后旧事件的渲染兼容，不修改 DSH 源码。

在 DSH Web 的「设置 → AI 审批」中可以单独选择 Reviewer，不会改变 session 的主模型。该设置页按 provider 分组列出 DSH 已注册 provider 目录返回的全部模型，并通过 DSH Settings 把 `provider`、`model`、可选的 `reasoningEffort` 以及显式的 `imageMode` 同意状态保存到插件配置条目上。DSH 0.1.5 不再向浏览器暴露每个模型的图片模态，因此设置页只为包自带的 Codex route 显示 **视觉** 标记，图片发送改为独立的「关闭/启用」开关；实际发送前 Host 仍会校验该次 prepared route 的模态。修改从下一次审批开始生效；正在进行的审批会固定使用启动时的 route，保证审计信息与实际调用一致。

可以先通过原生运维命令检查当前 session，命令不会联系 Reviewer provider：

```text
/ai-approval status
/ai-approval doctor
```

`status` 显示启用状态、运行时就绪状态、preset、route、策略和隐私模式；`doctor` 还会检查审批 handler 是否已安装、当前 preset 是否激活它，以及持久化 route 设置是否可写，但不会发送模型请求，并禁用该运维命令的原始输入记录。切换 Reviewer route 时，通过下面的命令打开 DSH Web 原生模型选择器：

```text
/ai-approval-models
```

模型命令不要求手动填写 route；选择器列出 DSH 已注册的全部 provider/model，点选后保存到与「设置 → AI 审批」相同的配置，并从下一次审批生效。模型支持推理强度时，命令选择器使用该模型声明的默认强度，之后仍可在设置页单独调整。命令不会配置 provider 或凭据。

Codex 开源实现会为自动审批使用隐藏的 `codex-auto-review` route。本包仅在 DSH 已成功列出 `openai` provider group 时显示该选项，将它标记为支持视觉，并继续通过同一个 DSH LLM adapter 以 low 推理强度请求；它不会读取 OpenAI 凭据、引入 Codex Auth，也不会实现 OpenAI provider。DSH 没有 OpenAI route 时不显示该选项；上游账号若无权使用这个隐藏 route，审批会失败关闭，此时应改选其他 DSH 已列出的模型。

Reviewer 采用单 route 选择，不会并行调用文本与视觉模型：每次审批只使用当前选中的一个 route。只有在 `bounded` 模式下、持久化 `imageMode` 为 `allow`，并且该次 DSH prepared route 的 `inputModalities` 明确包含 `image` 时才会传图；旧配置和手工配置默认 `imageMode: omit`，缺少模态声明按能力未知处理。在设置页启用「图片发送」是持久化 `allow` 的显式操作；切换模型会保留当前同意状态，命令选择器不会改动它。图片引用必须具备一致 metadata，随后去重，并在 `maxImageTokens`（默认 10,000）、`maxImages`（8）、`maxImageBytes`（16 MiB）以及 prepared model 剩余上下文容量的多重预算内优先保留较新的证据；缺少 context-window 声明时按容量未知处理并省略图片。图片发现覆盖 `bounded` 上下文的完整候选集，因此 transcript entry 的预算筛选不会静默隐藏视觉证据；每张已传图片也会获得不受正文截断影响的 transcript 索引标记。未传入的图片会变为显式 `[image omitted — reviewer cannot verify visual content]` 警告，并确定性阻止自动批准。如果携图请求失败且还剩重试次数，下一次会删除全部图片用于诊断性判断，但其结果不能自动批准。

测试本地 checkout 时，先构建再安装当前目录：

```bash
pnpm build
dsh plugin --profile web add .
```

用于其他 Cordis 宿主时，通过其包管理器安装，再通过插件加载器挂载默认导出（`apply`）：

```ts
import { apply as approvalReviewer } from 'dsh-ai-approval'
ctx.plugin(approvalReviewer, {
  presetName: 'ai-approval',
  provider: 'local-reviewer',
  model: 'reviewer-model',
  imageMode: 'omit',
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
- id: dsh-ai-approval
  config:
    presetName: ai-approval
    provider: local-reviewer
    model: reviewer-model
    # reasoningEffort: off # 仅在该 route 明确支持时设置
    imageMode: omit # 仅在审查视觉 provider 后改为 allow
    contextMode: bounded
    maxRisk: high
    minAuthorization: high
    redactPaths: true
    sendSessionId: false
    timeoutMs: 60000
    maxAttempts: 2
    maxInputBytes: 48000
    maxImageTokens: 10000
    maxImages: 8
    maxImageBytes: 16777216
```

DSH profile patch 会整体替换该行的 `config`；需要保留的 Bundle 配置必须全部重述。

`bounded` 会发送精确 action，以及经过独立预算筛选的用户消息、近期可见 Agent 文本、工具调用和结果；隐藏推理不会发送。`maxInputBytes` 限制 Reviewer system 与 user 文本合计的 UTF-8 字节数；精确 action 若无法完整容纳，插件会在准备或联系 Reviewer route 之前以 `input-too-large` 失败关闭，图片使用独立限制。在设置页启用图片发送、且该次审批模型支持视觉后，获准的会话图片也会通过 DSH attachment 与 LLM adapter 跨越 Reviewer provider 边界。直接用户消息才是授权依据，仓库文本、工具参数、图片和 Agent 指令只能作为证据。`action-only` 只发送工具名、call id、参数、工作目录和请求理由，不发送 session 历史或图片。插件会处理常见结构化凭据、Authorization header、带凭据 URL、CLI Basic Auth、JWT 和 provider-shaped key，但凭据和路径脱敏仍然只是尽力而为。

默认策略允许 Reviewer 对用户明确要求、必要、影响范围有限且可回滚的操作返回 `allowed-once`，即使 provider 因跨越工作区边界而将其标成高风险；它不会因为请求使用 `danger-full-access` 这个沙箱标签本身就拒绝。发送私密数据或 secret、探测凭据、广泛或持久削弱安全机制、重大不可逆破坏以及 `critical` 风险操作仍会拒绝。Reviewer 是辅助模型，不是确定性的安全边界。

## 验证

在 checkout 中运行：

```bash
pnpm install --frozen-lockfile
pnpm check       # 格式、历史 secret scan、测试、覆盖率、审计、构建与包 smoke
pnpm build       # JavaScript 与声明构建
```

启用自动一次性审批前，先运行 `/ai-approval doctor`，再验证：session 的权限预设生效；provider route 和 model 可解析；用户明确授权、窄范围且可回滚的请求可得到 `allowed-once`；畸形输出、超时、provider 故障和缺少 execution 都返回非授权结果；`bounded` 只包含预算内的可见上下文并省略隐藏推理；纯文本 route 只产生图片省略警告而不携带 image block；视觉 route 只接收预算内且已去重的图片引用；显式 `action-only` 时没有 session 历史或图片离开宿主。检查进程内审计事件和 provider 日志时不得暴露 secret。

## 故障排查

- **插件没有运行：** 运行 `/ai-approval doctor`，确认 session 当前权限预设与 `presetName` 完全一致（默认 `ai-approval`）。
- **出现 `input-too-large`：** 完整精确 action 无法放入 system/user 合计文本预算。应缩小 action 本身，或经过评估后提高 `maxInputBytes`；插件不会截断 action，也不会在这个失败路径联系 provider。
- **旧 session 报 `SessionFormatUnsupportedError`：** 早期版本曾把 `ai-approval/review-*` 自定义事件写入历史。先停止 DSH，再对完整工作区 session 目录运行 `ai-approval-repair-history <sessions-directory>`；checkout 中可运行 `pnpm history:repair -- <sessions-directory>`。使用 `--check` 可只读复扫并在仍有未标记事件时返回非零退出码。工具也接受单个 `.jsonl.zstd`，只为这两类旧事件补充顶层 `ignorable: true`；只修改受影响文件，覆盖前会分别创建带时间戳的备份，保持原文件权限，并保持 DSH 要求的 Zstandard header 独立 frame。需要系统已安装 `zstd`，不要对正在写入的 session 执行。
- **先看到 `workspace-write` 拒绝：** 插件会通过 system context 要求 Agent 在已知目标位于工作区外时，首次工具调用就申请一次性升级。如果 Agent 仍先按基础沙箱调用，底层拒绝会先显示；独立插件不能吞掉或改写已经发生的工具错误。后续审批通过后仍只以 `allowed-once` 执行精确 action，不会把整个 session 改成 Full Access。
- **出现 `unavailable` 或反复超时：** 独立测试宿主 route，检查 model 标识和凭据；不要盲目提高超时或权限，并检查失败冷却状态。
- **所选模型没有任何推理强度处于选中状态：** 重新选择“默认”（或该模型声明支持的强度）。当前版本会持久化显式默认覆盖，避免组合层的 `off` 等值跨模型泄漏；旧版本可能只把由此产生的 route 失败显示为 `unavailable`。
- **输出解析失败：** 卡片会显示 `output-token-limit`、`malformed-json` 等安全诊断；要求 provider 只返回文档规定的 JSON 对象，关闭 tool calling，并确认没有达到输出上限。对于支持推理等级的 route，可显式设置 `reasoningEffort: off`。
- **意外拒绝：** 检查风险/授权阈值、理由和审计 usage；拒绝是失败关闭行为，不是扩大范围重试的许可。
- **担心敏感数据：** 显式切换到 `action-only`，保持 `sendSessionId: false`，使用保留政策可接受的 provider；若 secret 可能暴露，立即轮换。

## 开发与贡献

参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [docs/adr](docs/adr/)。英文和中文 README 必须同步维护。

## 许可证

MIT License。本独立项目与任何宿主运行时厂商、模型 provider 或 Agent 产品不存在隶属或背书关系。

## 已知限制

- 文本 token 预算按 UTF-8 字节近似；图片 token 使用 provider-neutral 的归一化 tile 估算，并非所选 provider 的 tokenizer。
- 增量游标只在当前进程有效，重启后会丢弃。
- route 不上报 usage 时，provider usage 可能缺失。
- 当前没有为 reviewer 提供独立的只读检查工具。
- DSH 的底层拒绝结果只有通用 `rejected`，因此工具错误可能写成“user rejected”；共享 transcript 摘要与同进程审计事件会提供 Reviewer 的具体判断。
