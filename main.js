const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 导入核心处理模块
const FileProcessor = require('./src/core/processor');

// 应用配置
const isDev = process.argv.includes('--dev');
let mainWindow;
let activeProcessingJob = null;

/**
 * 暂停控制器 - 控制处理任务的暂停/继续
 */
class PauseController {
  constructor() {
    this.paused = false;
    this.bindings = new Set();
    this.resumeWaiters = new Set();
  }

  isPaused() {
    return this.paused;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const binding of this.bindings) {
      try {
        binding.pause();
      } catch (_) {}
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const binding of this.bindings) {
      try {
        binding.resume();
      } catch (_) {}
    }

    const waiters = Array.from(this.resumeWaiters);
    this.resumeWaiters.clear();
    for (const waiter of waiters) {
      try {
        waiter();
      } catch (_) {}
    }
  }

  bindReadline(rl) {
    if (!rl || typeof rl.pause !== 'function' || typeof rl.resume !== 'function') {
      return () => {};
    }

    const binding = {
      pause: () => rl.pause(),
      resume: () => rl.resume()
    };

    this.bindings.add(binding);
    if (this.paused) {
      try {
        rl.pause();
      } catch (_) {}
    }

    return () => {
      this.bindings.delete(binding);
    };
  }

  async waitIfPaused(signal) {
    if (!this.paused) return;

    await new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        this.resumeWaiters.delete(onResume);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onResume = () => finish();
      const onAbort = () => finish();

      this.resumeWaiters.add(onResume);

      if (signal) {
        if (signal.aborted) {
          finish();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

/**
 * 安全的 URL 解析函数
 */
function tryParseUrl(url) {
  try {
    return new URL(url);
  } catch (error) {
    return null;
  }
}

/**
 * 检查外部 URL 是否在白名单中
 */
function isAllowedExternalUrl(url) {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  // 只允许 http 和 https 协议
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * 路径遍历防护：检测恶意路径模式
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否为危险路径
 */
function isDangerousPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return true;

  const resolved = path.resolve(filePath);

  // 检查系统敏感目录（Windows）
  // 注意：path.resolve() 返回值不带尾部斜杠，如 C:\Windows\System32
  const sensitivePaths = [
    /^[A-Za-z]:\\Windows($|\\)/i,
    /^[A-Za-z]:\\Program Files($|\\)/i,
    /^[A-Za-z]:\\Program Files \(x86\)($|\\)/i,
    /^[A-Za-z]:\\ProgramData($|\\)/i,
    /^[A-Za-z]:\\System Volume Information($|\\)/i,
    /^[A-Za-z]:\\Recovery($|\\)/i,
    /^\/etc($|\/)/i,           // Linux 系统目录
    /^\/usr\/bin($|\/)/i,      // Linux 系统目录
    /^\/boot($|\/)/i,          // Linux 系统目录
    /^\/root($|\/)/i           // Linux root 目录
  ];

  for (const pattern of sensitivePaths) {
    if (pattern.test(resolved)) {
      return true;
    }
  }

  // 检查路径遍历攻击：检测输入路径是否包含 .. 尝试跳出
  if (filePath.includes('..')) {
    const normalized = path.normalize(filePath);
    if (normalized.includes('..')) {
      return true;
    }
  }

  return false;
}

/**
 * 验证文件路径是否安全（用于 IPC 处理）
 * 策略：只阻止明显的路径遍历攻击和系统敏感目录
 * @param {string} filePath - 文件路径
 * @returns {string} 规范化后的安全路径
 * @throws {Error} 路径无效时抛出
 */
function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('无效的文件路径');
  }

  // 确保是绝对路径
  if (!path.isAbsolute(filePath)) {
    throw new Error('必须是绝对路径');
  }

  // 检查是否为危险路径
  if (isDangerousPath(filePath)) {
    throw new Error('访问被拒绝：路径超出允许的目录范围');
  }

  return filePath;
}

/**
 * 标准化 scrubber 配置选项
 * 将渲染进程发送的元数据映射回主进程的完整规则对象
 */
function normalizeScrubberOptions(scrubberOptions = {}) {
  const config = require('./src/core/config');

  // 构建启用规则的 Map
  const enabledByName = new Map();
  if (Array.isArray(scrubberOptions.patterns)) {
    for (const p of scrubberOptions.patterns) {
      if (p && typeof p.name === 'string') {
        enabledByName.set(p.name, p.enabled === true);
      }
    }
  }

  // 从配置文件重新构建规则，保留函数型 replacement
  const patterns = config.PATTERNS.map((p) => {
    const enabled = enabledByName.has(p.name)
      ? enabledByName.get(p.name)
      : (p.enabled === true);
    return { ...p, enabled };
  });

  // 保护 sensitiveKeys：只有当用户配置包含非空数组时才使用用户值
  // 否则使用默认值，确保敏感词列表不会被意外清空
  const userSensitiveKeys = scrubberOptions.sensitiveKeys;
  const shouldUseUserSensitiveKeys = Array.isArray(userSensitiveKeys) && userSensitiveKeys.length > 0;
  const sensitiveKeys = shouldUseUserSensitiveKeys ? userSensitiveKeys : config.SENSITIVE_KEYS;

  return {
    sensitiveKeys,
    patterns,
    kvSeparators: Array.isArray(scrubberOptions.kvSeparators)
      ? scrubberOptions.kvSeparators
      : config.KV_SEPARATORS,
    defaultMask: typeof scrubberOptions.defaultMask === 'string'
      ? scrubberOptions.defaultMask
      : config.DEFAULT_MASK,
    // 透传开关配置
    enableMasking: scrubberOptions.enableMasking !== false,
    maskUrlParams: scrubberOptions.maskUrlParams !== false
  };
}

/**
 * 标准化处理器配置选项
 */
function normalizeProcessorOptions(options = {}) {
  if (!options || typeof options !== 'object') return {};
  return {
    ...options,
    scrubberOptions: normalizeScrubberOptions(options.scrubberOptions || {})
  };
}

/**
 * 标准化持久化配置结构（统一为 { patterns, sensitiveKeys, options, defaultMask }）
 * - 兼容迁移：若传入旧版扁平字段，则合并到 options
 * - options 缺失字段用 DEFAULT_OPTIONS 补齐
 * - 保护 sensitiveKeys：只有用户明确设置了非空数组才使用用户值
 */
function normalizePersistedConfig(rawConfig) {
  const config = require('./src/core/config');
  const normalized = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};

  const options = {
    ...config.DEFAULT_OPTIONS,
    ...(normalized.options && typeof normalized.options === 'object' ? normalized.options : {})
  };

  // 迁移旧版扁平字段（若存在）
  if (typeof normalized.outputSuffix === 'string') options.outputSuffix = normalized.outputSuffix;
  if (typeof normalized.encoding === 'string') options.encoding = normalized.encoding;
  if (typeof normalized.concurrency === 'number' && Number.isFinite(normalized.concurrency)) {
    options.concurrency = normalized.concurrency;
  }
  if (typeof normalized.skipBinaryFiles === 'boolean') options.skipBinaryFiles = normalized.skipBinaryFiles;

  // outputDir 不在 DEFAULT_OPTIONS 内：显式支持并保证为 string
  if (typeof normalized.outputDir === 'string') options.outputDir = normalized.outputDir;
  if (typeof options.outputDir !== 'string') options.outputDir = '';

  const result = { options };

  // 保护 sensitiveKeys：只有当用户配置包含非空数组时才使用用户值
  // 否则使用默认值，确保敏感词列表不会被意外清空
  const userSensitiveKeys = normalized.sensitiveKeys;
  const shouldUseUserSensitiveKeys = Array.isArray(userSensitiveKeys) && userSensitiveKeys.length > 0;
  result.sensitiveKeys = shouldUseUserSensitiveKeys ? userSensitiveKeys : config.SENSITIVE_KEYS;

  if (Array.isArray(normalized.patterns)) result.patterns = normalized.patterns;
  if (typeof normalized.defaultMask === 'string') result.defaultMask = normalized.defaultMask;
  return result;
}

