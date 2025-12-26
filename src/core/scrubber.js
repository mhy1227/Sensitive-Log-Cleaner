/**
 * Core log scrubbing functionality
 */

const {
  SENSITIVE_KEYS,
  PATTERNS,
  KV_SEPARATORS,
  DEFAULT_MASK,
} = require("./config");

class LogScrubber {
  constructor(options = {}) {
    // 防御性检查：确保 options 是对象
    const opts = (options && typeof options === 'object') ? options : {};

    // 是否启用脱敏（默认启用）
    this.enableMasking = opts.enableMasking !== false;

    // 是否脱敏 URL 参数（默认启用，false 则保留 URL 路径和参数名）
    this.maskUrlParams = opts.maskUrlParams !== false;

    // 初始化 sensitiveKeys 为 Set
    const keysInput = opts.sensitiveKeys || SENSITIVE_KEYS;
    this.sensitiveKeys = new Set(
      (Array.isArray(keysInput) ? keysInput : [keysInput]).map((key) => String(key).toLowerCase())
    );

    // 防御性检查：确保 patterns 是数组
    let patternsArray = opts.patterns;
    if (!Array.isArray(patternsArray)) {
      patternsArray = PATTERNS;
    }

    this.patterns = patternsArray.filter(
      (p) => p && typeof p === 'object' && p.enabled === true
    );

    // 防御性检查：确保 kvSeparators 是数组
    this.kvSeparators = Array.isArray(opts.kvSeparators) ? opts.kvSeparators : KV_SEPARATORS;

    // 确保 defaultMask 是字符串
    this.defaultMask = (typeof opts.defaultMask === 'string' && opts.defaultMask) ? opts.defaultMask : DEFAULT_MASK;

    this.stats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0,
      patternMatches: {},
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalLines: 0,
      maskedLines: 0,
      errors: 0,
      patternMatches: {},
    };
  }

  /**
   * Mask JSON structured logs by recursively processing keys and values
   * Returns { isJson, masked, hasChanges }
   */
  maskJsonLine(line) {
    // 防御性检查：确保 line 是字符串
    if (typeof line !== 'string') {
      return { isJson: false, masked: line, hasChanges: false };
    }

    // 尝试解析 JSON
    let parsed;
    try {
      // 清理首尾空白
      const trimmed = line.trim();
      // 只处理以 { 或 [ 开头的行（简单的 JSON 检测）
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return { isJson: false, masked: line, hasChanges: false };
      }
      parsed = JSON.parse(trimmed);
    } catch (e) {
      // 不是有效的 JSON，回退到文本处理
      return { isJson: false, masked: line, hasChanges: false };
    }

    // 递归处理 JSON 对象/数组
    const maskValue = (value, parentKey = null) => {
      if (value === null || value === undefined) {
        return { value, changed: false };
      }

      if (typeof value === 'string') {
        // 处理字符串值中的敏感信息
        let result = value;
        let changed = false;

        // 检查是否是已脱敏的值（避免重复脱敏）
        if (result === this.defaultMask) {
          return { value: result, changed: false };
        }

        // 尝试 JSON 解析嵌套
        const nestedResult = this.maskJsonLine(result);
        if (nestedResult.isJson) {
          return { value: nestedResult.masked, changed: nestedResult.hasChanges };
        }

        // 使用敏感键脱敏字符串值
        for (const key of this.sensitiveKeys) {
          const regex = new RegExp(`(${key}\\s*[:=]\\s*)([^\\s\\n\\r,;&"']+)`, 'gi');
          result = result.replace(regex, (match, prefix, val) => {
            changed = true;
            return prefix + this.defaultMask;
          });
        }

        return { value: changed ? result : value, changed };
      }

      if (Array.isArray(value)) {
        let arrChanged = false;
        const masked = value.map((v, idx) => {
          const { value: mv, changed: c } = maskValue(v);
          if (c) arrChanged = true;
          return mv;
        });
        return { value: masked, changed: arrChanged };
      }

      if (typeof value === 'object') {
        let objChanged = false;
        const maskedObj = {};
        for (const [k, v] of Object.entries(value)) {
          const lowerKey = k.toLowerCase();
          const { value: mv, changed: c } = this.sensitiveKeys.has(lowerKey)
            ? { value: this.defaultMask, changed: value !== this.defaultMask }
            : maskValue(v);

          if (c) objChanged = true;
          maskedObj[k] = mv;
        }
        return { value: maskedObj, changed: objChanged };
      }

      return { value, changed: false };
    };

    const { value: maskedValue, changed } = maskValue(parsed);

    // 如果没有变化，返回原始行以保持格式
    if (!changed) {
      return {
        isJson: true,
        masked: line,  // 返回原始行
        hasChanges: false
      };
    }

    return {
      isJson: true,
      masked: JSON.stringify(maskedValue),
      hasChanges: true
    };
  }

  /**
   * Mask key-value pairs where the key is sensitive
   * Supports formats: key=value, key: value, key => value, key -> value
   */
  maskKeyValuePairs(line) {
    let masked = line;
    let hasChanges = false;

    // 防御性检查：确保 kvSeparators 是数组
    if (!Array.isArray(this.kvSeparators)) {
      return { masked, hasChanges };
    }

    // 防御性检查：确保 sensitiveKeys 是 Set
    if (!(this.sensitiveKeys instanceof Set)) {
      this.sensitiveKeys = new Set();
    }

    // Create regex pattern for all separators
    const separatorPattern = this.kvSeparators
      .map((sep) => String(sep).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    const kvRegex = new RegExp(
      `(\\b[\\w.-]+)(\\s*(?:${separatorPattern})\\s*)([^\\s\\n\\r]+)`,
      "gi"
    );

    masked = masked.replace(kvRegex, (match, key, separator, value) => {
      if (this.sensitiveKeys.has(key.toLowerCase())) {
        hasChanges = true;
        return `${key}${separator}${this.defaultMask}`;
      }
      return match;
    });

    return { masked, hasChanges };
  }

  /**
   * Mask values that follow sensitive keywords anywhere in the line
   */
  maskSensitiveKeywords(line) {
    let masked = line;
    let hasChanges = false;

    // 防御性检查：确保 sensitiveKeys 是可迭代的
    let keys = [];
    try {
      if (this.sensitiveKeys instanceof Set) {
        keys = Array.from(this.sensitiveKeys);
      } else if (Array.isArray(this.sensitiveKeys)) {
        keys = this.sensitiveKeys;
      } else if (typeof this.sensitiveKeys === 'object' && this.sensitiveKeys !== null) {
        keys = Object.values(this.sensitiveKeys);
      }
    } catch (e) {
      console.warn('Error converting sensitiveKeys to array:', e.message);
      keys = [];
    }

    if (keys.length === 0) {
      return { masked, hasChanges };
    }

    // Look for sensitive keywords followed by separators and values
    try {
      const keywordPattern = keys.join("|");
      // Note: added & to handle URL query parameters like token=abc&password=secret
      const keywordRegex = new RegExp(
        `\\b(?:${keywordPattern})\\b\\s*[:=]\\s*([^\\s\\n\\r,;&]+)`,
        "gi"
      );

      masked = masked.replace(keywordRegex, (match, value) => {
        hasChanges = true;
        return match.replace(value, this.defaultMask);
      });
    } catch (regexError) {
      console.warn('Error in keyword regex:', regexError.message);
    }

    return { masked, hasChanges };
  }

  /**
   * Apply regex patterns to mask specific data types
   */
  maskPatterns(line) {
    let masked = line;
    let hasChanges = false;
    const matches = {};

    // 防御性检查：确保 patterns 是数组
    if (!Array.isArray(this.patterns)) {
      console.warn('scrubber.patterns is not an array:', this.patterns);
      return { masked, hasChanges, matches };
    }

    for (const pattern of this.patterns) {
      // 防御性检查：确保 pattern 和 regex 有效
      if (!pattern || typeof pattern !== 'object') {
        console.warn('Invalid pattern (not object):', pattern);
        continue;
      }

      if (!pattern.regex) {
        console.warn('Invalid pattern (no regex):', pattern.name);
        continue;
      }

      // 如果 maskUrlParams 为 false，跳过 url_with_params 模式（让 URL 保持原样）
      if (pattern.name === 'url_with_params' && !this.maskUrlParams) {
        continue;
      }

      try {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        const matchCount = (masked.match(regex) || []).length;

        if (matchCount > 0) {
          hasChanges = true;
          matches[pattern.name] = matchCount;

          // 防御性检查：确保 replacement 是有效类型
          const replacement = pattern.replacement;

          if (typeof replacement === 'function') {
            masked = masked.replace(regex, replacement);
          } else if (typeof replacement === 'string' || typeof replacement === 'undefined') {
            masked = masked.replace(regex, replacement || this.defaultMask);
          } else {
            console.warn('Invalid replacement type for pattern:', pattern.name, typeof replacement);
            masked = masked.replace(regex, this.defaultMask);
          }
        }
      } catch (regexError) {
        console.warn('Invalid regex pattern:', pattern.name, regexError.message);
      }
    }

    return { masked, hasChanges, matches };
  }

  /**
   * Process a single line through all scrubbing rules
   */
  processLine(line) {
    try {
      this.stats.totalLines++;

      // 如果未启用脱敏，直接返回原始行
      if (this.enableMasking === false) {
        return {
          original: line,
          masked: line,
          hasChanges: false,
          matches: {}
        };
      }

      let result = line;
      let lineHasChanges = false;
      let allMatches = {};

      // Step 0: 尝试解析 JSON 结构化日志
      const jsonResult = this.maskJsonLine(result);
      if (jsonResult.isJson) {
        result = jsonResult.masked;
        lineHasChanges = jsonResult.hasChanges;
      } else {
        // Step 1: Mask key-value pairs (text mode)
        const kvResult = this.maskKeyValuePairs(result);
        result = kvResult.masked;
        lineHasChanges = lineHasChanges || kvResult.hasChanges;

        // Step 2: Mask sensitive keywords
        const keywordResult = this.maskSensitiveKeywords(result);
        result = keywordResult.masked;
        lineHasChanges = lineHasChanges || keywordResult.hasChanges;
      }

      // Step 3: Apply regex patterns (always apply to final result)
      const patternResult = this.maskPatterns(result);
      result = patternResult.masked;
      lineHasChanges = lineHasChanges || patternResult.hasChanges;
      allMatches = patternResult.matches;

      // Update statistics
      if (lineHasChanges) {
        this.stats.maskedLines++;
      }

      // Update pattern match statistics
      for (const [patternName, count] of Object.entries(allMatches)) {
        this.stats.patternMatches[patternName] =
          (this.stats.patternMatches[patternName] || 0) + count;
      }

      return {
        original: line,
        masked: result,
        hasChanges: lineHasChanges,
        matches: allMatches,
      };
    } catch (error) {
      this.stats.errors++;
      console.error(
        `Error processing line ${this.stats.totalLines}: ${error.message}`,
        error.stack
      );
      return {
        original: line,
        masked: this.defaultMask, // fail-closed：整行替换，避免泄露敏感信息
        hasChanges: true,
        error: error.message,
      };
    }
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Generate a summary report
   */
  generateReport() {
    const { totalLines, maskedLines, errors, patternMatches } = this.stats;
    const maskedPercentage =
      totalLines > 0 ? ((maskedLines / totalLines) * 100).toFixed(2) : "0.00";

    let report = `Processing Summary:\n`;
    report += `  Total lines: ${totalLines}\n`;
    report += `  Lines with changes: ${maskedLines} (${maskedPercentage}%)\n`;
    report += `  Errors: ${errors}\n`;

    if (Object.keys(patternMatches).length > 0) {
      report += `  Pattern matches:\n`;
      for (const [pattern, count] of Object.entries(patternMatches)) {
        report += `    ${pattern}: ${count}\n`;
      }
    }

    return report;
  }
}

module.exports = LogScrubber;
