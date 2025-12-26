/**
 * 文件拖拽功能组件
 */

class DragDropHandler {
  constructor() {
    this.dropZone = document.getElementById('dropZone');
    this.dropOverlay = document.getElementById('dropOverlay');
    this.fileManager = null; // 将在初始化时设置

    // 保存事件处理函数的引用（用于正确清理）
    this.boundHandlers = {
      dragenter: this.handleDragEnter.bind(this),
      dragover: this.handleDragOver.bind(this),
      dragleave: this.handleDragLeave.bind(this),
      drop: this.handleDrop.bind(this)
    };

    this.init();
  }

  init() {
    if (!this.dropZone) {
      console.error('Drop zone element not found');
      return;
    }

    this.setupEventListeners();
    this.preventDefaultDragBehavior();
  }

  setFileManager(fileManager) {
    this.fileManager = fileManager;
  }

  setupEventListeners() {
    // 使用保存的引用绑定事件（带 preventDefault 包装）
    this.boundHandlersWithDefault = {
      dragenter: (e) => {
        e.preventDefault();
        this.boundHandlers.dragenter(e);
      },
      dragover: (e) => {
        e.preventDefault();
        this.boundHandlers.dragover(e);
      },
      dragleave: (e) => {
        e.preventDefault();
        this.boundHandlers.dragleave(e);
      },
      drop: (e) => {
        e.preventDefault();
        this.boundHandlers.drop(e);
      }
    };

    Object.entries(this.boundHandlersWithDefault).forEach(([eventName, handler]) => {
      this.dropZone.addEventListener(eventName, handler);
    });

    // 点击选择文件
    const selectButtons = document.querySelectorAll('#selectFilesBtn, #selectFilesBtn2');
    selectButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleSelectFiles();
      });
    });

    // 选择文件夹
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', () => {
        this.handleSelectFolder();
      });
    }
  }

  preventDefaultDragBehavior() {
    // 阻止整个窗口的默认拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
  }

  handleDragEnter(e) {
    this.dropZone.classList.add('drag-over');
    if (this.dropOverlay) {
      this.dropOverlay.classList.add('active');
    }
  }

  handleDragOver(e) {
    // 设置拖拽效果
    e.dataTransfer.dropEffect = 'copy';
  }

  handleDragLeave(e) {
    // 检查是否真的离开了拖拽区域
    const rect = this.dropZone.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.dropZone.classList.remove('drag-over');
      if (this.dropOverlay) {
        this.dropOverlay.classList.remove('active');
      }
    }
  }

  async handleDrop(e) {
    this.dropZone.classList.remove('drag-over');
    if (this.dropOverlay) {
      this.dropOverlay.classList.remove('active');
    }

    const files = Array.from(e.dataTransfer.files);

    if (files.length === 0) {
      this.showMessage('没有检测到文件', 'warning');
      return;
    }

    await this.processDroppedFiles(files);
  }

  async processDroppedFiles(files) {
    const validFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      if (this.isValidFile(file)) {
        validFiles.push(file.path);
      } else {
        invalidFiles.push(file.name);
      }
    }

    if (invalidFiles.length > 0) {
      this.showMessage(
        `跳过了 ${invalidFiles.length} 个不支持的文件: ${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`,
        'warning'
      );
    }

    if (validFiles.length > 0) {
      if (this.fileManager) {
        await this.fileManager.addFiles(validFiles);
        this.showMessage(`成功添加 ${validFiles.length} 个文件`, 'success');
      }
    } else {
      this.showMessage('没有找到支持的文件格式', 'error');
    }
  }

  isValidFile(file) {
    // 检查文件类型
    const validExtensions = ['.log', '.txt', '.out', '.err'];
    const fileName = file.name.toLowerCase();

    // 检查扩展名
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

    // 检查MIME类型
    const isTextFile = file.type.startsWith('text/') || file.type === '';

    // 检查文件大小 (10GB限制)
    const maxSize = 10 * 1024 * 1024 * 1024;
    const isValidSize = file.size <= maxSize;

    return (hasValidExtension || isTextFile) && isValidSize;
  }

  async handleSelectFiles() {
    try {
      const filePaths = await window.electronAPI.dialog.openFiles();

      if (filePaths && filePaths.length > 0) {
        if (this.fileManager) {
          await this.fileManager.addFiles(filePaths);
          this.showMessage(`成功添加 ${filePaths.length} 个文件`, 'success');
        }
      }
    } catch (error) {
      console.error('选择文件失败:', error);
      this.showMessage('选择文件失败: ' + error.message, 'error');
    }
  }

  async handleSelectFolder() {
    try {
      const folderPath = await window.electronAPI.dialog.openDirectory();

      if (folderPath) {
        // 这里可以扩展为扫描文件夹中的日志文件
        this.showMessage('文件夹选择功能待实现', 'info');
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
      this.showMessage('选择文件夹失败: ' + error.message, 'error');
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息提示
    const messageEl = document.createElement('div');
    messageEl.className = `alert alert-${type} fade-in`;
    messageEl.textContent = message;

    // 添加到页面
    const container = document.querySelector('.drop-zone-container');
    if (container) {
      container.appendChild(messageEl);

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
  }

  // 获取文件图标
  getFileIcon(fileName) {
    const ext = fileName.toLowerCase().split('.').pop();

    switch (ext) {
      case 'log':
        return `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
          </svg>
        `;
      case 'txt':
        return `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
          </svg>
        `;
      default:
        return `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z"/>
          </svg>
        `;
    }
  }

  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 启用拖拽区域
  enable() {
    this.dropZone.style.pointerEvents = 'auto';
    this.dropZone.style.opacity = '1';
  }

  // 禁用拖拽区域
  disable() {
    this.dropZone.style.pointerEvents = 'none';
    this.dropZone.style.opacity = '0.6';
  }

  // 清理事件监听器
  destroy() {
    if (this.dropZone) {
      // 使用保存的引用正确移除事件监听器
      if (this.boundHandlersWithDefault) {
        Object.entries(this.boundHandlersWithDefault).forEach(([eventName, handler]) => {
          this.dropZone.removeEventListener(eventName, handler);
        });
        this.boundHandlersWithDefault = null;
      }
      this.dropZone = null;
      this.fileManager = null;
    }
  }
}

// 导出类
window.DragDropHandler = DragDropHandler;