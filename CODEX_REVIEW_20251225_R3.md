# Codex Review 报告（R3）：Log-Scrubber-GUI

> 评审日期：2025-12-25  
> 评审范围：`D:\pro_note\my-js-toolkit\scripts\Log-Scrubber-GUI`  
> 对照基线：上次报告 `CODEX_REVIEW_20251225_R2.md`  
> 评审方式：静态代码审查 + 最小可复现回归（Node 调用核心模块）+ 依赖审计（npm audit）

## 1. R3 摘要（结论）

- **R2 的主要阻断点已被修复/贯通**：UI 侧 `showMessage/showError` 定时器作用域问题、`validateConfig()` 字段引用、以及主进程对 `enableMasking/maskUrlParams` 的透传，当前代码已能对上（见 `main.js:204-244`、`src/renderer/scripts/app.js:279-299`、`src/renderer/scripts/config-panel.js:186-205`）。
- **新增 P0：取消/Abort 会导致进程崩溃**：`src/core/processor.js` 的 `abortHandler` 会对多个 stream 执行 `destroy(abortError)`，但未提前绑定 `error` 监听；触发后出现 `Unhandled 'error' event`，Electron 主进程会直接退出（见“P0-1”与“复测 3.2”）。
- **脱敏覆盖仍有明显缺口**：JSON/结构化日志不会按敏感键脱敏；URL query 的 keyword 脱敏会“吞参”，导致日志可读性/可追溯性下降（见“P1-1/2”）。

## 2. 近期改动集中点（相对 R2）

- 主进程：新增/完善暂停与取消编排（`activeProcessingJob` + `PauseController` + `AbortController`），并扩展 IPC：`process:pause/resume/cancel`（`main.js:11-109`、`main.js:480-687`）。
- 预加载桥：invoke 白名单扩展，新增 `process.pause/resume/cancel`（`src/preload.js:13-111`）。
- 核心处理：`FileProcessor` 引入 runtime（`signal/pauseController`），并加入并发信号支持（`src/core/processor.js:249-492`、`src/core/processor.js:556-608`）。
- Scrubber：新增 `enableMasking/maskUrlParams` 两个开关（`src/core/scrubber.js:13-51`、`src/core/scrubber.js:211-223`）。

## 3. 最小回归复测（本机结果）

> 测试环境：Node `v24.4.1`（仅用于复测核心模块；Electron 运行时以打包/启动为准）

### 3.1 单文件处理（通过）

- 复测：`FileProcessor.processFile('./test-sample.log')`
- 结果：成功输出 `test-sample.masked.log`，并返回统计信息（例如 `patternMatches` 内 `jwt_token/chinese_phone/email` 有计数）。

### 3.2 取消/Abort（失败，P0）

- 复测：对 `processFile('./test-real.log', null, { signal })` 触发 `abort()`（模拟 GUI 的取消）
- 结果：函数返回 `cancelled: true`，但随后进程抛出：
  - `node:events: throw er; // Unhandled 'error' event`
  - `Error [AbortError]: 处理已取消`
  - `Emitted 'error' event on WriteStream instance ...`
- 结论：当前“取消”会把 Electron 主进程一起带崩（详见“P0-1”）。

### 3.3 开关与规则覆盖（部分通过）

- `enableMasking=false`：按预期原样输出（`src/core/scrubber.js:215-223`）。
- URL query：`GET https://example.com/api?a=1&token=abc&password=secret` 会变成 `...token=***`，`&password=secret` 被吞掉（见“P1-1”）。
- JSON 行：`{"password":"secret","token":"abc123","email":"user@example.com"}` 只会遮蔽 email，`password/token` 仍明文（见“P1-2”）。

## 4. 问题清单（按优先级）

### P0 - Critical（会导致崩溃/不可交付）

1) **取消/Abort 导致未处理的 stream error，触发进程崩溃**
- 位置：`src/core/processor.js:347-358`（`abortHandler`）、`src/core/processor.js:100-154`（`waitForFinishOrError` 只在“收尾”阶段绑定 `error`）
- 根因：`destroy(abortError)` 会触发 stream 的 `error` 事件；在缺少 `error` 监听时 Node 会抛 `Unhandled 'error' event`，导致进程退出。
- 影响：GUI 点击“取消”可能直接杀死 Electron 主进程；并可能留下 0 字节/半成品输出文件（当前目录里 `test-real.masked.log` 已出现 0 字节现象）。
- 建议方向（不在本报告内改代码）：对 `fileReadStream/inputStream/encoder/fileWriteStream` 在创建后立刻统一绑定 `error`（并在 abort 场景转化为“可控取消”）；或调整 abort 策略，避免向无监听 stream 注入 error。

### P1 - High（功能不符合预期/高风险误伤）

1) **URL query 的 keyword 脱敏会“吞参”**
- 位置：`src/core/scrubber.js:133-141`（`maskSensitiveKeywords`：`[^\\s\\n\\r,;]+` 未把 `&` 当作分隔）
- 现象：`token=abc&password=secret` 会被视作同一个 value，替换后只剩 `token=***`，`&password=secret` 被一起抹掉。
- 影响：日志结构被破坏（丢字段），对排障与审计不友好；且吞参行为很隐蔽，容易被误认为“脱敏正确”。

