/**
 * 文件列表组件
 */

class FileListComponent {
  constructor() {
    this.fileList = document.getElementById('fileList');
    this.fileCount = document.getElementById('fileCount');
    this.totalSize = document.getElementById('totalSize');
    this.clearFilesBtn = document.getElementById('clearFilesBtn');

    this.files = new Map(); // 存储文件信息
    this.fileElements = new Map(); // 存储 DOM 元素引用，避免用路径做选择器
    this.init();
  }

  init() {
    if (!this.fileList) {
      console.error('File list element not found');
      return;
    }

    this.setupEventListeners();
  }

  setupEventListeners() {
    // 清空文件列表
    if (this.clearFilesBtn) {
      this.clearFilesBtn.addEventListener('click', () => {
        this.clearFiles();
      });
    }

    // 全选按钮
    const selectAllBtn = document.getElementById('selectAllBtn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        this.selectAllFiles();
      });
    }

    // 取消全选按钮
    const deselectAllBtn = document.getElementById('deselectAllBtn');
    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', () => {
        this.deselectAllFiles();
      });
    }
  }

  async addFile(filePath) {
    try {
      // 检查文件是否已存在
      if (this.files.has(filePath)) {
        console.warn('文件已存在:', filePath);
        return false;
      }

      // 尝试获取文件信息（可选，不影响文件添加到列表）
      let fileInfo = { size: 0 };
      try {
        fileInfo = await window.electronAPI.file.getInfo(filePath);
      } catch (infoError) {
        console.warn('获取文件信息失败:', infoError.message);
      }

      // 尝试验证文件（可选，不影响文件添加到列表）
      let validation = { valid: true, error: null };
      try {
        validation = await window.electronAPI.file.validate(filePath);
      } catch (validateError) {
        validation = { valid: false, error: validateError.message };
        console.warn('文件验证失败:', validateError.message);
      }

      const file = {
        path: filePath,
        name: this.getFileName(filePath),
        size: fileInfo.size,
        isValid: validation.valid,
        error: validation.error,
        status: validation.valid ? 'pending' : 'error',
        selected: validation.valid, // 默认选中有效文件
        addedAt: new Date()
      };

      this.files.set(filePath, file);
      this.renderFileItem(file);
      this.updateStats();

      // 通知主应用更新UI状态
      if (window.app) {
        window.app.updateUI();
      }

      return true;
    } catch (error) {
      console.error('添加文件失败:', error);

      // 即使出错也将文件添加到列表中（显示错误状态）
      const file = {
        path: filePath,
        name: this.getFileName(filePath),
        size: 0,
        isValid: false,
        error: error.message,
        status: 'error',
        selected: false,
        addedAt: new Date()
      };

      this.files.set(filePath, file);
      this.renderFileItem(file);
      this.updateStats();

      if (window.app) {
        window.app.updateUI();
      }

      return false;
    }
  }

  async addFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      const success = await this.addFile(filePath);
      results.push({ path: filePath, success });
    }

    return results;
  }

  removeFile(filePath) {
    if (this.files.has(filePath)) {
      this.files.delete(filePath);

      // 从 Map 中获取并移除 DOM 元素
      const fileItem = this.fileElements.get(filePath);
      if (fileItem) {
        fileItem.remove();
      }
      this.fileElements.delete(filePath);

      this.updateStats();
      this.checkEmptyState();
    }
  }

  clearFiles() {
    this.files.clear();
    this.fileElements.clear();
    this.renderFileList();
    this.updateStats();
  }

  updateFileStatus(filePath, status, progress = null, error = null) {
    const file = this.files.get(filePath);
    if (!file) return;

    file.status = status;
    if (progress !== null) file.progress = progress;
    if (error) file.error = error;

    // 从 Map 获取 DOM 元素
    const fileItem = this.fileElements.get(filePath);
    if (fileItem) {
      this.updateFileItemStatus(fileItem, file);
    }
  }

  renderFileList() {
    this.fileList.innerHTML = '';
    this.fileElements.clear();

    if (this.files.size === 0) {
      this.renderEmptyState();
      return;
    }

    const sortedFiles = Array.from(this.files.values()).sort((a, b) =>
      b.addedAt.getTime() - a.addedAt.getTime()
    );

    sortedFiles.forEach(file => {
      this.renderFileItem(file);
    });
  }

  renderFileItem(file) {
    // 移除空状态
    const emptyState = this.fileList.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const fileItem = document.createElement('div');
    fileItem.className = `file-item ${file.status}`;
    fileItem.dataset.filePath = file.path;

    // 使用安全的 innerHTML（不包含用户数据）
    fileItem.innerHTML = `
      <label class="checkbox-item file-checkbox">
        <input type="checkbox" class="file-select">
        <span class="checkmark"></span>
      </label>
      <div class="file-icon">
        ${this.getFileIcon(file.name)}
      </div>
      <div class="file-info">
        <div class="file-name"></div>
        <div class="file-details">
          <span class="file-size"></span>
        </div>
      </div>
      <div class="file-status">
        ${this.getStatusIcon(file.status)}
      </div>
      <div class="file-actions">
        <button class="btn btn-sm btn-icon file-action-info" type="button" title="查看信息">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/>
          </svg>
        </button>
        <button class="btn btn-sm btn-icon btn-danger file-action-remove" type="button" title="移除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
          </svg>
        </button>
      </div>
    `;

    this.fileList.appendChild(fileItem);

    // 存储 DOM 元素引用
    this.fileElements.set(file.path, fileItem);

    // 使用 textContent 安全设置用户数据
    const fileNameEl = fileItem.querySelector('.file-name');
    if (fileNameEl) {
      fileNameEl.textContent = file.name;
      fileNameEl.title = file.path;
    }

    const fileSizeEl = fileItem.querySelector('.file-size');
    if (fileSizeEl) {
      fileSizeEl.textContent = this.formatFileSize(file.size);
    }

    // 如果有错误，添加错误标签
    if (file.error) {
      const fileDetailsEl = fileItem.querySelector('.file-details');
      if (fileDetailsEl) {
        const errorSpan = document.createElement('span');
        errorSpan.className = 'file-error';
        errorSpan.textContent = file.status === 'canceled' ? '已取消' : '错误';
        errorSpan.title = file.error;
        fileDetailsEl.appendChild(errorSpan);
      }
    }

    // 使用 addEventListener 绑定事件（替代内联 onclick）
    const checkbox = fileItem.querySelector('.file-select');
    if (checkbox) {
      checkbox.checked = file.selected;
      checkbox.addEventListener('change', (e) => {
        this.toggleFileSelection(file.path, e.target.checked);
      });
    }

    const infoBtn = fileItem.querySelector('.file-action-info');
    if (infoBtn) {
      infoBtn.addEventListener('click', () => {
        this.showFileInfo(file.path);
      });
    }

    const removeBtn = fileItem.querySelector('.file-action-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.removeFile(file.path);
      });
    }
  }

  renderEmptyState() {
    this.fileList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        </svg>
        <p>暂无文件</p>
        <small>拖拽文件到右侧区域或点击"选择文件"</small>
      </div>
    `;
  }

  updateFileItemStatus(fileItem, file) {
    // 更新状态类
    fileItem.className = `file-item ${file.status}`;

    // 更新状态图标
    const statusIcon = fileItem.querySelector('.file-status');
    if (statusIcon) {
      statusIcon.innerHTML = this.getStatusIcon(file.status);
    }

    // 更新进度（如果有）
    if (file.progress !== undefined) {
      let progressBar = fileItem.querySelector('.file-progress');
      if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'file-progress';
        progressBar.innerHTML = `
          <div class="progress-bar-container">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
          </div>
        `;
        fileItem.querySelector('.file-info').appendChild(progressBar);
      }

      const progressFill = progressBar.querySelector('.progress-fill');
      if (progressFill) {
        progressFill.style.width = `${file.progress}%`;
      }
    }

    // 更新错误信息
    if (file.error) {
      const fileDetails = fileItem.querySelector('.file-details');
      let errorSpan = fileDetails.querySelector('.file-error');
      if (!errorSpan) {
        errorSpan = document.createElement('span');
        errorSpan.className = 'file-error';
        fileDetails.appendChild(errorSpan);
      }
      errorSpan.textContent = file.status === 'canceled' ? '已取消' : '错误';
      errorSpan.title = file.error;
    }
  }

  updateStats() {
    const fileCount = this.files.size;
    const totalSize = Array.from(this.files.values()).reduce((sum, file) => sum + file.size, 0);

    if (this.fileCount) {
      this.fileCount.textContent = `${fileCount} 个文件`;
    }

    if (this.totalSize) {
      this.totalSize.textContent = this.formatFileSize(totalSize);
    }
  }

  checkEmptyState() {
    if (this.files.size === 0) {
      this.renderEmptyState();
    }
  }

  getFileName(filePath) {
    return filePath.split(/[/\\]/).pop();
  }

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

  getStatusIcon(status) {
    switch (status) {
      case 'pending':
        return `
          <svg class="status-icon status-pending" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20Z"/>
          </svg>
        `;
      case 'processing':
        return `
          <svg class="status-icon status-processing" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
          </svg>
        `;
      case 'completed':
        return `
          <svg class="status-icon status-completed" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z"/>
          </svg>
        `;
      case 'canceled':
        return `
          <svg class="status-icon status-canceled" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M7,11H17V13H7V11Z"/>
          </svg>
        `;
      case 'error':
        return `
          <svg class="status-icon status-error" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
          </svg>
        `;
      default:
        return '';
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  showFileInfo(filePath) {
    const file = this.files.get(filePath);
    if (!file) return;

    // 创建文件信息对话框
    const modal = document.createElement('div');
    modal.className = 'modal active';

    // 使用安全的模板（不包含用户数据）
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>文件信息</h3>
          <button class="btn btn-icon modal-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="file-info-details">
            <div class="form-group">
              <label>文件名</label>
              <div class="form-input" readonly data-field="name"></div>
            </div>
            <div class="form-group">
              <label>文件路径</label>
              <div class="form-input" readonly data-field="path"></div>
            </div>
            <div class="form-group">
              <label>文件大小</label>
              <div class="form-input" readonly data-field="size"></div>
            </div>
            <div class="form-group">
              <label>状态</label>
              <div class="form-input" readonly data-field="status"></div>
            </div>
            <div class="form-group file-error-group">
              <label>错误信息</label>
              <div class="alert alert-danger" data-field="error"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 使用 textContent 安全设置数据
    const setField = (field, value) => {
      const el = modal.querySelector(`[data-field="${field}"]`);
      if (el) el.textContent = value;
    };

    setField('name', file.name);
    setField('path', file.path);
    setField('size', this.formatFileSize(file.size));
    setField('status', this.getStatusText(file.status));

    // 处理错误信息
    const errorGroup = modal.querySelector('.file-error-group');
    if (file.error) {
      setField('error', file.error);
    } else if (errorGroup) {
      errorGroup.remove();
    }

    // 绑定关闭事件
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.remove();
      });
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  getStatusText(status) {
    switch (status) {
      case 'pending': return '等待处理';
      case 'processing': return '处理中';
      case 'completed': return '已完成';
      case 'canceled': return '已取消';
      case 'error': return '错误';
      default: return '未知';
    }
  }

  getFiles() {
    return Array.from(this.files.values());
  }

  getValidFiles() {
    return Array.from(this.files.values()).filter(file => file.isValid);
  }

  getSelectedFiles() {
    return Array.from(this.files.values()).filter(file => file.selected && file.isValid);
  }

  toggleFileSelection(filePath, selected) {
    const file = this.files.get(filePath);
    if (file) {
      file.selected = selected;
      this.updateStats();

      // 通知主应用更新UI状态
      if (window.app) {
        window.app.updateUI();
      }
    }
  }

  selectAllFiles() {
    this.files.forEach(file => {
      if (file.isValid) {
        file.selected = true;
      }
    });
    this.refreshFileList();
    this.updateStats();

    // 通知主应用更新UI状态
    if (window.app) {
      window.app.updateUI();
    }
  }

  deselectAllFiles() {
    this.files.forEach(file => {
      file.selected = false;
    });
    this.refreshFileList();
    this.updateStats();

    // 通知主应用更新UI状态
    if (window.app) {
      window.app.updateUI();
    }
  }

  refreshFileList() {
    // 重新渲染所有文件项的勾选状态
    this.files.forEach(file => {
      const fileItem = this.fileElements.get(file.path);
      if (fileItem) {
        const checkbox = fileItem.querySelector('.file-select');
        if (checkbox) {
          checkbox.checked = file.selected;
        }
      }
    });
  }

  hasFiles() {
    return this.files.size > 0;
  }

  hasValidFiles() {
    return this.getValidFiles().length > 0;
  }
}

// 导出类
window.FileListComponent = FileListComponent;