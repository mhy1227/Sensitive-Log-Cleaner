/**
 * File processing utilities
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');
const { promisify } = require('util');
const iconv = require('iconv-lite');
const LogScrubber = require('./scrubber');
const { DEFAULT_OPTIONS } = require('./config');

const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * 创建 AbortError
 */
function createAbortError(message = '处理已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

/**
 * 如果 signal 已中止则抛出错误
 */
function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;

  const reason = signal.reason;
  const message =
    (typeof reason === 'string' && reason.trim())
      ? reason
      : (reason && typeof reason === 'object' && typeof reason.message === 'string' && reason.message.trim())
        ? reason.message
        : '处理已取消';

  throw createAbortError(message);
}

/**
 * 检查是否为中止错误
 */
function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

/**
 * 等待 drain 事件，支持中止信号
 */
async function waitForDrain(writable, signal) {
  if (!writable) return;
  throwIfAborted(signal);

  await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      writable.removeListener('drain', onDrain);
      writable.removeListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onDrain = () => finish(resolve);
    const onError = (err) => finish(() => reject(err));
    const onAbort = () => finish(resolve);

    writable.once('drain', onDrain);
    writable.once('error', onError);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  throwIfAborted(signal);
}

/**
 * 等待写入流完成或错误 - 更严谨的收尾等待逻辑
 * - finish → resolve
 * - error → reject
 * - close 且未 finish → reject（避免 silent close 误判成功）
 * - abort → 立即结束
 */
function waitForFinishOrError(writeStream, { signal, errorStreams = [] } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let finished = false;

    const cleanup = () => {
      writeStream.removeListener('finish', onFinish);
      writeStream.removeListener('error', onError);
      writeStream.removeListener('close', onClose);
      for (const s of errorStreams) {
        if (s) s.removeListener('error', onError);
      }
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onFinish = () => {
      finished = true;
      finish(resolve);
    };

    const onError = (err) => finish(() => reject(err));

    const onClose = () => {
      if (finished) return;
      finish(() => reject(new Error('写入流提前关闭')));
    };

    const onAbort = () => finish(resolve);

    writeStream.once('finish', onFinish);
    writeStream.once('error', onError);
    writeStream.once('close', onClose);

    for (const s of errorStreams) {
      if (s) s.once('error', onError);
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }).then(() => {
    throwIfAborted(signal);
  });
}

class FileProcessor {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // 防御性检查：确保 scrubberOptions 是对象
    const scrubberOptions = (options.scrubberOptions && typeof options.scrubberOptions === 'object')
      ? options.scrubberOptions
      : {};

