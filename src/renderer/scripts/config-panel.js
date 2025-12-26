/**
 * 配置面板组件
 */

class ConfigPanel {
  constructor() {
    this.config = null;
    this.defaultConfig = null;

    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 重置配置按钮
    const resetConfigBtn = document.getElementById('resetConfigBtn');
    if (resetConfigBtn) {
      resetConfigBtn.addEventListener('click', () => this.resetConfig());
    }

    // 选择输出目录
    const selectOutputDirBtn = document.getElementById('selectOutputDirBtn');
    if (selectOutputDirBtn) {
      selectOutputDirBtn.addEventListener('click', () => this.selectOutputDirectory());
    }

    // 监听配置变化
    this.setupConfigChangeListeners();
  }

  setupConfigChangeListeners() {
    // 脱敏规则复选框
    const ruleCheckboxes = document.querySelectorAll('[id^="rule_"]');
    ruleCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => this.onConfigChange());
    });

    // 输出设置
    const outputSuffix = document.getElementById('outputSuffix');
    if (outputSuffix) {
      outputSuffix.addEventListener('input', () => this.onConfigChange());
    }

    // 高级选项
    const concurrency = document.getElementById('concurrency');
    if (concurrency) {
      concurrency.addEventListener('input', () => this.onConfigChange());
    }

    const encoding = document.getElementById('encoding');
    if (encoding) {
      encoding.addEventListener('change', () => this.onConfigChange());
    }

    const enableMasking = document.getElementById('enableMasking');
    if (enableMasking) {
      enableMasking.addEventListener('change', () => this.onConfigChange());
    }

    const maskUrlParams = document.getElementById('maskUrlParams');
    if (maskUrlParams) {
      maskUrlParams.addEventListener('change', () => this.onConfigChange());
    }

    const skipBinaryFiles = document.getElementById('skipBinaryFiles');
    if (skipBinaryFiles) {
      skipBinaryFiles.addEventListener('change', () => this.onConfigChange());
    }
  }

  setConfig(config) {
    // 统一配置结构：支持嵌套 options 和扁平结构
    if (config && typeof config === 'object') {
      this.config = {
        patterns: config.patterns || [],
        sensitiveKeys: config.sensitiveKeys || [],
        defaultMask: config.defaultMask || '***',
        options: {
          ...(config.options || {}),
          // 扁平字段兼容迁移
          outputSuffix: config.outputSuffix || config.options?.outputSuffix || '.masked.log',
          outputDir: config.outputDir || config.options?.outputDir || '',
          encoding: config.encoding || config.options?.encoding || 'utf8',
          concurrency: config.concurrency || config.options?.concurrency || 4,
          enableMasking: config.enableMasking ?? config.options?.enableMasking ?? true,
          maskUrlParams: config.maskUrlParams ?? config.options?.maskUrlParams ?? true,
          skipBinaryFiles: config.skipBinaryFiles ?? config.options?.skipBinaryFiles ?? true
        }
      };
    } else {
      this.config = null;
    }

    // 安全地深拷贝配置（处理无法序列化的内容）
    try {
      this.defaultConfig = this.config ? JSON.parse(JSON.stringify(this.config)) : null;
    } catch (copyError) {
      console.warn('配置深拷贝失败，使用浅拷贝:', copyError.message);
      this.defaultConfig = this.config ? { ...this.config } : null;
    }

    this.updateUI();
  }

  getConfig() {
    // 返回统一结构
    return {
      patterns: this.getEnabledPatterns(),
      sensitiveKeys: this.config?.sensitiveKeys || [],
      defaultMask: this.config?.defaultMask || '***',
      options: {
        outputSuffix: this.getInputValue('outputSuffix', this.config?.options?.outputSuffix || '.masked.log'),
        outputDir: this.getInputValue('outputDir', this.config?.options?.outputDir || ''),
        encoding: this.getInputValue('encoding', this.config?.options?.encoding || 'utf8'),
        concurrency: parseInt(this.getInputValue('concurrency', String(this.config?.options?.concurrency || 4))),
        enableMasking: this.getCheckboxValue('enableMasking', this.config?.options?.enableMasking !== false),
        maskUrlParams: this.getCheckboxValue('maskUrlParams', this.config?.options?.maskUrlParams !== false),
        skipBinaryFiles: this.getCheckboxValue('skipBinaryFiles', this.config?.options?.skipBinaryFiles !== false)
      }
    };
  }

  getEnabledPatterns() {
    if (!this.config?.patterns) return [];

    return this.config.patterns.map(pattern => ({
      ...pattern,
      enabled: this.getCheckboxValue(`rule_${pattern.name}`, pattern.enabled !== false)
    }));
  }

  updateUI() {
    if (!this.config) return;

    // 更新脱敏规则复选框
    if (this.config.patterns) {
      this.config.patterns.forEach(pattern => {
        const checkbox = document.getElementById(`rule_${pattern.name}`);
        if (checkbox) {
          checkbox.checked = pattern.enabled !== false;
        }
      });
    }

    // 更新开关配置（从 options 中读取）
    const opts = this.config.options || {};
    this.setCheckboxValue('enableMasking', opts.enableMasking !== false);
    this.setCheckboxValue('maskUrlParams', opts.maskUrlParams !== false);

    // 更新输出设置
    const outputSuffix = document.getElementById('outputSuffix');
    if (outputSuffix) {
      outputSuffix.value = opts.outputSuffix || '.masked.log';
    }
    const outputDir = document.getElementById('outputDir');
    if (outputDir) {
      outputDir.value = opts.outputDir || '';
    }

    // 更新高级选项
    const concurrency = document.getElementById('concurrency');
    if (concurrency) {
      concurrency.value = String(opts.concurrency || 4);
    }
    const encoding = document.getElementById('encoding');
    if (encoding) {
      encoding.value = opts.encoding || 'utf8';
    }
    const skipBinaryFiles = document.getElementById('skipBinaryFiles');
    if (skipBinaryFiles) {
      skipBinaryFiles.checked = opts.skipBinaryFiles !== false;
    }
  }

  async selectOutputDirectory() {
    try {
      const dirPath = await window.electronAPI.dialog.openDirectory();
      if (dirPath) {
        this.setInputValue('outputDir', dirPath);
        this.onConfigChange();
      }
    } catch (error) {
      console.error('选择输出目录失败:', error);
    }
  }

  resetConfig() {
    if (this.defaultConfig) {
      this.setConfig(this.defaultConfig);
      this.showMessage('配置已重置', 'success');
    }
  }

  onConfigChange() {
    // 配置变化时的处理
    console.log('配置已更改');

    // 可以在这里添加实时预览功能
    this.validateConfig();
  }

  validateConfig() {
    const config = this.getConfig();
    const opts = config.options || {};
    const errors = [];

    // 验证并发数
    if (opts.concurrency < 1 || opts.concurrency > 16) {
      errors.push('并发数必须在 1-16 之间');
    }

    // 验证输出后缀
    if (!opts.outputSuffix || opts.outputSuffix.trim() === '') {
      errors.push('输出后缀不能为空');
    }

    // 显示验证结果
    this.showValidationErrors(errors);

    return errors.length === 0;
  }

  showValidationErrors(errors) {
    // 移除之前的错误提示
    const existingErrors = document.querySelectorAll('.config-error');
    existingErrors.forEach(el => el.remove());

    if (errors.length === 0) return;

    // 显示新的错误提示
    const configContent = document.querySelector('.config-content');
    if (configContent) {
      errors.forEach(error => {
        const errorEl = document.createElement('div');
        errorEl.className = 'alert alert-danger config-error';
        errorEl.textContent = error;
        configContent.insertBefore(errorEl, configContent.firstChild);
      });
    }
  }

  // 工具方法
  getInputValue(id, defaultValue = '') {
    const element = document.getElementById(id);
    return element ? element.value : defaultValue;
  }

  setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.value = value;
    }
  }

  getCheckboxValue(id, defaultValue = false) {
    const element = document.getElementById(id);
    return element ? element.checked : defaultValue;
  }

  setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.checked = value;
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息提示
    const messageEl = document.createElement('div');
    messageEl.className = `alert alert-${type} fade-in`;
    messageEl.textContent = message;

    // 清理函数：清除定时器并移除元素
    let timeoutId = null;
    let fadeTimeoutId = null;
    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (fadeTimeoutId !== null) {
        clearTimeout(fadeTimeoutId);
        fadeTimeoutId = null;
      }
      if (messageEl.parentNode) {
        messageEl.remove();
      }
    };

    // 添加到配置面板
    const configHeader = document.querySelector('.config-header');
    if (configHeader) {
      configHeader.parentNode.insertBefore(messageEl, configHeader.nextSibling);

      // 自动移除（防止内存泄漏）
      timeoutId = setTimeout(() => {
        messageEl.style.opacity = '0';
        fadeTimeoutId = setTimeout(cleanup, 300);
      }, 2000);
    }
  }

  // 导出配置
  exportConfig() {
    const config = this.getConfig();
    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = 'log-scrubber-config.json';
    link.click();

    this.showMessage('配置已导出', 'success');
  }

  // 导入配置
  async importConfig() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const config = JSON.parse(text);

          // 验证配置格式
          if (this.isValidConfig(config)) {
            this.setConfig(config);
            this.showMessage('配置已导入', 'success');
          } else {
            throw new Error('配置文件格式无效');
          }
        } catch (error) {
          this.showMessage('导入配置失败: ' + error.message, 'error');
        }
      };

      input.click();
    } catch (error) {
      this.showMessage('导入配置失败: ' + error.message, 'error');
    }
  }

  isValidConfig(config) {
    // 验证配置对象的基本类型
    if (typeof config !== 'object' || config === null) {
      return false;
    }

    // 允许的属性列表（白名单）
    const allowedProps = [
      'patterns', 'sensitiveKeys', 'options', 'defaultMask',
      'outputSuffix', 'outputDir', 'encoding', 'concurrency', 'skipBinaryFiles'
    ];

    // 检查是否有不允许的属性
    const configKeys = Object.keys(config);
    for (const key of configKeys) {
      if (!allowedProps.includes(key)) {
        console.warn(`无效的配置属性: ${key}`);
        return false;
      }
    }

    // 验证 patterns 结构
    if (config.patterns !== undefined) {
      if (!Array.isArray(config.patterns)) {
        return false;
      }
      for (const pattern of config.patterns) {
        if (typeof pattern.name !== 'string' || typeof pattern.enabled !== 'boolean') {
          console.warn('无效的 pattern 结构:', pattern);
          return false;
        }
      }
    }

    // 验证 sensitiveKeys 结构
    if (config.sensitiveKeys !== undefined) {
      if (!Array.isArray(config.sensitiveKeys)) {
        return false;
      }
      for (const key of config.sensitiveKeys) {
        if (typeof key !== 'string') {
          console.warn('无效的 sensitiveKey:', key);
          return false;
        }
      }
    }

    // 验证 options 结构（如果存在）
    if (config.options !== undefined) {
      if (typeof config.options !== 'object' || config.options === null) {
        return false;
      }
      const allowedOptions = [
        'outputSuffix', 'outputDir', 'encoding', 'concurrency', 'skipBinaryFiles',
        'enableMasking', 'maskUrlParams', 'preserveLineEndings', 'maxFileSize',
        'highWaterMark', 'kvSeparators'
      ];
      const optionKeys = Object.keys(config.options);
      for (const key of optionKeys) {
        if (!allowedOptions.includes(key)) {
          console.warn(`无效的 options 属性: ${key}`);
          return false;
        }
      }
    }

    // 验证类型
    if (config.concurrency !== undefined && typeof config.concurrency !== 'number') {
      return false;
    }
    if (config.skipBinaryFiles !== undefined && typeof config.skipBinaryFiles !== 'boolean') {
      return false;
    }

    return true;
  }

  // 获取配置摘要
  getConfigSummary() {
    const config = this.getConfig();
    const opts = config.options || {};
    const enabledPatterns = config.patterns ? config.patterns.filter(p => p.enabled).length : 0;

    return {
      enabledPatterns,
      totalPatterns: config.patterns ? config.patterns.length : 0,
      outputSuffix: opts.outputSuffix || '.masked.log',
      concurrency: opts.concurrency || 4,
      encoding: opts.encoding || 'utf8'
    };
  }

  // 预览脱敏效果
  previewMasking(sampleText) {
    if (!sampleText) {
      sampleText = `
        用户登录: email=user@example.com, password=secret123
        JWT令牌: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123
        手机号: 13812345678
        身份证: 110101199001011234
      `.trim();
    }

    // 这里可以调用脱敏逻辑进行预览
    // 由于我们在渲染进程中，需要通过IPC调用主进程的脱敏功能
    return sampleText; // 临时返回原文本
  }
}

// 导出类
window.ConfigPanel = ConfigPanel;