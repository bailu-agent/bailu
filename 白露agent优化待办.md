# 白露 agent 优化待办

> 整理自 2026-09-21 讨论（未动手，仅规划）
> 更新 2026-09-24：① 落地完成（baseline + docs 全量审计，30 页全绿，修 14 个 doc bug + 1 个代码 bug）
> 仓库：`~/Documents/bailu-agent`（pi fork，改名 bailu）
> 状态约定：📝 未启动 / 🚧 进行中 / ✅ 完成

## 定位总述

bailu 是 pi(pi-mono) 的 fork，架构底子好：统一多 provider 层（`packages/ai`）、agent harness 有 lane、session 是 `id/parentId` 可分支的树。

**优化关键不是补功能，而是先想清楚「bailu 要当哪种 agent」。** 新 tagline「Vibe Learning and Vibe Leaping」本身就是一个方向信号。以下按性价比从高到低排列，每一项都标了仓库抓手，避免空谈。

---

## 一、评估与度量（最优先 —— 地基）

> 没有度量，后续任何优化都是盲改。这是第一优先级。

- [x] ✅ **eval 基建已比待办更全**（2026-09-23 复核）：`packages/evals` 有 `src/bailu-harness.ts`（真实 AgentSession 适配）、`vitest-evals/harness-table.ts`（baseline/candidate/judge 对比表）、artifact 落盘、`scripts/run-evals.mjs`，已有 3 套 `smoke` / `docs`（文档↔实现一致性审计）/ `extensions`（作者流程对比）
- [x] ✅ **① baseline + docs 全量审计完成（2026-09-24）**：`packages/evals/BASELINE.md`
  - **qwen3.6-plus 基线（2026-09-23）**：smoke PASS；extensions 双 arm 0/1（qwen3.6-plus 下不走 `.bailu/extensions/hello.ts`、不真调 hello 工具）→ 模型行为发现，锚定后续 prompt/模型对比的起点
  - **docs 30 页全量审计（2026-09-24）**：qwen 的 Go 套餐额度用尽（`429 GoUsageLimitError`）后改用 **`deepseek`/`deepseek-flash`** 跑完；30 页最终**全绿**。本次累计 ≈$4.6（含基线轮 $0.93）
  - **抓到 14 个真实 doc↔实现矛盾**（首轮 2 + 补扫 11 + 全量复跑 3），全部已修并复验；另修 1 个**代码 bug**：`model-config.ts` 的 `$var` schema 漏了 `thinking.budget`（类型/实现都支持）
  - ⚠️ **关键结论（直接影响门禁设计）**：docs 审计是**有界抽样**——每轮只报它找到的矛盾，不穷尽一页。**`mismatch` 是强信号（必有真 bug），`match` ≠ 已证明干净**（全量那轮又在两个此前判 ✓ 的页上挖出新问题）。所以**单跑一次不足以当门禁，需多次采样**——挂 CI 门禁前要先把这点设计进去
  - ⏭️ 未做：用 baseline 挂 CI 门禁（受上一条约束）
  - ②③④⑤ 的度量都压在这条上；⑤ 模型路由与它有循环依赖，必须先有 baseline 才能证明「省钱不掉分」
- [ ] 📝 给每次改动挂「eval + 测试」双门禁（测试侧已干净，见附注——本地失败现在可直接当信号）
- [ ] 📝 接 `packages/telemetry`（Vendor-neutral 契约已在）：**但实测 agent 运行时 `startSpan` 用量 = 0，漏斗未建立**。单用户 ROI 低 → 降级为「有真用户后再接」；现行门禁靠 eval 自带的 token/latency/cost 已够

抓手：`packages/evals/`、`packages/telemetry/`、`.github/workflows/ci.yml`

## 二、上下文与记忆（coding agent 最大的质量杠杆）

- [ ] 📝 **压缩策略优化**：`core/compaction/compaction.ts` + `branch-summarization.ts` 已现成
  - 触发策略（阈值、时机）调优
  - 摘要质量（保什么、丢什么）
  - 旧工具输出（长 bash 输出）清理
  - 直接决定长会话会不会「失忆」
