/**
 * 设置组件
 */

class SettingsComponent {
  constructor() {
    this.settingsModal = document.getElementById('settingsModal');
    this.themeSelect = document.getElementById('themeSelect');
    this.languageSelect = document.getElementById('languageSelect');
    this.autoSaveConfig = document.getElementById('autoSaveConfig');

    this.settings = {
      theme: 'light',
      language: 'zh-CN',
      autoSaveConfig: true
    };

    this.init();
  }

  init() {
    this.loadSettings();
    this.setupEventListeners();
    this.applyTheme();
  }

  setupEventListeners() {
    // 关闭设置对话框
    const closeBtn = document.getElementById('closeSettingsModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeSettings());
    }

    // 保存设置
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveSettings());
    }

    // 重置设置
    const resetBtn = document.getElementById('resetSettingsBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetSettings());
    }

    // 主题变化
    if (this.themeSelect) {
      this.themeSelect.addEventListener('change', () => {
        this.settings.theme = this.themeSelect.value;
        this.applyTheme();
      });
    }

    // 语言变化
    if (this.languageSelect) {
      this.languageSelect.addEventListener('change', () => {
        this.settings.language = this.languageSelect.value;
        // TODO: 实现语言切换
      });
    }

    // 自动保存配置
    if (this.autoSaveConfig) {
      this.autoSaveConfig.addEventListener('change', () => {
        this.settings.autoSaveConfig = this.autoSaveConfig.checked;
      });
    }

    // 点击背景关闭
    if (this.settingsModal) {
      this.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.settingsModal) {
          this.closeSettings();
        }
      });
    }

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.settingsModal.classList.contains('active')) {
        this.closeSettings();
      }
    });
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('log-scrubber-settings');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }

      // 检测系统主题
      if (this.settings.theme === 'auto') {
        this.settings.theme = this.getSystemTheme();
      }

      this.updateUI();
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  saveSettings() {
    try {
      // 收集当前设置
      this.collectCurrentSettings();

      // 保存到本地存储
      localStorage.setItem('log-scrubber-settings', JSON.stringify(this.settings));

      // 应用设置
      this.applySettings();

      // 显示成功消息
      this.showMessage('设置已保存', 'success');

      // 关闭对话框
      setTimeout(() => {
        this.closeSettings();
      }, 1000);

    } catch (error) {
      console.error('保存设置失败:', error);
      this.showMessage('保存设置失败: ' + error.message, 'error');
    }
  }

  resetSettings() {
    if (confirm('确定要重置所有设置吗？')) {
      this.settings = {
        theme: 'light',
        language: 'zh-CN',
        autoSaveConfig: true
      };

      this.updateUI();
      this.applySettings();
      this.showMessage('设置已重置', 'success');
    }
  }

  collectCurrentSettings() {
    if (this.themeSelect) {
      this.settings.theme = this.themeSelect.value;
    }

    if (this.languageSelect) {
      this.settings.language = this.languageSelect.value;
    }

    if (this.autoSaveConfig) {
      this.settings.autoSaveConfig = this.autoSaveConfig.checked;
    }
  }

  updateUI() {
    if (this.themeSelect) {
      this.themeSelect.value = this.settings.theme;
    }

    if (this.languageSelect) {
      this.languageSelect.value = this.settings.language;
    }

    if (this.autoSaveConfig) {
      this.autoSaveConfig.checked = this.settings.autoSaveConfig;
    }
  }

  applySettings() {
    this.applyTheme();
    this.applyLanguage();
    // 其他设置应用...
  }

  applyTheme() {
    const theme = this.settings.theme === 'auto' ? this.getSystemTheme() : this.settings.theme;

    document.documentElement.setAttribute('data-theme', theme);

    // 更新主题相关的元素
    this.updateThemeElements(theme);
  }

  applyLanguage() {
    // TODO: 实现语言切换逻辑
    console.log('应用语言:', this.settings.language);
  }

  updateThemeElements(theme) {
    // 更新可能需要主题特定处理的元素
    const isDark = theme === 'dark';

    // 更新进度条颜色
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
      progressFill.style.backgroundColor = isDark ? '#4a9eff' : '#007acc';
    }

    // 更新其他主题相关元素...
  }

  getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  openSettings() {
    if (this.settingsModal) {
      this.settingsModal.classList.add('active');
    }
  }

  closeSettings() {
    if (this.settingsModal) {
      this.settingsModal.classList.remove('active');
    }
  }

  showMessage(message, type = 'info') {
    // 在设置对话框中显示消息
    const modalBody = this.settingsModal?.querySelector('.modal-body');
    if (!modalBody) return;

    // 移除之前的消息
    const existingMessage = modalBody.querySelector('.settings-message');
    if (existingMessage) {
      existingMessage.remove();
    }

    // 创建新消息
    const messageEl = document.createElement('div');
    messageEl.className = `alert alert-${type} settings-message fade-in`;
    messageEl.textContent = message;

    // 插入到设置内容前面
    const settingsContent = modalBody.querySelector('.settings-content');
    if (settingsContent) {
      modalBody.insertBefore(messageEl, settingsContent);
    }

    // 自动移除
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.style.opacity = '0';
        setTimeout(() => {
          messageEl.remove();
        }, 300);
      }
    }, 3000);
  }

  // 导出设置
  exportSettings() {
    const dataStr = JSON.stringify(this.settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = 'log-scrubber-settings.json';
    link.click();

    this.showMessage('设置已导出', 'success');
  }

  // 导入设置
  async importSettings() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const settings = JSON.parse(text);

          // 验证设置格式
          if (this.isValidSettings(settings)) {
            this.settings = { ...this.settings, ...settings };
            this.updateUI();
            this.applySettings();
            this.showMessage('设置已导入', 'success');
          } else {
            throw new Error('设置文件格式无效');
          }
        } catch (error) {
          this.showMessage('导入设置失败: ' + error.message, 'error');
        }
      };

      input.click();
    } catch (error) {
      this.showMessage('导入设置失败: ' + error.message, 'error');
    }
  }

  isValidSettings(settings) {
    return (
      typeof settings === 'object' &&
      settings !== null &&
      (settings.theme === undefined || ['light', 'dark', 'auto'].includes(settings.theme)) &&
      (settings.language === undefined || typeof settings.language === 'string') &&
      (settings.autoSaveConfig === undefined || typeof settings.autoSaveConfig === 'boolean')
    );
  }

  // 监听系统主题变化
  watchSystemTheme() {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      mediaQuery.addEventListener('change', (e) => {
        if (this.settings.theme === 'auto') {
          this.applyTheme();
        }
      });
    }
  }

  // 获取当前设置
  getSettings() {
    return { ...this.settings };
  }

  // 设置特定选项
  setSetting(key, value) {
    if (this.settings.hasOwnProperty(key)) {
      this.settings[key] = value;
      this.updateUI();
      this.applySettings();
    }
  }

  // 获取特定设置
  getSetting(key, defaultValue = null) {
    return this.settings.hasOwnProperty(key) ? this.settings[key] : defaultValue;
  }
}

// 导出类
window.SettingsComponent = SettingsComponent;

// 初始化设置组件
document.addEventListener('DOMContentLoaded', () => {
  window.settingsComponent = new SettingsComponent();
});