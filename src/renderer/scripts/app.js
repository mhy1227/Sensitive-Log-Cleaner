/**
 * 主应用脚本
 */

class LogScrubberApp {
  constructor() {
    this.fileListComponent = null;
    this.dragDropHandler = null;
    this.configPanel = null;
    this.progressManager = null;

    this.isProcessing = false;
    this.isPaused = false;
    this.isCancelling = false;
    this.currentConfig = null;

    this.init();
  }

  async init() {
    try {
      // 等待DOM加载完成
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.initComponents());
      } else {
        this.initComponents();
      }
    } catch (error) {
      console.error('应用初始化失败:', error);
      this.showError('应用初始化失败: ' + error.message);
    }
  }

  initComponents() {
    // 初始化组件
    this.fileListComponent = new FileListComponent();
    this.dragDropHandler = new DragDropHandler();
    this.configPanel = new ConfigPanel();
    this.progressManager = new ProgressManager();

    // 设置组件关联
    this.dragDropHandler.setFileManager(this.fileListComponent);

    // 绑定事件
    this.setupEventListeners();
    this.setupIpcListeners();

    // 加载配置
    this.loadConfig();

    // 更新UI状态
    this.updateUI();

    console.log('应用初始化完成');
  }

  setupEventListeners() {
    // 开始处理按钮
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startProcessing());
    }

    // 暂停/继续按钮
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }

    // 取消按钮
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelProcessing());
    }

    // 设置按钮
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.showSettings());
    }

    // 帮助按钮
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => this.showHelp());
    }

    // 初始化UI状态
    this.updateUI();
  }

  setupIpcListeners() {
    // 监听处理进度
    window.electronAPI.on('processing:start', (data) => {
      this.onProcessingStart(data);
    });

    window.electronAPI.on('processing:progress', (data) => {
      this.onProcessingProgress(data);
    });

    window.electronAPI.on('processing:complete', (data) => {
      this.onProcessingComplete(data);
    });

    // 监听应用错误
    window.electronAPI.on('app:error', (error) => {
      this.showError('应用错误: ' + error.message);
    });
  }

  async loadConfig() {
    try {
      // 加载默认配置
      const defaultConfig = await window.electronAPI.config.getDefault();

      // 尝试加载用户配置
      const userConfig = await window.electronAPI.config.load();

      // 安全合并配置：保护敏感词列表和pattern不被空配置覆盖
      // 只有当用户配置包含有效的非空数组时，才使用用户值
      const mergedConfig = { ...defaultConfig };

      if (userConfig) {
        // 合并 options
        if (userConfig.options && typeof userConfig.options === 'object') {
          mergedConfig.options = { ...defaultConfig.options, ...userConfig.options };
        }

        // 保护 sensitiveKeys：只有用户配置包含非空数组才使用用户值
        if (Array.isArray(userConfig.sensitiveKeys) && userConfig.sensitiveKeys.length > 0) {
          mergedConfig.sensitiveKeys = userConfig.sensitiveKeys;
        }

        // 保护 patterns：只有用户配置包含非空数组才使用用户值
        if (Array.isArray(userConfig.patterns) && userConfig.patterns.length > 0) {
          mergedConfig.patterns = userConfig.patterns;
        }

        // 合并其他字段
        if (typeof userConfig.defaultMask === 'string') {
          mergedConfig.defaultMask = userConfig.defaultMask;
        }
      }

      this.currentConfig = mergedConfig;

      // 应用配置到界面
      if (this.configPanel) {
        this.configPanel.setConfig(this.currentConfig);
      }

      console.log('配置加载完成:', this.currentConfig);
    } catch (error) {
      console.error('加载配置失败:', error);
      this.showError('加载配置失败: ' + error.message);
    }
  }

  async saveConfig() {
    try {
      if (this.configPanel) {
        this.currentConfig = this.configPanel.getConfig();
        await window.electronAPI.config.save(this.currentConfig);
        console.log('配置保存成功');
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      this.showError('保存配置失败: ' + error.message);
    }
  }

  async startProcessing() {
    if (this.isProcessing) {
      console.warn('已在处理中');
      return;
    }

    const selectedFiles = this.fileListComponent.getSelectedFiles();
    if (selectedFiles.length === 0) {
      this.showError('请选择要处理的文件');
      return;
    }

    try {
      this.isProcessing = true;
      this.isPaused = false;
      this.isCancelling = false;
      this.updateUI();

      // 保存当前配置
      await this.saveConfig();

      // 获取处理选项
      const options = this.getProcessingOptions();

      // 开始处理
      const filePaths = selectedFiles.map(file => file.path);
      console.log('开始处理文件:', filePaths);

      const results = await window.electronAPI.process.files(filePaths, options);
      console.log('处理完成:', results);

    } catch (error) {
      console.error('处理失败:', error);
      this.showError('处理失败: ' + error.message);
      this.isProcessing = false;
      this.updateUI();
    }
  }

  async pauseProcessing() {
    if (!this.isProcessing || this.isPaused || this.isCancelling) return;

    try {
      const res = await window.electronAPI.process.pause();
      if (!res || res.ok !== true) {
        throw new Error(res?.error || '暂停失败');
      }
      this.isPaused = true;
      console.log('处理已暂停');
      this.updateUI();
      this.progressManager.pause();
      this.showMessage('处理已暂停，点击继续按钮恢复', 'warning');
    } catch (error) {
      console.error('暂停失败:', error);
      this.showError('暂停失败: ' + (error?.message || String(error)));
    }
  }

  async resumeProcessing() {
    if (!this.isProcessing || !this.isPaused || this.isCancelling) return;

    try {
      const res = await window.electronAPI.process.resume();
      if (!res || res.ok !== true) {
        throw new Error(res?.error || '继续失败');
      }
      this.isPaused = false;
      console.log('处理已继续');
      this.updateUI();
      this.progressManager.resume();
      this.showMessage('处理已继续', 'success');
    } catch (error) {
      console.error('继续失败:', error);
      this.showError('继续失败: ' + (error?.message || String(error)));
    }
  }

  togglePause() {
    if (this.isPaused) {
      this.resumeProcessing();
    } else {
      this.pauseProcessing();
    }
  }

  async cancelProcessing() {
    if (!this.isProcessing || this.isCancelling) return;

    if (!confirm('确定要取消处理吗？')) return;

    try {
      const res = await window.electronAPI.process.cancel();
      if (!res || res.ok !== true) {
        throw new Error(res?.error || '取消失败');
      }
      this.isCancelling = true;
      this.isPaused = false;
      this.updateUI();
      this.progressManager.setCustomStatus('正在取消...', null);
      this.showMessage('正在取消处理，请稍候...', 'warning');
    } catch (error) {
      console.error('取消失败:', error);
      this.showError('取消失败: ' + (error?.message || String(error)));
    }
  }

  getProcessingOptions() {
    if (!this.configPanel) return {};

    const config = this.configPanel.getConfig();
    const opts = config.options || {};

    return {
      outputDir: opts.outputDir || null,
      scrubberOptions: {
        sensitiveKeys: config.sensitiveKeys,
        patterns: config.patterns,
        defaultMask: config.defaultMask || '***',
        enableMasking: opts.enableMasking !== false,
        maskUrlParams: opts.maskUrlParams !== false
      },
      outputSuffix: opts.outputSuffix || '.masked.log',
      encoding: opts.encoding || 'utf8',
      concurrency: opts.concurrency || 4,
      skipBinaryFiles: opts.skipBinaryFiles !== false
    };
  }

  onProcessingStart(data) {
    console.log('处理开始:', data);
    this.progressManager.start(data.totalFiles);
  }

  onProcessingProgress(data) {
    console.log('处理进度:', data);

    switch (data.type) {
      case 'file-start':
        this.fileListComponent.updateFileStatus(data.filePath, 'processing');
        this.progressManager.updateFile(data.index, data.total);
        break;

      case 'file-complete':
        this.fileListComponent.updateFileStatus(data.filePath, 'completed');
        this.progressManager.completeFile(data.index, data.total, data.result);
        break;

      case 'file-error':
        this.fileListComponent.updateFileStatus(data.filePath, 'error', null, data.error);
        this.progressManager.errorFile(data.index, data.total, data.error);
        break;

      case 'file-canceled':
        this.fileListComponent.updateFileStatus(data.filePath, 'canceled', null, data.result?.error || '已取消');
        this.progressManager.errorFile(data.index, data.total, data.result?.error || '已取消');
        break;

      case 'paused':
        this.isPaused = true;
        this.updateUI();
        this.progressManager.pause();
        break;

      case 'resumed':
        this.isPaused = false;
        this.updateUI();
        this.progressManager.resume();
        break;

      case 'cancel-requested':
        this.isCancelling = true;
        this.isPaused = false;
        this.updateUI();
        this.progressManager.setCustomStatus('正在取消...', null);
        break;
    }
  }

  onProcessingComplete(data) {
    console.log('处理完成:', data);

    this.isProcessing = false;
    this.isPaused = false;
    this.isCancelling = false;
    this.updateUI();

    if (data.cancelled) {
      this.progressManager.cancel();
    }

    // 显示结果
    this.showResults(data);
  }

  showResults(data) {
    const modal = document.getElementById('resultModal');
    const summaryEl = document.getElementById('resultSummary');

    if (!modal || !summaryEl) return;

    // 生成结果摘要
    const successful = data.results.filter(r => r.success);
    const failed = data.results.filter(r => !r.success);

    let totalStats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0
    };

    successful.forEach(result => {
      if (result.stats) {
        totalStats.totalLines += result.stats.totalLines;
        totalStats.maskedLines += result.stats.maskedLines;
        totalStats.errors += result.stats.errors;
      }
    });

    summaryEl.innerHTML = `
      <h4>处理完成</h4>
      <div class="result-stats">
        <div class="stat-item">
          <span class="stat-value">${data.results.length}</span>
          <span class="stat-label">总文件数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${successful.length}</span>
          <span class="stat-label">成功处理</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${failed.length}</span>
          <span class="stat-label">处理失败</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${totalStats.totalLines.toLocaleString()}</span>
          <span class="stat-label">总行数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${totalStats.maskedLines.toLocaleString()}</span>
          <span class="stat-label">脱敏行数</span>
        </div>
      </div>
      ${failed.length > 0 ? `
        <div class="alert alert-warning">
          <strong>注意:</strong> ${failed.length} 个文件处理失败
        </div>
      ` : ''}
    `;

    modal.classList.add('active');

    // 绑定结果对话框事件
    this.setupResultModalEvents(data);
  }

  setupResultModalEvents(data) {
    const modal = document.getElementById('resultModal');
    if (!modal) {
      console.warn('resultModal element not found');
      return;
    }

    const closeBtn = document.getElementById('closeResultModal');
    const openFolderBtn = document.getElementById('openOutputFolderBtn');
    const exportLogBtn = document.getElementById('exportLogBtn');

    // 关闭对话框
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }

    // 打开输出文件夹
    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        const successful = data.results.filter(r => r.success);
        if (successful.length > 0 && successful[0].outputPath) {
          // 使用 showItemInFolder 跨平台定位文件
          await window.electronAPI.shell.showItemInFolder(successful[0].outputPath);
        } else {
          console.warn('No successfully processed files with output path');
        }
      });
    }

    // 导出日志
    if (exportLogBtn) {
      exportLogBtn.addEventListener('click', () => {
        this.exportProcessingLog(data);
      });
    }

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  /**
   * 导出处理日志
   */
  exportProcessingLog(data) {
    const successful = data.results.filter(r => r.success);
    const failed = data.results.filter(r => !r.success);

    let logContent = '=== Log Scrubber 处理报告 ===\n\n';
    logContent += `总文件数: ${data.results.length}\n`;
    logContent += `成功: ${successful.length}\n`;
    logContent += `失败: ${failed.length}\n\n`;

    if (successful.length > 0) {
      logContent += '--- 成功处理 ---\n';
      for (const result of successful) {
        logContent += `${result.inputPath}\n`;
        logContent += `  输出: ${result.outputPath}\n`;
        logContent += `  行数: ${result.stats?.totalLines || 0}\n`;
        logContent += `  脱敏: ${result.stats?.maskedLines || 0}\n\n`;
      }
    }

    if (failed.length > 0) {
      logContent += '--- 处理失败 ---\n';
      for (const result of failed) {
        logContent += `${result.inputPath}\n`;
        logContent += `  错误: ${result.error}\n\n`;
      }
    }

    // 创建并下载日志文件
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-scrubber-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  showSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  showHelp() {
    const helpContent = `
      <div class="help-content" style="max-height: 400px; overflow-y: auto;">
        <h3>Log Scrubber 使用帮助</h3>

        <h4>基本功能</h4>
        <ul>
          <li><strong>添加文件</strong>: 点击"选择文件"或直接将文件拖拽到上传区域</li>
          <li><strong>开始处理</strong>: 选择文件后点击"开始处理"</li>
          <li><strong>暂停/继续</strong>: 处理过程中可暂停或继续</li>
          <li><strong>取消处理</strong>: 点击"取消"停止处理</li>
        </ul>

        <h4>配置选项</h4>
        <ul>
          <li><strong>敏感词</strong>: 自动脱敏日志中的 key=value 对</li>
          <li><strong>脱敏规则</strong>: 选择要应用的正则表达式规则</li>
          <li><strong>输出设置</strong>: 自定义输出目录和文件名后缀</li>
          <li><strong>高级选项</strong>: 编码、并发数、二进制文件处理</li>
        </ul>

        <h4>支持的格式</h4>
        <ul>
          <li>日志文件 (.log, .txt)</li>
          <li>支持 UTF-8 和 GBK 编码</li>
          <li>最大文件大小: 10GB</li>
        </ul>

        <h4>快捷键</h4>
        <ul>
          <li><strong>Esc</strong>: 关闭模态框</li>
        </ul>

        <p style="margin-top: 20px; color: #666; font-size: 0.9em;">
          版本: 1.0.0 | 问题反馈: 请查看控制台日志
        </p>
      </div>
    `;

    // 创建独立的帮助模态框，不影响设置面板
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>帮助</h3>
          <button class="btn btn-icon modal-close" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">${helpContent}</div>
      </div>
    `;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      modal.remove();
    };

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', cleanup);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) cleanup();
    });

    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(modal);
  }

  showError(message) {
    // 创建错误提示
    const errorEl = document.createElement('div');
    errorEl.className = 'alert alert-danger fade-in';

    // 使用安全的模板（不包含用户数据）
    errorEl.innerHTML = `
      <strong>错误:</strong> <span class="error-message"></span>
      <button class="btn btn-sm btn-icon close-error" type="button" style="float: right;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
        </svg>
      </button>
    `;

    // 使用 textContent 安全设置错误消息
    const msgEl = errorEl.querySelector('.error-message');
    if (msgEl) {
      msgEl.textContent = message;
    }

    // 清理函数：移除定时器并从 DOM 中移除元素
    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (errorEl.parentNode) {
        errorEl.remove();
      }
    };

    // 使用 addEventListener 绑定关闭事件
    const closeBtn = errorEl.querySelector('.close-error');
    if (closeBtn) {
      closeBtn.addEventListener('click', cleanup);
    }

    // 添加到页面顶部
    const container = document.querySelector('.app-container');
    if (container) {
      container.insertBefore(errorEl, container.firstChild);

      // 自动移除（使用清理函数防止内存泄漏）
      timeoutId = setTimeout(cleanup, 5000);
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息提示
    const messageEl = document.createElement('div');
    messageEl.className = `alert alert-${type} fade-in`;
    messageEl.textContent = message;

    // 清理函数
    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (messageEl.parentNode) {
        messageEl.remove();
      }
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-sm btn-icon';
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'float: right; margin-left: 8px; border: none; background: none; cursor: pointer; font-size: 18px; padding: 0 4px;';
    closeBtn.onclick = cleanup;
    messageEl.prepend(closeBtn);

    // 添加到页面顶部
    const container = document.querySelector('.app-container');
    if (container) {
      container.insertBefore(messageEl, container.firstChild);
      timeoutId = setTimeout(cleanup, 3000);
    }
  }

  updateUI() {
    const selectedFiles = this.fileListComponent.getSelectedFiles();
    const hasSelectedFiles = selectedFiles.length > 0;
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const cancelBtn = document.getElementById('cancelBtn');

    // 更新按钮状态
    if (startBtn) {
      startBtn.disabled = !hasSelectedFiles || this.isProcessing;
    }

    if (pauseBtn) {
      pauseBtn.disabled = !this.isProcessing || this.isCancelling;
      // 根据暂停状态更新按钮文本
      if (this.isPaused) {
        pauseBtn.innerHTML = '<span class="btn-icon">▶</span> 继续';
        pauseBtn.classList.add('btn-warning');
      } else {
        pauseBtn.innerHTML = '<span class="btn-icon">⏸</span> 暂停';
        pauseBtn.classList.remove('btn-warning');
      }
    }

    if (cancelBtn) {
      cancelBtn.disabled = !this.isProcessing || this.isCancelling;
    }

    // 更新拖拽区域状态
    if (this.isProcessing) {
      this.dragDropHandler.disable();
    } else {
      this.dragDropHandler.enable();
    }
  }
}

// 全局变量
let app;
let fileListComponent;
let dragDropHandler;

// 应用启动
document.addEventListener('DOMContentLoaded', () => {
  app = new LogScrubberApp();

  // 设置全局引用（供其他脚本使用）
  window.app = app;
  window.fileListComponent = app.fileListComponent;
  window.dragDropHandler = app.dragDropHandler;
});