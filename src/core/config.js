/**
 * Configuration for log scrubbing rules and patterns
 */

// Sensitive key patterns (case-insensitive)
const SENSITIVE_KEYS = [
  // 密码相关
  'password', 'passwd', 'pwd', 'pass', 'passphrase',

  // 令牌相关
  'token', 'access_token', 'refresh_token', 'auth_token', 'api_token', 'bearer_token',
  'authorization', 'auth', 'bearer', 'oauth', 'jwt',

  // 会话相关
  'cookie', 'session', 'sessionid', 'jsessionid', 'csrf_token', 'xsrf_token',

  // 密钥相关
  'secret', 'key', 'private_key', 'public_key', 'api_key', 'app_key', 'app_secret',
  'client_secret', 'consumer_secret', 'encryption_key', 'decrypt_key',

  // 凭据相关
  'credential', 'credentials', 'cred', 'cert', 'certificate',
  'signature', 'sign', 'hash', 'salt',

  // 验证相关
  'pin', 'code', 'otp', 'captcha', 'verification_code', 'verify_code',

  // 数据库相关
  'db_password', 'database_password', 'mysql_password', 'redis_password',
  'connection_string', 'dsn',

  // 支付相关
  'cvv', 'cvc', 'security_code', 'card_number', 'account_number',
  'bank_account', 'payment_method'
];

