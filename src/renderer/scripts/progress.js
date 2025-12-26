/**
 * 进度管理组件
 */

class ProgressManager {
  constructor() {
    this.progressText = document.getElementById('progressText');
    this.progressStats = document.getElementById('progressStats');
    this.progressFill = document.getElementById('progressFill');

    this.totalFiles = 0;
    this.completedFiles = 0;
    this.errorFiles = 0;
    this.currentFile = '';
    this.startTime = null;

    this.stats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0,
      processingTime: 0
    };

    this.init();
  }

  init() {
    this.reset();
  }

  start(totalFiles) {
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.errorFiles = 0;
    this.startTime = Date.now();

    this.updateProgress();
    this.updateText('开始处理...');
  }

  updateFile(currentIndex, total, fileName = '') {
    this.currentFile = fileName || `文件 ${currentIndex + 1}`;
    this.updateText(`正在处理: ${this.currentFile}`);
    this.updateProgress();
  }

  completeFile(currentIndex, total, result = null) {
    this.completedFiles++;

    if (result && result.stats) {
      this.stats.totalLines += result.stats.totalLines;
      this.stats.maskedLines += result.stats.maskedLines;
      this.stats.errors += result.stats.errors;
    }

    this.updateProgress();
    this.updateStats();

    if (this.completedFiles + this.errorFiles >= this.totalFiles) {
      this.complete();
    }
  }

  errorFile(currentIndex, total, error) {
    this.errorFiles++;
    this.updateProgress();

    if (this.completedFiles + this.errorFiles >= this.totalFiles) {
      this.complete();
    }
  }

  complete() {
    const endTime = Date.now();
    this.stats.processingTime = endTime - this.startTime;

    const successRate = this.totalFiles > 0 ?
      ((this.completedFiles / this.totalFiles) * 100).toFixed(1) : 0;

    this.updateText(`处理完成 - 成功率: ${successRate}%`);
    this.updateProgress(100);
    this.updateStats();
  }

  reset() {
    this.totalFiles = 0;
    this.completedFiles = 0;
    this.errorFiles = 0;
    this.currentFile = '';
    this.startTime = null;

    this.stats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0,
      processingTime: 0
    };

    this.updateText('准备就绪');
    this.updateProgress(0);
    this.updateStats();
  }

  updateProgress(percentage = null) {
    if (percentage === null) {
      percentage = this.totalFiles > 0 ?
        ((this.completedFiles + this.errorFiles) / this.totalFiles) * 100 : 0;
    }

    if (this.progressFill) {
      this.progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    }
  }

  updateText(text) {
    if (this.progressText) {
      this.progressText.textContent = text;
    }
  }

  updateStats() {
    if (!this.progressStats) return;

    let statsText = '';

    if (this.totalFiles > 0) {
      statsText += `${this.completedFiles}/${this.totalFiles} 文件`;

      if (this.errorFiles > 0) {
        statsText += ` (${this.errorFiles} 错误)`;
      }
    }

    if (this.stats.totalLines > 0) {
      if (statsText) statsText += ' | ';
      statsText += `${this.stats.maskedLines.toLocaleString()}/${this.stats.totalLines.toLocaleString()} 行已脱敏`;
    }

    if (this.stats.processingTime > 0) {
      if (statsText) statsText += ' | ';
      statsText += `耗时: ${this.formatTime(this.stats.processingTime)}`;
    }

    this.progressStats.textContent = statsText;
  }

  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    } else if (minutes > 0) {
      return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    } else {
      return `${seconds}s`;
    }
  }

  // 获取处理速度（行/秒）
  getProcessingSpeed() {
    if (this.stats.processingTime === 0) return 0;
    return Math.round((this.stats.totalLines / this.stats.processingTime) * 1000);
  }

  // 获取脱敏率
  getMaskingRate() {
    if (this.stats.totalLines === 0) return 0;
    return ((this.stats.maskedLines / this.stats.totalLines) * 100).toFixed(2);
  }

  // 获取成功率
  getSuccessRate() {
    if (this.totalFiles === 0) return 0;
    return ((this.completedFiles / this.totalFiles) * 100).toFixed(2);
  }

  // 获取详细统计信息
  getDetailedStats() {
    return {
      files: {
        total: this.totalFiles,
        completed: this.completedFiles,
        errors: this.errorFiles,
        successRate: this.getSuccessRate()
      },
      lines: {
        total: this.stats.totalLines,
        masked: this.stats.maskedLines,
        errors: this.stats.errors,
        maskingRate: this.getMaskingRate()
      },
      performance: {
        processingTime: this.stats.processingTime,
        speed: this.getProcessingSpeed(),
        formattedTime: this.formatTime(this.stats.processingTime)
      }
    };
  }

  // 显示详细进度信息
  showDetailedProgress() {
    const stats = this.getDetailedStats();

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>处理进度详情</h3>
          <button class="btn btn-icon modal-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="progress-details">
            <div class="detail-section">
              <h4>文件处理</h4>
              <div class="detail-stats">
                <div class="stat-item">
                  <span class="stat-label">总文件数</span>
                  <span class="stat-value">${stats.files.total}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">已完成</span>
                  <span class="stat-value">${stats.files.completed}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">错误</span>
                  <span class="stat-value">${stats.files.errors}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">成功率</span>
                  <span class="stat-value">${stats.files.successRate}%</span>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h4>行处理</h4>
              <div class="detail-stats">
                <div class="stat-item">
                  <span class="stat-label">总行数</span>
                  <span class="stat-value">${stats.lines.total.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">已脱敏</span>
                  <span class="stat-value">${stats.lines.masked.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">错误</span>
                  <span class="stat-value">${stats.lines.errors}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">脱敏率</span>
                  <span class="stat-value">${stats.lines.maskingRate}%</span>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h4>性能</h4>
              <div class="detail-stats">
                <div class="stat-item">
                  <span class="stat-label">处理时间</span>
                  <span class="stat-value">${stats.performance.formattedTime}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">处理速度</span>
                  <span class="stat-value">${stats.performance.speed} 行/秒</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 关闭对话框
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  // 暂停处理
  pause() {
    this.updateText('处理已暂停');
  }

  // 恢复处理
  resume() {
    this.updateText('恢复处理中...');
  }

  // 取消处理
  cancel() {
    this.updateText('处理已取消');
    this.updateProgress(0);
  }

  // 设置自定义状态
  setCustomStatus(text, progress = null) {
    this.updateText(text);
    if (progress !== null) {
      this.updateProgress(progress);
    }
  }

  // 添加动画效果
  addPulseAnimation() {
    if (this.progressFill) {
      this.progressFill.classList.add('pulse');
    }
  }

  removePulseAnimation() {
    if (this.progressFill) {
      this.progressFill.classList.remove('pulse');
    }
  }
}

// 导出类
window.ProgressManager = ProgressManager;