- [ ] 📝 **跨会话记忆进 agent 本体**：把 `.workbuddy/memory/` 的 pattern（常规记忆 + 日志 + 索引 MEMORY.md）搬进 bailu 自己
  - 项目级记忆、失败经验沉淀，呼应「Learning」
- [ ] 📝 **利用 session 树**（`id/parentId` 分支）：支持「实验分支 + 主分支」工作流

抓手：`packages/coding-agent/src/core/compaction/`、`core/session-manager.ts`、`.workbuddy/memory/`

## 三、规划-执行-验证循环（质量来自行为纪律，不来自模型聪明）

- [ ] 📝 动手前规划：读全相关上下文再改
- [ ] 📝 改完自检：跑测试（仓库测试基建已全）
- [ ] 📝 完成前「自我批评」关卡（critical review 环节）
- [ ] 📝 工具调用纪律：读文件先全量读、改后 grep/diff 复验（这些教训已写在 `.bailu/` 和记忆里，可固化进 system prompt）

主要落在 `packages/coding-agent/src/` 的 agent 主循环与 prompt 组装处

## 四、工具层可靠性

- [x] ✅ **find/grep 在无 rg/fd 时兜底**（commit `bfbbf51bd`，`src/core/tools/search-fallback.ts`）——工具可靠性这条先修掉一大块
- [ ] 📝 Edit 兼容性、Bash 超时、错误上报
- [ ] 📝 **沙箱默认化**：`docs/containerization.md` 已有三套方案（Gondolin 扩展 / 纯 Docker / OpenShell）→ 能否做成默认开关，涉及安全定位决策

抓手：`packages/coding-agent/src/core/tools/find.ts`、`packages/coding-agent/docs/containerization.md`

## 五、模型路由与成本

- [ ] 📝 `packages/ai` 是统一多 provider 层，目前一路用同一模型
  - 按任务难度路由：简单编辑用便宜/快模型，规划/复杂推理用强模型
  - thinking 级别自动决策
  - prompt/会话缓存利用
- [ ] 📝 省钱 + 提速，方向独立于质量优化

抓手：`packages/ai/`、`core/model-config.ts`、`core/provider-composer.ts`

## 六、定位与独特体验（fork 的灵魂）

- [ ] 📝 默认内置 skill 包（`.bailu/skills/`）、预设 prompts（`.bailu/prompts/`）、默认扩展（`.bailu/extensions/`）
  - ⚠️ 2026-09-23 复核：三个目录**已非空**（skills 3 / prompts 6 / extensions 4），但内容是**本仓库自身 dev 工作流**（interactive-testing、release、redraws…），不是「用户开箱即用的 bailu 风味」——区分「项目级设定」与「发布级默认包」，后者才是真正待办
- [ ] 📝 品牌/发布口径收口（见下「fork 健康问题」）

## 附：fork 健康问题（不修会一直别扭）

- [x] ✅ **本地 `./test.sh` 已全绿（2026-09-23 实测，退出码 0）**，原 22 项「环境性失败」全部关闭
  - 缺 rg/fd 的 15 项 → commit `bfbbf51bd`（`src/core/tools/search-fallback.ts` 纯 Node 兜底）关掉；实测 `tools.test.ts` + `search-fallback.test.ts` + `session-selector-search.test.ts` **113 全过**
  - chord delta 栈溢出 → 实测 `packages/chord/test/delta.test.ts` **100 过**
  - 高并发 flake → 本次未复现，仍是时序 flake（复跑即过）
  - **结论反转：本地失败现在可以直接当真信号**，不必再先靠 CI 仲裁；「eval + 测试」双门禁里的门禁侧已经是干净的

---

## 建议顺序

**① 评估与度量 → ② 上下文/记忆 → ③ 循环纪律 → ④ 工具可靠性 → ⑤ 模型路由**

①②收益最大，其余锦上添花。六（定位）可以并行思考，不必等。

每条立项后再回填状态、细化拆解到文件级。