// 创建主窗口
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'src', 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    show: false,
    titleBarStyle: 'default'
  });

  // 加载主界面
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 阻止新窗口打开，只允许白名单 URL
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// 应用准备就绪
app.whenReady().then(() => {
  createMainWindow();

  // macOS 特殊处理
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全设置：阻止导航到外部URL
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      // 只允许 file: 协议
      if (parsedUrl.protocol !== 'file:') {
        event.preventDefault();
      }
    } catch (error) {
      // URL 解析失败，阻止导航
      event.preventDefault();
    }
  });
});

// IPC 处理器

// 文件选择对话框
ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '日志文件', extensions: ['log', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  return result.filePaths;
});

// 文件夹选择对话框
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  // 用户取消时返回 null 而不是 undefined
  return result.filePaths.length > 0 ? result.filePaths[0] : null;
});

// 保存对话框
ipcMain.handle('dialog:saveFile', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [
      { name: '日志文件', extensions: ['log'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  return result.filePath;
});

// 文件信息获取
ipcMain.handle('file:getInfo', async (event, filePath) => {
  try {
    const safePath = validateFilePath(filePath);
    const stats = fs.statSync(safePath);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      modified: stats.mtime,
      created: stats.birthtime
    };
  } catch (error) {
    if (error.message.includes('访问被拒绝') || error.message.includes('无效的文件路径')) {
      throw new Error(`文件路径无效或无权限访问: ${error.message}`);
    }
    throw new Error(`无法获取文件信息: ${error.message}`);
  }
});

// 文件验证
ipcMain.handle('file:validate', async (event, filePath) => {
  try {
    const safePath = validateFilePath(filePath);
    const processor = new FileProcessor();
    return await processor.validateFile(safePath);
  } catch (error) {
    if (error.message.includes('访问被拒绝') || error.message.includes('无效的文件路径')) {
      return { valid: false, error: '文件路径无效或无权限访问' };
    }
    return { valid: false, error: error.message };
  }
});

// 处理单个文件
ipcMain.handle('process:file', async (event, filePath, options = {}) => {
  try {
    const safePath = validateFilePath(filePath);

    // 验证输出目录（如果指定）
    let outputDir = options.outputDir;
    if (outputDir) {
      outputDir = validateFilePath(outputDir);
    }

    const processor = new FileProcessor(normalizeProcessorOptions(options));
    
    // 启动前清理输出目录的临时文件
    await processor.cleanupTempFiles(outputDir || path.dirname(safePath));

    const result = await processor.processFile(safePath, outputDir);

    // 发送进度更新
    mainWindow.webContents.send('processing:progress', {
      type: 'file-complete',
      filePath: safePath,
      result
    });

    return result;
  } catch (error) {
    if (error.message.includes('访问被拒绝') || error.message.includes('无效的文件路径')) {
      throw new Error(`文件路径无效或无权限访问: ${error.message}`);
    }
    throw new Error(`处理文件失败: ${error.message}`);
  }
});

// 批量处理文件
ipcMain.handle('process:files', async (event, filePaths, options = {}) => {
  let job = null;
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      const results = [];
      mainWindow.webContents.send('processing:complete', {
        results,
        summary: '没有文件需要处理'
      });
      return results;
    }

    // 验证所有文件路径
    const safePaths = [];
    const pathErrors = [];
    for (let i = 0; i < filePaths.length; i++) {
      try {
        safePaths.push(validateFilePath(filePaths[i]));
      } catch (error) {
        pathErrors.push({
          inputPath: filePaths[i],
          success: false,
          error: `路径验证失败: ${error.message}`
        });
      }
    }

    // 如果有无效路径，添加到结果中
    if (pathErrors.length > 0 && safePaths.length === 0) {
      mainWindow.webContents.send('processing:complete', {
        results: pathErrors,
        summary: `所有路径验证失败，共 ${pathErrors.length} 个文件`
      });
      return pathErrors;
    }

    // 检查是否已有处理任务正在进行
    if (activeProcessingJob) {
      throw new Error('已有处理任务正在进行，请先完成或取消当前任务');
    }

    // 验证输出目录（如果指定）
    let outputDir = options.outputDir;
    if (outputDir) {
      outputDir = validateFilePath(outputDir);
    }

    // 创建处理任务
    job = {
      abortController: new AbortController(),
      pauseController: new PauseController()
    };
    activeProcessingJob = job;

    const normalizedOptions = normalizeProcessorOptions(options);
    const processor = new FileProcessor(normalizedOptions);

    // 启动前清理输出目录的临时文件
    if (outputDir) {
      await processor.cleanupTempFiles(outputDir);
    } else if (safePaths.length > 0) {
      // 如果没有统一输出目录，清理第一个文件所在目录（通常批量文件在同一目录）
      await processor.cleanupTempFiles(path.dirname(safePaths[0]));
    }

    const runtime = {
      signal: job.abortController.signal,
      pauseController: job.pauseController
    };

    // 发送开始处理事件
    mainWindow.webContents.send('processing:start', {
      totalFiles: safePaths.length + pathErrors.length
    });

    const total = safePaths.length;
    const indexByPath = new Map(safePaths.map((p, i) => [p, i]));

    // 复用 FileProcessor.processFiles 的并发逻辑：包装 processFile 注入进度事件
    const originalProcessFile = processor.processFile.bind(processor);
    processor.processFile = async (filePath, outputDir = null, run = runtime) => {
      const currentRuntime = (run && typeof run === 'object') ? run : runtime;
      const signal = currentRuntime?.signal;
      const index = indexByPath.get(filePath) ?? 0;

      // 检查是否已取消
      if (signal && signal.aborted) {
        const cancelledResult = {
          inputPath: filePath,
          outputPath: null,
          success: false,
          cancelled: true,
          error: '已取消',
          stats: null,
          processingTime: 0
        };

        mainWindow.webContents.send('processing:progress', {
          type: 'file-canceled',
          filePath,
          result: cancelledResult,
          index,
          total
        });

        return cancelledResult;
      }

      mainWindow.webContents.send('processing:progress', {
        type: 'file-start',
        filePath,
        index,
        total
      });

      let result = null;
      try {
        result = await originalProcessFile(filePath, outputDir, currentRuntime);
      } catch (error) {
        result = { inputPath: filePath, success: false, error: error.message };
      }

      // 确保 result 有值（catch 中已赋值，这里防御性检查）
      if (!result) {
        result = { inputPath: filePath, success: false, error: '未知错误' };
      }

      if (result.cancelled) {
        mainWindow.webContents.send('processing:progress', {
          type: 'file-canceled',
          filePath,
          result,
          index,
          total
        });
      } else if (result.success) {
        mainWindow.webContents.send('processing:progress', {
          type: 'file-complete',
          filePath,
          result,
          index,
          total
        });
      } else {
        mainWindow.webContents.send('processing:progress', {
          type: 'file-error',
          filePath,
          error: result.error || '未知错误',
          index,
          total
        });
      }

      return result;
    };

    const results = await processor.processFiles(safePaths, outputDir, runtime);
    results.sort((a, b) => {
      const ai = indexByPath.get(a?.inputPath) ?? 0;
      const bi = indexByPath.get(b?.inputPath) ?? 0;
      return ai - bi;
    });

    // 添加路径验证失败的文件到结果
    const allResults = [...results, ...pathErrors];

    // 判断是否被取消
    const cancelled = job.abortController.signal.aborted;
    const summary = cancelled
      ? `处理已取消：成功 ${results.filter(r => r.success).length}/${safePaths.length}，已取消 ${results.filter(r => r.cancelled).length} 个`
      : processor.generateSummaryReport(results);

    // 发送处理完成事件
    mainWindow.webContents.send('processing:complete', {
      results: allResults,
      summary,
      cancelled
    });

    return allResults;
  } catch (error) {
    throw new Error(`批量处理失败: ${error.message}`);
  } finally {
    if (activeProcessingJob === job) {
      activeProcessingJob = null;
    }
  }
});