// Regex patterns for different types of sensitive data
const PATTERNS = [
  {
    name: 'chinese_phone',
    description: 'Chinese mobile phone numbers',
    regex: /\b(1[3-9]\d)(\d{4})(\d{4})\b/g,
    replacement: '$1****$3',
    enabled: true, // 默认启用
    category: 'personal' // 个人信息
  },
  {
    name: 'email',
    description: 'Email addresses',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '***@***.***',
    enabled: true, // 默认启用
    category: 'personal'
  },
  {
    name: 'chinese_id_card',
    description: 'Chinese ID card numbers (18 digits)',
    regex: /\b(\d{3})\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    replacement: '$1***************',
    enabled: true, // 默认启用
    category: 'personal'
  },
  {
    name: 'bank_card',
    description: 'Bank card numbers (12-19 digits)',
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4,7}\b/g,
    replacement: '****-****-****-****',
    enabled: false, // 默认禁用，避免误匹配SQL中的数字
    category: 'financial'
  },
  {
    name: 'jwt_token',
    description: 'JWT tokens',
    regex: /\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    replacement: 'eyJ***.***.***.***',
    enabled: true, // 默认启用
    category: 'security'
  },
  {
    name: 'ipv4_address',
    description: 'IPv4 addresses (可能影响日志分析)',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: '***.***.***.***',
    enabled: false, // 默认禁用
    category: 'network'
  },
  {
    name: 'url_with_params',
    description: 'URLs with query parameters',
    regex: /https?:\/\/[^\s]+[?&]([^=\s]+=[^&\s]+)/g,
    replacement: (match) => {
      const [baseUrl] = match.split('?');
      return `${baseUrl}?***=***`;
    },
    enabled: false, // 默认禁用，避免影响日志分析
    category: 'network'
  },
  {
    name: 'numeric_ids',
    description: '数字ID (可能影响业务分析)',
    regex: /\b\d{4,}\b/g,
    replacement: '***',
    enabled: false, // 默认禁用，因为可能影响日志分析
    category: 'business'
  },
  {
    name: 'timestamps',
    description: '时间戳 (可能影响时序分析)',
    regex: /\b\d{2}:\d{2}:\d{2}\b/g,
    replacement: '**:**:**',
    enabled: false, // 默认禁用
    category: 'temporal'
  },

  // === 新增的敏感信息类型 ===

  // 个人标识符
  {
    name: 'chinese_name',
    description: '中文姓名 (2-4个中文字符)',
    regex: /(?:姓名|用户名|真实姓名|name)[:=]\s*([\u4e00-\u9fa5]{2,4})/gi,
    replacement: (match, name) => match.replace(name, '***'),
    enabled: false,
    category: 'personal'
  },
  {
    name: 'license_plate',
    description: '车牌号',
    regex: /\b[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{4,5}[A-Z0-9挂学警港澳]\b/g,
    replacement: '***A12345',
    enabled: false, // 默认禁用
    category: 'personal'
  },
  {
    name: 'passport_number',
    description: '护照号码',
    regex: /\b[A-Z]{1,2}\d{7,9}\b/g,
    replacement: 'G********',
    enabled: false, // 默认禁用，避免误匹配
    category: 'personal'
  },

  // 设备标识
  {
    name: 'mac_address',
    description: 'MAC地址',
    regex: /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g,
    replacement: '**:**:**:**:**:**',
    enabled: false, // 默认禁用，避免误匹配
    category: 'device'
  },
  {
    name: 'imei',
    description: 'IMEI设备号',
    regex: /\b\d{15}\b/g,
    replacement: '***************',
    enabled: false,
    category: 'device'
  },
  {
    name: 'uuid',
    description: 'UUID (可能包含敏感信息)',
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '********-****-****-****-************',
    enabled: false,
    category: 'system'
  },

  // 金融信息
  {
    name: 'cvv_code',
    description: 'CVV安全码',
    regex: /\bcvv[:=]\s*\d{3,4}\b/gi,
    replacement: 'cvv=***',
    enabled: false, // 默认禁用
    category: 'financial'
  },
  {
    name: 'amount',
    description: '金额 (大额交易)',
    regex: /(?:金额|amount|price|总价)[:=]\s*[¥$€£]?([1-9]\d{4,}(?:\.\d{2})?)/gi,
    replacement: (match, amount) => match.replace(amount, '*****.00'),
    enabled: false,
    category: 'financial'
  },

  // 位置信息
  {
    name: 'gps_coordinates',
    description: 'GPS坐标',
    regex: /\b\d{1,3}\.\d{4,}[,，]\s*\d{1,3}\.\d{4,}\b/g,
    replacement: '***.****,***.****',
    enabled: false,
    category: 'location'
  },
  {
    name: 'address',
    description: '详细地址',
    regex: /(?:地址|住址|address)[:=]\s*([\u4e00-\u9fa5\w\s]{10,})/gi,
    replacement: (match, addr) => match.replace(addr, '***详细地址***'),
    enabled: false,
    category: 'location'
  },

  // 编码数据
  {
    name: 'base64_data',
    description: 'Base64编码数据 (可能包含敏感信息)',
    regex: /\b[A-Za-z0-9+/]{20,}={0,2}\b/g,
    replacement: 'base64EncodedData***',
    enabled: true, // 启用以脱敏SQL参数中的Base64数据
    category: 'encoded'
  },
  {
    name: 'sql_parameter_masking',
    description: 'SQL参数位置脱敏 (根据字段名匹配参数位置)',
    regex: /^(==> Parameters: )(.+)$/gm,
    replacement: (match, prefix, params) => {
      // 这个规则需要在scrubber.js中实现特殊逻辑
      return match; // 暂时返回原值，实际逻辑在scrubber中处理
    },
    enabled: false, // 暂时禁用，需要实现特殊逻辑
    category: 'sql'
  },
  {
    name: 'hex_key',
    description: '十六进制密钥 (32位以上)',
    regex: /\b[0-9a-fA-F]{32,}\b/g,
    replacement: 'hexKey***',
    enabled: false,
    category: 'encoded'
  },

  // 系统安全
  {
    name: 'file_path',
    description: '文件路径 (可能包含用户名)',
    regex: /[C-Z]:\\(?:Users|用户)\\[^\s\\]+/gi,
    replacement: 'C:\\Users\\***',
    enabled: false,
    category: 'system'
  },
  {
    name: 'database_connection',
    description: '数据库连接字符串',
    regex: /(jdbc|mongodb|redis|mysql):\/\/[^\s;]+/gi,
    replacement: '$1://***:***@***:****/***',
    enabled: false, // 默认禁用，避免影响SQL日志分析
    category: 'system'
  },

  // 国际化标识
  {
    name: 'international_phone',
    description: '国际手机号',
    regex: /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g,
    replacement: '+***-***-***-***',
    enabled: false, // 默认禁用，避免误匹配
    category: 'personal'
  },
  {
    name: 'ssn',
    description: '美国社保号',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '***-**-****',
    enabled: false,
    category: 'personal'
  },

  // === 补充的敏感信息类型 ===

  // 更多个人标识
  {
    name: 'driver_license',
    description: '驾照号码',
    regex: /(?:驾照|驾驶证|license)[:=]\s*([A-Z0-9]{10,20})/gi,
    replacement: (match, license) => match.replace(license, '***'),
    enabled: false,
    category: 'personal'
  },
  {
    name: 'student_id',
    description: '学号/工号',
    regex: /(?:学号|工号|员工号|student_id|employee_id)[:=]\s*([A-Z0-9]{6,15})/gi,
    replacement: (match, id) => match.replace(id, '***'),
    enabled: false,
    category: 'personal'
  },
  {
    name: 'medical_id',
    description: '医保卡号/社保号',
    regex: /(?:医保|社保|保险|medical|insurance)[:=]\s*([0-9]{10,20})/gi,
    replacement: (match, id) => match.replace(id, '***'),
    enabled: false,
    category: 'personal'
  },

  // 生物特征和健康信息
  {
    name: 'biometric_hash',
    description: '生物特征哈希值',
    regex: /(?:fingerprint|face_id|biometric|生物特征)[:=]\s*([a-f0-9]{32,})/gi,
    replacement: (match, hash) => match.replace(hash, 'bioHash***'),
    enabled: false, // 默认禁用
    category: 'personal'
  },
  {
    name: 'health_info',
    description: '健康医疗信息',
    regex: /(?:病历|诊断|症状|medication|diagnosis)[:=]\s*([\u4e00-\u9fa5\w\s]{5,})/gi,
    replacement: (match, info) => match.replace(info, '***医疗信息***'),
    enabled: false,
    category: 'personal'
  },

  // 更多金融信息
  {
    name: 'iban',
    description: '国际银行账号(IBAN)',
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,
    replacement: 'GB**ABCD***********',
    enabled: false, // 默认禁用，避免误匹配
    category: 'financial'
  },
  {
    name: 'swift_code',
    description: 'SWIFT代码',
    regex: /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g,
    replacement: 'ABCD***',
    enabled: false,
    category: 'financial'
  },
  {
    name: 'crypto_address',
    description: '加密货币地址',
    regex: /\b(1|3|bc1)[A-Za-z0-9]{25,62}\b|\b0x[a-fA-F0-9]{40}\b/g,
    replacement: 'crypto***',
    enabled: false,
    category: 'financial'
  },

  // 更多设备信息
  {
    name: 'serial_number',
    description: '设备序列号',
    regex: /(?:serial|序列号|sn)[:=]\s*([A-Z0-9]{8,20})/gi,
    replacement: (match, sn) => match.replace(sn, 'SN***'),
    enabled: false,
    category: 'device'
  },
  {
    name: 'device_fingerprint',
    description: '设备指纹',
    regex: /(?:device_id|fingerprint|设备指纹)[:=]\s*([a-f0-9]{16,})/gi,
    replacement: (match, fp) => match.replace(fp, 'deviceFP***'),
    enabled: false, // 默认禁用
    category: 'device'
  },

  // 网络和通信
  {
    name: 'wifi_password',
    description: 'WiFi密码',
    regex: /(?:wifi|wlan|wireless).*(?:password|pwd|pass)[:=]\s*([^\s]{6,})/gi,
    replacement: (match, pwd) => match.replace(pwd, '***'),
    enabled: false, // 默认禁用
    category: 'network'
  },
  {
    name: 'domain_credentials',
    description: '域名凭据',
    regex: /(https?:\/\/)[^:]+:[^@]+@/gi,
    replacement: '$1***:***@',
    enabled: false, // 默认禁用，避免影响日志分析
    category: 'network'
  },

  // 业务敏感信息
  {
    name: 'order_number',
    description: '订单号 (可能敏感)',
    regex: /(?:订单|order)[:=]\s*([A-Z0-9]{10,})/gi,
    replacement: (match, order) => match.replace(order, 'ORDER***'),
    enabled: false,
    category: 'business'
  },
  {
    name: 'transaction_id',
    description: '交易流水号',
    regex: /(?:交易|transaction|流水)[:=]\s*([A-Z0-9]{12,})/gi,
    replacement: (match, txn) => match.replace(txn, 'TXN***'),
    enabled: false,
    category: 'business'
  },
  {
    name: 'merchant_id',
    description: '商户号',
    regex: /(?:商户|merchant)[:=]\s*([0-9]{8,})/gi,
    replacement: (match, mid) => match.replace(mid, 'MERCHANT***'),
    enabled: false,
    category: 'business'
  },

  // 系统和安全
  {
    name: 'windows_path',
    description: 'Windows用户路径',
    regex: /[C-Z]:\\(?:Users|用户)\\[^\s\\]+/gi,
    replacement: 'C:\\Users\\***',
    enabled: false,
    category: 'system'
  },
  {
    name: 'linux_path',
    description: 'Linux用户路径',
    regex: /\/home\/[^\s\/\\]+/g,
    replacement: '/home/***',
    enabled: false,
    category: 'system'
  },
  {
    name: 'api_endpoint',
    description: 'API端点 (可能包含敏感路径)',
    regex: /(https?:\/\/[^\/]+)(\/api\/v\d+\/[^\s?]+)/gi,
    replacement: '$1/api/v*/***',
    enabled: false,
    category: 'system'
  },

  // 社交和通信
  {
    name: 'qq_number',
    description: 'QQ号码',
    regex: /\bqq[:=]?\s*([1-9][0-9]{4,10})\b/gi,
    replacement: (match, qq) => match.replace(qq, '***'),
    enabled: false, // 默认禁用，避免误匹配数字
    category: 'personal'
  },
  {
    name: 'wechat_id',
    description: '微信号',
    regex: /(?:微信|wechat|wx)[:=]\s*([a-zA-Z][a-zA-Z0-9_-]{5,19})/gi,
    replacement: (match, wx) => match.replace(wx, 'wx***'),
    enabled: false, // 默认禁用
    category: 'personal'
  },

  // 教育和工作
  {
    name: 'education_record',
    description: '教育记录',
    regex: /(?:学校|大学|university|school)[:=]\s*([\u4e00-\u9fa5\w\s]{4,})/gi,
    replacement: (match, school) => match.replace(school, '***学校***'),
    enabled: false,
    category: 'personal'
  },
  {
    name: 'company_info',
    description: '公司信息',
    regex: /(?:公司|employer|company)[:=]\s*([\u4e00-\u9fa5\w\s]{4,})/gi,
    replacement: (match, company) => match.replace(company, '***公司***'),
    enabled: false,
    category: 'personal'
  }
];

// Key-value separators
const KV_SEPARATORS = ['=', ':', '=>', '->'];

// Default replacement text
const DEFAULT_MASK = '***';

// File processing options
const DEFAULT_OPTIONS = {
  outputSuffix: '.masked.log',
  encoding: 'utf8',
  highWaterMark: 64 * 1024, // 64KB buffer
  preserveLineEndings: true,
  skipBinaryFiles: true,
  maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB limit
  concurrency: 4, // Max concurrent file processing
  enableMasking: true, // 是否启用脱敏，false 则保留原始日志用于分析
  maskUrlParams: true // 是否脱敏 URL 参数，false 则保留 URL 路径和参数名但脱敏参数值
};

module.exports = {
  SENSITIVE_KEYS,
  PATTERNS,
  KV_SEPARATORS,
  DEFAULT_MASK,
  DEFAULT_OPTIONS
};