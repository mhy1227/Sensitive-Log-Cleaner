# Codex Review 报告（2025-12-26 R2）：Log-Scrubber-GUI

> 评审日期：2025-12-26  
> 评审范围：`D:\pro_note\my-js-toolkit\scripts\Log-Scrubber-GUI`  
> 对照基线：`CODEX_REVIEW_20251226.md`（同日上一版）  
> 评审方式：静态代码审查 + 最小回归复测（Node 调用核心模块）+ 打包验证 + 依赖审计（npm audit）  
> 结论级别：新增 **P0 阻断性缺陷**（取消/异常路径会抛 `ReferenceError`），需先修复再交付。

## 1. R2 摘要（变化点）

- **已修复/消除（相对上一版）**：打包图标资源已补齐（`assets/icons/icon.ico`、`assets/icons/icon.icns` 已存在），`npm run pack` 在 Windows 成功产出 `dist/win-unpacked`。
- **新增 P0（本轮阻断）**：`src/core/processor.js` 引入“临时文件→成功后重命名”的交付策略，但将 `tempPath/tempFileCreated` 声明在 `try` 内，`catch` 中引用导致 `ReferenceError`；一旦发生取消/异常，将直接把进程带崩。
- **新增交付风险（P1）**：`sharp` 被加入运行时 `dependencies`，但源码内未发现使用；会引入大量平台原生二进制（体积与供应链面扩大、安装/打包复杂度上升）。
- **依赖审计（P1 维持）**：`npm audit` 仍仅命中 Electron 公告（moderate，`electron <35.7.5`）。

## 2. 复测结果（证据）

### 2.1 正常处理（通过）

- 复测：`FileProcessor.processFile('./test-sample.log')`
- 结果：`success: true`，输出 `test-sample.masked.log`（382 bytes）

### 2.2 取消/异常路径（失败，P0）

- 复测：对 `processFile('./test-real.log', null, { signal })` 触发 `abort()`
- 结果：抛出并终止进程：
  - `ReferenceError: tempFileCreated is not defined`
  - 位置：`src/core/processor.js:455`（`catch` 分支）

## 3. 问题清单（按优先级）

### P0 - Critical（必崩/不可交付）

1) **临时文件清理逻辑变量作用域错误，取消/失败必触发 ReferenceError**
- 位置：`src/core/processor.js:287-290`（`tempPath/tempFileCreated` 声明在 `try` 块内）  
  `src/core/processor.js:455-461`（`catch` 中引用 `tempFileCreated/tempPath`）
- 影响：任意异常（包括用户点击“取消”、读写错误、编码错误）都会走 `catch`，并立刻崩溃；这会回归为“取消会杀主进程”的交付级故障。
- 建议（直接替换，不保兼容）：将 `tempPath/tempFileCreated` 提升到函数作用域（`let tempPath = null; let tempFileCreated = false;`），在 `try` 内赋值；`catch/finally` 统一使用同一份变量。

2) **配置导出后无法导入（上一版 P0 仍未修）**
- 位置：`src/renderer/scripts/config-panel.js:100-123`、`src/renderer/scripts/config-panel.js:405-412`
- 现象：`getConfig().options` 包含 `enableMasking/maskUrlParams`，但 `isValidConfig()` 的 `allowedOptions` 未包含，导致导入拒绝自身导出文件。

### P1 - High（交付风险/安全/体积）

1) **`sharp` 进入运行时依赖但未被使用**
- 证据：在 `src/**`、`main.js` 中未检索到 `sharp` 使用（排除 `node_modules` 后仅 `package.json/package-lock.json` 命中）。
- 影响：引入原生依赖会放大安装与打包失败面（尤其跨平台）、显著增大分发体积，并扩大供应链/审计面。
- 建议：若仅用于构建期生成图标/资源，改为 `devDependencies` + 独立脚本；若无需则删除并回退 lockfile。

2) **Electron 公告仍在**
- 证据：`npm audit --registry=https://registry.npmjs.org --audit-level=moderate` 报告 `GHSA-vmqv-hx8q-j7mg`（moderate，`electron <35.7.5`）；当前 `electron 28.3.3`。
- 建议：直接替换升级到修复版本线并做回归（按项目策略：不保兼容，明确替换说明）。

### P2 - Medium（已改善/待复核）

1) **图标资源已补齐（本轮改善项）**
- 证据：`assets/icons/icon.ico`、`assets/icons/icon.icns` 已存在；`npm run pack` 成功。
- 建议：补一次“安装包/窗口图标实际显示”人工验收（Windows Installer、macOS DMG）。

## 4. 建议修复顺序（面向可交付）

1) 先修 `processor.js` 的 `tempFileCreated/tempPath` 作用域 P0（否则取消/失败会直接崩）。  
2) 修 `config-panel.js` 导入白名单与导出 schema 不一致的 P0。  
3) 删除或降级 `sharp`（若无运行时用途，不应进入 dependencies）。  
4) 升级 Electron 到修复版本线并回归。

## 5. 附录：本轮使用的最小复测命令（PowerShell）

> 注意：会生成/覆盖 `*.masked.log` 输出文件。

```powershell
Set-Location D:\pro_note\my-js-toolkit\scripts\Log-Scrubber-GUI

# 正常处理快测
@'
const fs = require('fs');
const FileProcessor = require('./src/core/processor');
(async () => {
  const p = new FileProcessor({ scrubberOptions: { enableMasking: true, maskUrlParams: true } });
  const r = await p.processFile('./test-sample.log');
  console.log(r);
  console.log('size', fs.statSync(r.outputPath).size);
})();
'@ | node

# 复现 P0：取消/异常路径 ReferenceError
@'
const FileProcessor = require('./src/core/processor');
(async () => {
  const ac = new AbortController();
  const p = new FileProcessor({ scrubberOptions: { enableMasking: true } });
  const task = p.processFile('./test-real.log', null, { signal: ac.signal });
  setTimeout(() => ac.abort('已取消'), 20);
  console.log(await task);
})();
'@ | node
```