// 暂停处理
ipcMain.handle('process:pause', () => {
  if (!activeProcessingJob) return { ok: false, error: '没有正在进行的处理任务' };
  activeProcessingJob.pauseController.pause();
  if (mainWindow) mainWindow.webContents.send('processing:progress', { type: 'paused' });
  return { ok: true };
});

// 继续处理
ipcMain.handle('process:resume', () => {
  if (!activeProcessingJob) return { ok: false, error: '没有正在进行的处理任务' };
  activeProcessingJob.pauseController.resume();
  if (mainWindow) mainWindow.webContents.send('processing:progress', { type: 'resumed' });
  return { ok: true };
});

// 取消处理
ipcMain.handle('process:cancel', () => {
  if (!activeProcessingJob) return { ok: false, error: '没有正在进行的处理任务' };
  if (!activeProcessingJob.abortController.signal.aborted) {
    activeProcessingJob.abortController.abort();
  }
  activeProcessingJob.pauseController.resume();
  if (mainWindow) mainWindow.webContents.send('processing:progress', { type: 'cancel-requested' });
  return { ok: true };
});

// 获取默认配置（只返回可序列化的元数据）
ipcMain.handle('config:getDefault', () => {
  const config = require('./src/core/config');
  return {
    sensitiveKeys: config.SENSITIVE_KEYS,
    // 只返回可序列化的元数据，避免函数/RegExp 跨 IPC 传输
    patterns: config.PATTERNS.map((pattern) => ({
      name: pattern.name,
      description: pattern.description,
      category: pattern.category,
      enabled: pattern.enabled === true
    })),
    options: config.DEFAULT_OPTIONS
  };
});

