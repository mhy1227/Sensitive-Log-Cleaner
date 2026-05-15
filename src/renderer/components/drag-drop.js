/**
 * 文件拖拽功能组件
 */

class DragDropHandler {
  constructor() {
    this.dropZone = document.getElementById('dropZone');
    this.dropOverlay = document.getElementById('dropOverlay');
    this.fileManager = null;

    // 保存事件处理函数的引用
    this.boundHandlers = {
      dragenter: this.handleDragEnter.bind(this),
      dragover: this.handleDragOver.bind(this),
      dragleave: this.handleDragLeave.bind(this),
      drop: this.handleDrop.bind(this)
    };

    this.init();
  }

  init() {
    if (!this.dropZone) return;
    this.setupEventListeners();
    this.preventDefaultDragBehavior();
  }

  setFileManager(fileManager) {
    this.fileManager = fileManager;
  }

  setupEventListeners() {
    // 使用带 preventDefault 的包装器
    this.boundHandlersWithDefault = {
      dragenter: (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.boundHandlers.dragenter(e);
      },
      dragover: (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.boundHandlers.dragover(e);
      },
      dragleave: (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.boundHandlers.dragleave(e);
      },
      drop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.boundHandlers.drop(e);
      }
    };

    Object.entries(this.boundHandlersWithDefault).forEach(([eventName, handler]) => {
      this.dropZone.addEventListener(eventName, handler);
    });

    // 点击选择文件按钮
    const selectButtons = document.querySelectorAll('#selectFilesBtn, #selectFilesBtn2');
    selectButtons.forEach(btn => {
      btn.addEventListener('click', () => this.handleSelectFiles());
    });

    // 选择文件夹按钮
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', () => this.handleSelectFolder());
    }
  }

  preventDefaultDragBehavior() {
    // 阻止默认拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.addEventListener(eventName, (e) => {
        e.preventDefault();
      }, { capture: true });
    });
  }

  handleDragEnter(e) {
    this.dropZone?.classList.add('drag-over');
    this.dropOverlay?.classList.add('active');
  }

  handleDragOver(e) {
    e.dataTransfer.dropEffect = 'copy';
  }

  handleDragLeave(e) {
    const rect = this.dropZone?.getBoundingClientRect();
    if (!rect || !e.clientX) return;

    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.dropZone?.classList.remove('drag-over');
      this.dropOverlay?.classList.remove('active');
    }
  }

  async handleDrop(e) {
    this.dropZone?.classList.remove('drag-over');
    this.dropOverlay?.classList.remove('active');

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) {
      this.showMessage('没有检测到文件', 'warning');
      return;
    }

    // 收集有效的文件路径
    const validPaths = [];
    const invalidNames = [];

    for (const file of files) {
      const filePath = file.path;

      // 检查路径是否有效
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        // 路径为空时，尝试使用文件名（可能无法访问）
        if (file.name) {
          invalidNames.push(file.name);
        }
        continue;
      }

      // 检查扩展名
      const validExtensions = ['.log', '.txt', '.out', '.err'];
      const fileName = file.name?.toLowerCase() || '';
      const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

      if (hasValidExtension || file.type.startsWith('text/') || file.type === '') {
        validPaths.push(filePath);
      } else {
        invalidNames.push(file.name);
      }
    }

    // 提示无效文件
    if (invalidNames.length > 0) {
      this.showMessage(
        `跳过 ${invalidNames.length} 个不支持的文件: ${invalidNames.slice(0, 3).join(', ')}${invalidNames.length > 3 ? '...' : ''}`,
        'warning'
      );
    }

    // 添加有效文件
    if (validPaths.length > 0 && this.fileManager) {
      await this.fileManager.addFiles(validPaths);
      this.showMessage(`成功添加 ${validPaths.length} 个文件`, 'success');
    } else if (validPaths.length === 0 && invalidNames.length === 0) {
      this.showMessage('没有找到支持的文件格式', 'error');
    }
  }

  async handleSelectFiles() {
    try {
      const filePaths = await window.electronAPI.dialog.openFiles();
      if (filePaths?.length > 0 && this.fileManager) {
        await this.fileManager.addFiles(filePaths);
        this.showMessage(`成功添加 ${filePaths.length} 个文件`, 'success');
      }
    } catch (error) {
      this.showMessage('选择文件失败: ' + error.message, 'error');
    }
  }

  async handleSelectFolder() {
    try {
      const folderPath = await window.electronAPI.dialog.openDirectory();
      if (folderPath && this.fileManager) {
        this.showMessage('文件夹选择功能待实现', 'info');
      }
    } catch (error) {
      this.showMessage('选择文件夹失败: ' + error.message, 'error');
    }
  }

  showMessage(message, type = 'info') {
    window.app?.showMessage?.(message, type);
  }

  enable() {
    this.dropZone && (this.dropZone.style.pointerEvents = 'auto');
    this.dropZone && (this.dropZone.style.opacity = '1');
  }

  disable() {
    this.dropZone && (this.dropZone.style.pointerEvents = 'none');
    this.dropZone && (this.dropZone.style.opacity = '0.6');
  }

  destroy() {
    if (this.dropZone && this.boundHandlersWithDefault) {
      Object.entries(this.boundHandlersWithDefault).forEach(([eventName, handler]) => {
        this.dropZone.removeEventListener(eventName, handler);
      });
      this.dropZone = null;
      this.fileManager = null;
    }
  }
}

window.DragDropHandler = DragDropHandler;
