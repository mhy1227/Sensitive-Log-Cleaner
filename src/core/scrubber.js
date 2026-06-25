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
   * Mask the token in an Authorization header: Authorization: <scheme> <token>.
   * 把 scheme+token 整体掩码。必须在 maskKeyValuePairs 之前调用——否则 KV 会先把 value
   * 取到第一个空格、只掩掉 scheme(Bearer/Basic)，真正的 token 漏脱（尤其无数字的 Basic
   * base64 不会被 base64 规则兜住，直接泄露）。
   */
  maskAuthHeaders(line) {
    let masked = line;
    let hasChanges = false;
    const authRegex = /(\b(?:proxy-)?authorization\b["']?\s*[:=]\s*["']?)((?:bearer|basic|digest|token|ntlm|hmac)\s+[^\s;,&"']+|[^\s;,&"']+)/gi;
    masked = masked.replace(authRegex, (m, prefix) => {
      hasChanges = true;
      return prefix + this.defaultMask;
    });
    return { masked, hasChanges };
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

    // value 排除 , ; & —— 否则 token=abc&other=keep 会把 &other=keep 一起吞掉打码
    // （静默删数据，比漏报更糟）。与 maskSensitiveKeywords 的 value 取值口径保持一致。
    const kvRegex = new RegExp(
      `(\\b[\\w.-]+)(\\s*(?:${separatorPattern})\\s*)([^\\s\\n\\r,;&]+)`,
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

    // Look for sensitive keywords followed by separators and values.
    // ASCII 关键词用 \b 词边界（避免 monkey 命中 key）；CJK 关键词（密码/密钥…）无 ASCII
    // 词边界，单独成支不带 \b。分隔符含半角 : = 与全角 ：；value 同时排除全角标点。
    try {
      const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const asciiKeys = keys.filter((k) => /^[\x00-\x7F]+$/.test(k)).map(esc);
      const cjkKeys = keys.filter((k) => !/^[\x00-\x7F]+$/.test(k)).map(esc);

      const alts = [];
      if (asciiKeys.length) alts.push(`\\b(?:${asciiKeys.join("|")})\\b`);
      if (cjkKeys.length) alts.push(`(?:${cjkKeys.join("|")})`);
      if (alts.length === 0) return { masked, hasChanges };

      // group1 = 关键词+(可选引号)+分隔符+(可选引号)（保留），group2 = 值（替换为掩码）。
      // 容忍 key/value 两侧引号，覆盖带前缀的 JSON 日志（2026 INFO {"password":"x"}）
      // 与引号 KV（"token":"x"）——否则这类极常见的结构化日志会整条漏脱。
      // value 同时排除引号，避免把闭合引号吃进掩码。
      const keywordRegex = new RegExp(
        `((?:${alts.join("|")})["']?\\s*[:=：]\\s*["']?)([^\\s\\n\\r,;&，。；"']+)`,
        "gi"
      );

      masked = masked.replace(keywordRegex, (match, prefix) => {
        hasChanges = true;
        return prefix + this.defaultMask;
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
        // Step 1a: Authorization 头特例（必须在 KV 之前，否则 KV 只掩 scheme、token 漏脱）
        const authResult = this.maskAuthHeaders(result);
        result = authResult.masked;
        lineHasChanges = lineHasChanges || authResult.hasChanges;

        // Step 1b: Mask key-value pairs (text mode)
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