2) **JSON/结构化日志未按敏感键脱敏（password/token 等保留明文）**
- 位置：`src/core/scrubber.js:69-101`（KV 规则不覆盖 JSON 语法）、`src/core/scrubber.js:133-146`（keyword 规则也不覆盖 `"key":"value"`）
- 影响：真实生产日志中大量结构化事件会绕过“敏感键”策略，出现合规风险。
- 建议方向：对每行尝试 `JSON.parse`，成功则递归按 key/值规则脱敏；失败回退文本模式。

3) **maskUrlParams 的语义与实现不一致**
- 位置：`src/core/scrubber.js:175-178`（仅用于跳过 `url_with_params` pattern）、`src/core/config.js:88-97`（该 pattern 默认 `enabled:false`）
- 影响：UI/配置中“是否脱敏 URL 参数”的用户预期很难被满足；当前实际主要靠 keyword 脱敏，但存在“吞参”副作用。

### P2 - Medium（体验/可维护性/交付完整性）

1) **配置面板未把 `enableMasking/maskUrlParams` 回显到 UI**
- 位置：`src/renderer/scripts/config-panel.js:135-157`
- 现象：`updateUI()` 仅回显 `skipBinaryFiles/concurrency/encoding` 等；若用户配置保存了 `enableMasking=false`，再次加载后界面可能仍显示“已勾选”，造成误判。

2) **图标资源缺失，打包配置可能回退/失败**
- 位置：`assets/icons/` 目录为空；但 `package.json#build` 和 `main.js:310` 仍引用 `assets/icons/icon.*`
- 影响：安装包图标/窗口图标不可控；在部分平台可能直接构建失败或使用默认图标。

3) **路径安全校验规则存在实现瑕疵（建议复核）**
- 位置：`main.js:142-170`（Windows 敏感目录正则以 `\\/` 结尾，可能与实际 `\\` 路径不匹配；`..` 检测逻辑也较可疑）
- 影响：若渲染进程被注入/劫持，IPC 传入路径的防护可能不符合预期。

## 5. 依赖与安全基线复核

- Electron 安全配置总体较好：`nodeIntegration:false`、`contextIsolation:true`、`enableRemoteModule:false`，并限制外部导航（`main.js:304-309`、`main.js:361-375`）。
- `npm audit`（moderate）仍提示 Electron 公告：`GHSA-vmqv-hx8q-j7mg`，影响范围 `electron <35.7.5`；当前 `devDependencies` 为 `electron:^28.3.3`（`package.json`）。

## 6. 建议修复顺序（面向“可交付”）

1) **先修 P0 取消崩溃**：把取消做到“可控结束”而不是“抛未处理 error”。  
2) **修 URL 吞参**：至少把 `&` 纳入 value 截断；更推荐实现专门的 URL 参数解析与脱敏。  
3) **补结构化日志脱敏**：JSON 解析 + 递归 key 脱敏，降低合规风险。  
4) **补齐打包图标**：避免跨平台构建/交付不一致。  
5) **评估升级 Electron**：根据公告与打包/兼容成本，直接替换到安全版本线并跑一次回归。

## 7. 附录：本轮使用的最小复测命令（PowerShell）

> 说明：下面命令会在项目目录生成/覆盖 `*.masked.log` 输出文件。

1) 核心处理与规则覆盖快测：

```powershell
@'
const FileProcessor = require('./src/core/processor');
const LogScrubber = require('./src/core/scrubber');
(async () => {
  const p = new FileProcessor({ scrubberOptions: { enableMasking: true, maskUrlParams: true } });
  console.log(await p.processFile('./test-sample.log'));
  console.log(new LogScrubber({ enableMasking: false }).processLine('password=secret token=abc email=user@example.com'));
  console.log(new LogScrubber({ enableMasking: true }).processLine('GET https://example.com/api?a=1&token=abc&password=secret'));
  console.log(new LogScrubber({ enableMasking: true }).processLine('{\"password\":\"secret\",\"token\":\"abc123\",\"email\":\"user@example.com\"}'));
})();
'@ | node
```

2) 复现“取消导致崩溃”（观察 `Unhandled 'error' event`）：

```powershell
@'
const FileProcessor = require('./src/core/processor');
class TestPauseController {
  constructor(){ this.paused = true; }
  bindReadline(rl){ try{ rl.pause(); } catch(_){} return () => {}; }
  async waitIfPaused(signal){
    if(!this.paused) return;
    await new Promise((resolve) => {
      if(signal){
        if(signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      }
    });
  }
}
(async () => {
  const ac = new AbortController();
  const processor = new FileProcessor({ scrubberOptions: { enableMasking: true } });
  const p = processor.processFile('./test-real.log', null, { signal: ac.signal, pauseController: new TestPauseController() });
  setTimeout(() => ac.abort(), 20);
  console.log(await p);
})();
'@ | node
```

3) 依赖审计：

```powershell
npm audit --registry=https://registry.npmjs.org --audit-level=moderate
```

