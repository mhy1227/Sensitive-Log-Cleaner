# Electron 项目打包与发布指南 (Log Scrubber GUI)

本指南将介绍如何将 `Log-Scrubber-GUI` 项目打包成可执行文件（如 Windows 的 `.exe`），并涵盖打包过程中的注意事项、安全性校验（Hash 值）等关键环节。

## 1. 打包工具介绍

本项目使用 `electron-builder` 作为打包工具。它是目前 Electron 生态中最成熟、功能最全的打包方案，支持：
- 生成安装程序（NSIS, MSI）和绿色版（zip, 7z）。
- 自动更新支持。
- 代码签名（Code Signing）。
- 多平台构建。

## 2. 打包前的准备工作

在运行打包命令前，请务必检查以下几点：

### A. 依赖同步
确保 `node_modules` 是最新的，且没有冗余依赖。
```bash
npm install
```

### B. 图标资源
`electron-builder` 对图标格式有严格要求：
- **Windows**: `assets/icons/icon.ico` (建议包含 256x256 尺寸)。
- **macOS**: `assets/icons/icon.icns` (建议包含 1024x1024 尺寸)。
- **Linux**: `assets/icons/icon.png` (建议 512x512)。

### C. 版本号管理
在 `package.json` 中更新 `"version": "1.0.0"`。每次发布新版本时，必须增加版本号，否则自动更新机制（如果启用）将无法识别。

## 3. 执行打包命令

在项目根目录下运行：

| 平台 | 命令 | 输出文件格式 |
| :--- | :--- | :--- |
| **Windows** | `npm run build:win` | `.exe` (安装程序) |
| **macOS** | `npm run build:mac` | `.dmg` (磁盘映像) |
| **Linux** | `npm run build:linux` | `.AppImage` (通用包) |

打包后的文件将存放在根目录下的 `dist/` 文件夹中。

## 4. 打包注意事项 (Best Practices)

### A. 排除不必要的文件
在 `package.json` 的 `build.files` 配置中，只包含运行所需的文件。
- **错误做法**: 把 `node_modules` 全部打包进去（`electron-builder` 会自动处理生产依赖，但如果配置不当会包含 `devDependencies`）。
- **正确做法**: 明确指定 `main.js`, `src/`, `assets/` 等。

### B. 路径问题
在代码中访问文件时，**严禁使用相对路径**（如 `./assets/logo.png`），因为打包后文件的物理位置会发生变化。
- **推荐**: 使用 `path.join(__dirname, 'assets/logo.png')` 或 `app.getAppPath()`。

### C. 安全性：ASAR 存档
本项目默认开启了 `asar: true`。ASAR 会将所有源代码打包成一个加密的存档文件，防止用户直接看到源码，同时也能提高文件读取性能。

## 5. 发布与完整性校验 (Hash 值)

发布软件时，为了防止安装包被篡改（如被植入木马），开发者通常会提供 **Hash 值（散列值）** 供用户校验。

### 如何生成 Hash 值？
打包完成后，您可以使用以下命令获取安装包的 SHA-256 值：

**Windows (PowerShell):**
```powershell
Get-FileHash .\dist\Log-Scrubber-Setup-1.0.0.exe -Algorithm SHA256
```

**Linux/macOS:**
```bash
shasum -a 256 ./dist/Log-Scrubber-1.0.0.dmg
```

### 为什么需要它？
1. **防篡改**: 用户下载后计算 Hash，如果与官方提供的一致，说明文件未被修改。
2. **防损坏**: 如果下载过程中文件丢失了几个字节，Hash 值会完全不同。

## 6. 进阶：代码签名 (Code Signing)

如果您打算正式发布给外部用户，**代码签名**是必须的：
- **Windows**: 如果没有签名，用户安装时会弹出“未知的发布者”警告（SmartScreen 蓝色弹窗）。
- **macOS**: 如果没有签名，系统会直接阻止运行，提示“无法验证开发者”。

*注：代码签名通常需要购买开发者证书（如微软的 EV 证书或 Apple Developer 计划）。*

## 7. 关于“免费证书”的说明

这是一个非常现实的问题：**目前市面上几乎没有可以直接被 Windows 或 macOS 自动信任的“免费”代码签名证书。**

### A. 为什么没有免费的？
代码签名证书的核心不是“加密”，而是“身份验证”。证书颁发机构（CA）需要人工审核申请者的真实身份（如营业执照、身份证明），这部分人工成本导致了证书通常是收费的。

### B. 替代方案（低成本/免费）

1.  **自签名证书 (Self-Signed Certificate)**:
    - **成本**: 0元。
    - **效果**: 依然会弹出“未知发布者”警告。
    - **用途**: 仅用于证明文件自打包后未被篡改。
2.  **开源项目免费计划 (SignPath.io)**:
    - 如果您的项目是托管在 GitHub 上的开源项目，可以申请 **SignPath** 的免费计划，他们为开源社区提供代码签名服务。
3.  **信任传递 (Trust by Reputation)**:
    - 对于 Windows，如果您的软件下载量足够大且没有被举报，微软的 SmartScreen 最终会“认识”您的软件并停止弹出警告（但这需要很长时间）。
4.  **仅提供 Hash 值 (推荐)**:
    - 这是个人开发者最常用的做法。在下载页面清晰地标注 SHA-256 值，并引导用户如何校验。虽然不能消除警告，但能建立技术上的信任。

### C. 总结建议
- **个人/内部使用**: 无需购买证书，直接发布并提供 Hash 值即可。
- **小规模分发**: 引导用户点击“更多信息” -> “仍要运行”。
- **商业/大规模发布**: 建议购买证书（Windows 约 2000-4000元/年，Apple 99美元/年）。

---
**文档维护**: Log Scrubber Team
**最后更新**: 2025-12-26