    this.scrubber = new LogScrubber(scrubberOptions);
  }

  /**
   * 清理过期的临时文件
   * 扫描输出目录中符合 .tmp.[pid].[timestamp] 模式的文件并删除
   */
  async cleanupTempFiles(directory) {
    try {
      if (!fs.existsSync(directory)) return;
      
      const files = fs.readdirSync(directory);
      const tempPattern = /\.tmp\.\d+\.\d+$/;
      
      for (const file of files) {
        if (tempPattern.test(file)) {
          const fullPath = path.join(directory, file);
          try {
            const stats = fs.statSync(fullPath);
            // 仅清理超过 1 小时的临时文件，避免误删正在处理的文件
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            if (stats.mtimeMs < oneHourAgo) {
              fs.unlinkSync(fullPath);
              console.log(`Cleaned up old temp file: ${file}`);
            }
          } catch (e) {
            console.warn(`Failed to stat/unlink temp file ${file}: ${e.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error during temp file cleanup in ${directory}:`, error.message);
    }
  }

  /**
   * Check if a file is likely binary
   */
  async isBinaryFile(filePath) {
    let fd = null;
    try {
      const buffer = Buffer.alloc(512);
      fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);

      // Check for null bytes (common in binary files)
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }

      // Check for high percentage of non-printable characters
      let nonPrintable = 0;
      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i];
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
          nonPrintable++;
        }
      }

      return (nonPrintable / bytesRead) > 0.3;
    } catch (error) {
      console.warn(`Warning: Could not check if file is binary: ${error.message}`);
      return false;
    } finally {
      // 确保文件描述符始终被关闭
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          console.warn(`Warning: Failed to close file descriptor: ${closeError.message}`);
        }
      }
    }
  }

  /**
   * Validate input file
   */
  async validateFile(filePath) {
    try {
      await access(filePath, fs.constants.F_OK | fs.constants.R_OK);
      const stats = await stat(filePath);

      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      if (stats.size > this.options.maxFileSize) {
        throw new Error(`File size (${stats.size}) exceeds maximum allowed size (${this.options.maxFileSize})`);
      }

      if (this.options.skipBinaryFiles && await this.isBinaryFile(filePath)) {
        throw new Error('File appears to be binary');
      }

      return { valid: true, size: stats.size };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate output file path
   */
  generateOutputPath(inputPath, outputDir = null) {
    const dir = outputDir || path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    return path.join(dir, `${base}${this.options.outputSuffix}`);
  }

  /**
   * Process a single file
   */
  async processFile(inputPath, outputDir = null, runtime = {}) {
    const startTime = Date.now();
    const signal = runtime && typeof runtime === 'object' ? runtime.signal : null;
    const pauseController = runtime && typeof runtime === 'object' ? runtime.pauseController : null;

    const result = {
      inputPath,
      outputPath: null,
      success: false,
      cancelled: false,
      error: null,
      stats: null,
      processingTime: 0
    };

    let abortHandler = null;
    let unbindPause = null;
    let streamErrorHandlers = null;
    let tempPath = null;
    let tempFileCreated = false;

    try {
      throwIfAborted(signal);

      // Validate input file
      const validation = await this.validateFile(inputPath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Generate output path
      const outputPath = this.generateOutputPath(inputPath, outputDir);
      result.outputPath = outputPath;

      // Ensure output directory exists
      const outputDirPath = path.dirname(outputPath);
      if (!fs.existsSync(outputDirPath)) {
        fs.mkdirSync(outputDirPath, { recursive: true });
      }

      // 使用临时文件策略：先写入临时文件，成功后原子重命名
      tempPath = outputPath + '.tmp.' + process.pid + '.' + Date.now();

      // Reset scrubber statistics
      this.scrubber.resetStats();

      // Resolve encoding (Node 原生 + iconv-lite)
      const requestedEncoding = typeof this.options.encoding === 'string'
        ? this.options.encoding
        : 'utf8';
      const normalizedEncoding = requestedEncoding.toLowerCase();
      const iconvEncoding = normalizedEncoding === 'gb2312' ? 'gbk' : normalizedEncoding;

      const useIconv = iconvEncoding === 'gbk';
      const useNativeEncoding = Buffer.isEncoding(normalizedEncoding);

      if (!useNativeEncoding && !useIconv) {
        throw new Error(`Unsupported encoding: ${requestedEncoding}`);
      }

      // Create streams - write to temporary file
      const fileReadStream = fs.createReadStream(inputPath, {
        highWaterMark: this.options.highWaterMark,
        ...(useNativeEncoding ? { encoding: normalizedEncoding } : {})
      });

      const fileWriteStream = fs.createWriteStream(
        tempPath,
        useNativeEncoding ? { encoding: normalizedEncoding } : {}
      );
      tempFileCreated = true;

      const inputStream = useIconv
        ? fileReadStream.pipe(iconv.decodeStream(iconvEncoding))
        : fileReadStream;

      let writer = fileWriteStream;
      let encoder = null;
      if (useIconv) {
        encoder = iconv.encodeStream(iconvEncoding);
        encoder.pipe(fileWriteStream);
        writer = encoder;
      }

      // 创建 readline interface
      const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity
      });

      // 为所有 stream 绑定 error 监听器（防止 abort 时未处理的 error 导致崩溃）
      // 注意：rl 必须在 streams 数组之前创建
      streamErrorHandlers = new Map();
      const streams = [fileReadStream, fileWriteStream, inputStream, encoder].filter(Boolean);

      for (const stream of streams) {
        const handler = (err) => {
          // 静默处理 abort 错误，其他错误正常抛出
          if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
            console.log('[abort] Stream error suppressed:', err.message);
          } else if (err) {
            console.warn('[stream error]', err.message);
          }
        };
        streamErrorHandlers.set(stream, handler);
        stream.on('error', handler);
      }

      // 绑定 readline 到暂停控制器
      if (pauseController && typeof pauseController.bindReadline === 'function') {
        unbindPause = pauseController.bindReadline(rl);
      }

      // 设置中止处理器 - 静默终止，不抛 error
      abortHandler = () => {
        // 移除 error 监听器，避免重复触发
        for (const [stream, handler] of streamErrorHandlers) {
          try {
            stream.removeListener('error', handler);
          } catch (_) {}
        }
        streamErrorHandlers.clear();

        // 静默关闭/销毁流（不传入 error，避免触发 unhandled error）
        try { rl.close(); } catch (_) {}
        try { fileReadStream.destroy(); } catch (_) {}
        if (inputStream !== fileReadStream) {
          try { inputStream.destroy(); } catch (_) {}
        }
        if (encoder) {
          try { encoder.destroy(); } catch (_) {}
        }
        try { fileWriteStream.destroy(); } catch (_) {}
      };

      if (signal) {
        if (signal.aborted) {
          abortHandler();
        } else {
          signal.addEventListener('abort', abortHandler, { once: true });
        }
      }

      // Preserve original line endings if requested
      const lineEnding = this.options.preserveLineEndings
        ? (process.platform === 'win32' ? '\r\n' : '\n')
        : '\n';

      // Process line by line with backpressure handling
      let lineNumber = 0;
      for await (const line of rl) {
        // 检查暂停状态
        if (pauseController && typeof pauseController.waitIfPaused === 'function') {
          await pauseController.waitIfPaused(signal);
        }
        throwIfAborted(signal);

        lineNumber++;
        let processResult;
        try {
          processResult = this.scrubber.processLine(line);
        } catch (lineError) {
          console.error(`Error on line ${lineNumber}:`, lineError.message, lineError.stack);
          throw lineError; // Re-throw to stop processing
        }
        const chunk = processResult.masked + lineEnding;

        // Handle backpressure with abort support
        if (!writer.write(chunk)) {
          await waitForDrain(writer, null);
        }
      }

      // Close write stream and wait for completion
      // 使用更安全的收尾等待逻辑

      // 启动结束流程
      if (encoder) {
        encoder.end();
      } else {
        fileWriteStream.end();
      }

      // 等待完成或错误 - 跟踪所有相关流
      const errorStreams = [fileReadStream, inputStream, encoder].filter(Boolean);
      await waitForFinishOrError(fileWriteStream, { signal: null, errorStreams });

      // 成功：将临时文件重命名为最终输出文件
      if (tempFileCreated) {
        try {
          // 检查最终目标是否已存在（可能来自之前的运行），先删除
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          fs.renameSync(tempPath, outputPath);
        } catch (renameError) {
          console.error(`Failed to rename temp file: ${renameError.message}`);
          throw new Error('Failed to save output file');
        }
      }

      result.success = true;
      result.stats = this.scrubber.getStats();
      result.processingTime = Date.now() - startTime;

    } catch (error) {
      // 失败：清理临时文件
      if (tempFileCreated && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          console.warn(`Failed to clean up temp file: ${cleanupError.message}`);
        }
      }

      if (isAbortError(error) || (signal && signal.aborted)) {
        result.cancelled = true;
        result.error = '已取消';
      } else {
        result.error = error?.message || String(error);
        console.error(`Error processing file ${inputPath}: ${result.error}`, error?.stack);
      }
    } finally {
      // 清理绑定
      if (typeof unbindPause === 'function') {
        try {
          unbindPause();
        } catch (_) {}
      }
      // 移除中止监听器
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      // 清理 stream error 监听器
      if (streamErrorHandlers && streamErrorHandlers.size > 0) {
        for (const [stream, handler] of streamErrorHandlers) {
          try {
            stream.removeListener('error', handler);
          } catch (_) {}
        }
        streamErrorHandlers.clear();
      }
    }

    return result;
  }

  /**
   * Process multiple files with concurrency control
   */
  async processFiles(inputPaths, outputDir = null, runtime = {}) {
    const results = [];
    const semaphore = new Semaphore(this.options.concurrency);
    const signal = runtime && typeof runtime === 'object' ? runtime.signal : null;

    const processPromises = inputPaths.map(async (inputPath) => {
      let acquired = false;
      try {
        await semaphore.acquire(signal);
        acquired = true;

        throwIfAborted(signal);

        const result = await this.processFile(inputPath, outputDir, runtime);
        results.push(result);
        return result;
      } catch (error) {
        const cancelled = isAbortError(error) || (signal && signal.aborted);
        const message = error?.message || String(error);

        const result = cancelled
          ? {
              inputPath,
              outputPath: null,
              success: false,
              cancelled: true,
              error: '已取消',
              stats: null,
              processingTime: 0
            }
          : {
              inputPath,
              outputPath: null,
              success: false,
              cancelled: false,
              error: message,
              stats: null,
              processingTime: 0
            };

        results.push(result);
        return result;
      } finally {
        if (acquired) semaphore.release();
      }
    });

    await Promise.all(processPromises);
    return results;
  }

  /**
   * Generate summary report for multiple files
   */
  generateSummaryReport(results) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    let totalStats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0,
      patternMatches: {}
    };

    // Aggregate statistics
    for (const result of successful) {
      if (result.stats) {
        totalStats.totalLines += result.stats.totalLines;
        totalStats.maskedLines += result.stats.maskedLines;
        totalStats.errors += result.stats.errors;

        for (const [pattern, count] of Object.entries(result.stats.patternMatches)) {
          totalStats.patternMatches[pattern] =
            (totalStats.patternMatches[pattern] || 0) + count;
        }
      }
    }

    const totalTime = successful.reduce((sum, r) => sum + r.processingTime, 0);
    const avgTime = successful.length > 0 ? totalTime / successful.length : 0;

    let report = `\n=== Log Scrubber Summary Report ===\n`;
    report += `Files processed: ${results.length}\n`;
    report += `  Successful: ${successful.length}\n`;
    report += `  Failed: ${failed.length}\n`;
    report += `\nOverall Statistics:\n`;
    report += `  Total lines: ${totalStats.totalLines.toLocaleString()}\n`;
    report += `  Lines masked: ${totalStats.maskedLines.toLocaleString()}\n`;
    report += `  Processing errors: ${totalStats.errors}\n`;
    report += `  Average processing time: ${avgTime.toFixed(2)}ms\n`;

    if (Object.keys(totalStats.patternMatches).length > 0) {
      report += `\nPattern Matches:\n`;
      for (const [pattern, count] of Object.entries(totalStats.patternMatches)) {
        report += `  ${pattern}: ${count.toLocaleString()}\n`;
      }
    }

    if (failed.length > 0) {
      report += `\nFailed Files:\n`;
      for (const result of failed) {
        report += `  ${result.inputPath}: ${result.error}\n`;
      }
    }

    return report;
  }
}

/**
 * Simple semaphore for concurrency control with abort signal support
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }

      if (this.current < this.max) {
        this.current++;
        resolve();
        return;
      }

      const entry = { resolve, reject, signal, onAbort: null };
      if (signal) {
        entry.onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index !== -1) this.queue.splice(index, 1);
          reject(createAbortError());
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }

      this.queue.push(entry);
    });
  }

  release() {
    this.current--;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();

      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }

      if (entry.signal && entry.signal.aborted) {
        entry.reject(createAbortError());
        continue;
      }

      this.current++;
      entry.resolve();
      break;
    }
  }
}

module.exports = FileProcessor;