// 保存用户配置
ipcMain.handle('config:save', async (event, config) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const normalized = normalizePersistedConfig(config);
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
    return true;
  } catch (error) {
    throw new Error(`保存配置失败: ${error.message}`);
  }
});

// 加载用户配置
ipcMain.handle('config:load', async () => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');

      // 检查配置文件是否为空
      if (!configData.trim()) {
        console.warn('配置文件为空，将使用默认配置');
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(configData);
      } catch (syntaxError) {
        console.error('配置文件解析失败:', syntaxError.message);
        // 重置损坏的配置文件
        try {
          fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf8');
          console.log('已重置损坏的配置文件');
        } catch (resetError) {
          console.error('重置配置文件失败:', resetError.message);
        }
        return null;
      }

      return normalizePersistedConfig(parsed);
    }
    return null;
  } catch (error) {
    throw new Error(`加载配置失败: ${error.message}`);
  }
});

// 打开文件夹
ipcMain.handle('shell:openPath', async (event, filePath) => {
  try {
    const safePath = validateFilePath(filePath);
    await shell.openPath(safePath);
    return true;
  } catch (error) {
    if (error.message.includes('访问被拒绝') || error.message.includes('无效的文件路径')) {
      throw new Error(`文件路径无效或无权限访问`);
    }
    throw new Error(`打开文件夹失败: ${error.message}`);
  }
});

// 显示文件在文件夹中
ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  try {
    const safePath = validateFilePath(filePath);
    shell.showItemInFolder(safePath);
    return true;
  } catch (error) {
    if (error.message.includes('访问被拒绝') || error.message.includes('无效的文件路径')) {
      throw new Error(`文件路径无效或无权限访问`);
    }
    throw new Error(`显示文件失败: ${error.message}`);
  }
});

// 应用信息
ipcMain.handle('app:getInfo', () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  };
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (mainWindow) {
    mainWindow.webContents.send('app:error', {
      type: 'uncaught-exception',
      message: error.message,
      stack: error.stack
    });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (mainWindow) {
    mainWindow.webContents.send('app:error', {
      type: 'unhandled-rejection',
      message: reason?.message || String(reason)
    });
  }
});