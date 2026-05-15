# Codex Review 报告（R2）：Log-Scrubber-GUI

> 评审日期：2025-12-25  
> 评审范围：`D:\pro_note\my-js-toolkit\scripts\Log-Scrubber-GUI`  
> 对照基线：上次报告 `CODEX_REVIEW_20251225.md`  
> 评审方式：静态代码审查 + 最小运行复测（Node 调用核心模块）+ 依赖审计

## 1. R2 摘要

- **核心链路已恢复可用**：`src/core/processor.js` 的阻断性错误已修复，样例日志可成功输出（见“复测结果”）。
- **仍存在多处 P0 UI 运行时错误**：`app.js` / `config-panel.js` 里的定时器清理逻辑仍会触发 `ReferenceError`；新增的暂停/继续逻辑会调用不存在的 `this.showMessage()`。
- **新开关未贯通主进程**：`enableMasking/maskUrlParams` 已加入 UI 与 `LogScrubber`，但主进程 `main.js:105` 的 `normalizeScrubberOptions()` 未透传这两个字段，导致 GUI 中的开关**大概率不生效**。
- **依赖风险仍在**：Electron 仍为 `28.3.3`，`npm audit` 仍提示 `GHSA-vmqv-hx8q-j7mg`（moderate）。

## 2. 近期改动集中点（按更新时间）

本次目录内最近改动集中在：
- 核心：`src/core/processor.js`、`src/core/scrubber.js`、`src/core/config.js`
- 渲染层：`src/renderer/scripts/app.js`、`src/renderer/scripts/config-panel.js`、`src/renderer/index.html`
- 安全桥：`src/preload.js`
- 组件：`src/renderer/components/drag-drop.js`

## 3. 复测结果（关键路径）

### 3.1 文件处理（已通过）

- 复测：Node 直接调用 `FileProcessor.processFile('./test-sample.log')`
- 结果：成功生成 `test-sample.masked.log`，并返回统计信息（`success: true`）
- 相关代码：`src/core/processor.js:217-231`（已移除上次报告中的 `Promise.all` 错误解构）

### 3.2 JSON/结构化日志脱敏（仍不足）

- 复测输入：`{"password":"secret","token":"abc123","email":"user@example.com"}`
- 结果：`email` 会被正则脱敏，但 `password/token` **不会**按敏感键脱敏（仍保留明文）
- 根因：`src/core/scrubber.js:69-101` 的 KV 规则不覆盖 JSON key/value 结构；当前也未实现 `JSON.parse` + 递归脱敏

## 4. 当前问题清单（按优先级）

### P0 - Critical（会抛异常/影响主流程）

1) **错误提示 showError：定时器变量作用域错误**
- 位置：`src/renderer/scripts/app.js:574-594`
- 问题：`cleanup()` 内调用 `clearTimeout(timeoutId)`，但 `timeoutId` 在 `if (container) { const timeoutId = ... }` 内定义，关闭按钮或自动清理时会 `ReferenceError`

2) **配置面板 showMessage：定时器变量作用域错误**
- 位置：`src/renderer/scripts/config-panel.js:256-275`
- 问题：`cleanup()` 内引用 `timeoutId/fadeTimeoutId`，但二者都在更内层 `setTimeout` 作用域声明，关闭/自动淡出时同样会 `ReferenceError`

3) **配置校验 validateConfig 使用了错误字段**
- 位置：`src/renderer/scripts/config-panel.js:186-198`
- 问题：`getConfig()` 返回的是 `{ options: { concurrency, outputSuffix, ... } }`，但校验使用 `config.concurrency/config.outputSuffix`，导致校验结果与真实配置不一致

4) **暂停/继续按钮会调用不存在的方法**
- 位置：`src/renderer/scripts/app.js:66`（pauseBtn 绑定）、`src/renderer/scripts/app.js:217`、`src/renderer/scripts/app.js:228`
- 问题：`pauseProcessing()/resumeProcessing()` 调用 `this.showMessage(...)`，但 `LogScrubberApp` 未实现该方法，点击“暂停/继续”会抛 `TypeError`

### P1 - High（安全/可信/功能名不副实）

1) **Electron 依赖公告仍存在**
- 证据：`node -p "require('electron/package.json').version"` => `28.3.3`
- `npm audit`：仍提示 `GHSA-vmqv-hx8q-j7mg`（`electron <35.7.5`）

2) **enableMasking/maskUrlParams 未贯通到主进程规范化逻辑**
- 位置：`main.js:105-142`
- 问题：渲染进程已在 `scrubberOptions` 中发送 `enableMasking/maskUrlParams`（见 `src/renderer/scripts/app.js:256-269`），但 `normalizeScrubberOptions()` 直接丢弃，导致开关在 GUI 中不可控/不生效

3) **“暂停/取消”仍属于 UI 层状态切换**
- 位置：`src/renderer/scripts/app.js:209-248`
- 问题：未提供主进程可取消任务机制（取消不终止正在进行的文件写入/处理），存在用户误判风险

### P2 - Medium（体验/一致性/可维护性）

1) **帮助功能可能破坏设置面板**
- 位置：`src/renderer/scripts/app.js:464-549`
- 问题：通过 `modalBody.innerHTML = helpContent` 替换整个设置模态框内容，且尝试使用 `modal.onclose`（DIV 不会触发 onclose）；关闭后难以恢复原设置 UI 与事件绑定

2) **processor 收尾等待逻辑仍建议更严谨**
- 位置：`src/core/processor.js:228-231`
- 问题：`Promise.race([once(finish), once(error)])` 存在“错误分支被当成正常 resolve”的风险（建议让 error promise 显式 reject，或仅 await `once(finish)` 让其在 error 时 reject）

3) **图标资源仍缺失**
- 证据：`assets/icons` 目录无任何文件；UI 与打包配置仍引用 `assets/icons/*`

## 5. 安全基线复核（结论）

- 仍保持较好的 Electron 安全配置：`main.js:203-205`（`nodeIntegration:false`、`contextIsolation:true`）+ `setWindowOpenHandler`/`will-navigate` 拦截 + `src/renderer/index.html:6` CSP。
- `src/preload.js` 新增 `VALID_INVOKE_CHANNELS` 白名单与 invoke 前校验，属于正向增强。

## 6. 建议修复顺序（面向“可交付”）

1) **先消除 P0 抛错**：修 `app.js/config-panel.js` 的 timeoutId 作用域；修 `validateConfig()` 字段引用；补上 `LogScrubberApp.showMessage()` 或移除暂停提示调用。
2) **打通新开关**：主进程 `normalizeScrubberOptions()` 透传 `enableMasking/maskUrlParams`（并确保落到 `LogScrubber` 构造参数）。
3) **补结构化日志脱敏**：对 JSON 行做可选解析与递归脱敏（失败回退文本模式），将 `password/token/secret` 等真正敏感字段纳入覆盖。
4) **升级 Electron 并回归**：修复已知公告；明确“破坏性升级”的替换策略。

