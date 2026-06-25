import { describe, it, expect } from "vitest";
import Mod from "../src/core/scrubber.js";
import CfgMod from "../src/core/config.js";

// CJS 模块经 vitest 互操作：default 即模块导出
const LogScrubber = Mod.default ?? Mod;
const { PATTERNS } = CfgMod.default ?? CfgMod;

// 每次用全新实例（processLine 只对 stats 有状态）
const scrub = (s) => new LogScrubber().processLine(s);

// 按名字启用指定规则后处理（用于测默认禁用的规则）
const scrubWith = (enabledNames, s) =>
  new LogScrubber({
    patterns: PATTERNS.map((p) => ({ ...p, enabled: enabledNames.includes(p.name) })),
  }).processLine(s);

describe("结构化 PII（应脱敏）", () => {
  it("邮箱", () => expect(scrub("联系 alice@example.com").hasChanges).toBe(true));
  it("中国手机号", () => expect(scrub("电话 13800138000").masked).toBe("电话 138****8000"));
  it("带 +86 前缀的手机号（回归：曾因 \\b 漏脱）", () =>
    expect(scrub("tel +8613800138000 end").masked).toBe("tel +86138****8000 end"));
  it("带 86- 前缀", () => expect(scrub("86-13800138000").hasChanges).toBe(true));
  it("更长数字串不误吃手机号片段", () =>
    expect(scrub("id 1380013800099 done").hasChanges).toBe(false));
  it("18 位身份证（回归：曾因正则要求 21 位而永远漏脱）", () =>
    expect(scrub("身份证 11010519491231002X").hasChanges).toBe(true));
  it("身份证带 x 校验位", () =>
    expect(scrub("44030619900307721x").hasChanges).toBe(true));
});

describe("JWT", () => {
  it("真 JWT（eyJ 开头三段）应脱敏", () =>
    expect(scrub("auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.sigabc123def").hasChanges).toBe(true));
  it("点号文件名不应误脱（app.module.js）", () =>
    expect(scrub("加载模块 app.module.js 完成").hasChanges).toBe(false));
  it("版本号不应误脱（1.2.3）", () =>
    expect(scrub("升级到 1.2.3").hasChanges).toBe(false));
  it("三段域名不应误脱（a.b.c）", () =>
    expect(scrub("请求 a.b.c 服务").hasChanges).toBe(false));
});

describe("base64（启用，但应避免误伤）", () => {
  it("真 base64（混合大小写+数字）应脱敏", () =>
    expect(scrub("data aB3xK9pLmN2qR7sT5vW1zYQ==").hasChanges).toBe(true));
  it("git SHA(32 hex,纯小写) 不应误脱", () =>
    expect(scrub("commit 9f86d081884c7d659a2feaa0c55ad015").hasChanges).toBe(false));
  it("git SHA(40 hex) 不应误脱", () =>
    expect(scrub("rev 9f86d081884c7d659a2feaa0c55ad015b1b8a3e6").hasChanges).toBe(false));
  it("普通长单词(纯小写字母) 不应误脱", () =>
    expect(scrub("词 abcdefghijklmnopqrstuvwxyz 结束").hasChanges).toBe(false));
});

describe("敏感键名（应脱敏）", () => {
  it("password=值", () => expect(scrub("password=s3cr3tP@ssw0rd").hasChanges).toBe(true));
  it("token: 值", () => expect(scrub("token: aB3xK9pLmN2qR7sT").hasChanges).toBe(true));
});

describe("KV 吞参（回归：只脱敏感值，不得吞掉相邻参数/日志）", () => {
  it("多参不吞：token=x&other=keep&id=42", () => {
    const out = scrub("token=abc123&other=keepme&id=42").masked;
    expect(out).toBe("token=***&other=keepme&id=42");
  });
  it("URL query 不吞：?token=x&page=2", () => {
    const out = scrub("GET /cb?token=abc123&page=2 HTTP/1.1").masked;
    expect(out).toBe("GET /cb?token=***&page=2 HTTP/1.1");
  });
  it("逗号分隔不吞：token=x,foo=bar", () => {
    const out = scrub("token=abc123,foo=bar").masked;
    expect(out).toBe("token=***,foo=bar");
  });
  it("非敏感 KV 原样", () => {
    expect(scrub("status=200 method=GET").hasChanges).toBe(false);
  });
});

describe("不应误脱（既有正确行为，防回归）", () => {
  it("UUID 不脱", () =>
    expect(scrub("trace 550e8400-e29b-41d4-a716-446655440000").hasChanges).toBe(false));
});

describe("中文键名 / 全角冒号（回归：中文日志场景的漏报）", () => {
  it("中文键名 + 全角冒号：密码：secret123", () =>
    expect(scrub("密码：secret123").masked).toBe("密码：***"));
  it("中文键名 + 半角等号：密钥=abcdef123456", () =>
    expect(scrub("密钥=abcdef123456").masked).toBe("密钥=***"));
  it("英文键 + 全角冒号：password：secret", () =>
    expect(scrub("password：secret").hasChanges).toBe(true));
  it("令牌：xxx", () => expect(scrub("令牌：tk_abc123def").hasChanges).toBe(true));

  // 误报守卫
  it("自然语言不误脱：密码是什么（无赋值分隔符）", () =>
    expect(scrub("用户问 密码是什么 呢").hasChanges).toBe(false));
  it("ASCII 子串守卫：monkey: banana（key 在 monkey 内不应命中）", () =>
    expect(scrub("monkey: banana").hasChanges).toBe(false));
});

describe("高置信度服务密钥（回归：此前完全漏脱）", () => {
  it("AWS Access Key", () =>
    expect(scrub("aws AKIAIOSFODNN7EXAMPLE done").masked).toBe("aws AKIA**************** done"));
  it("GitHub token", () =>
    expect(scrub("gh ghp_1234567890abcdefghijklmnopqrstuvwxyzAB x").hasChanges).toBe(true));
  it("OpenAI key", () =>
    expect(scrub("sk-proj-abcdefghijklmnopqrstuvwxyz1234").hasChanges).toBe(true));
  it("Slack token", () => expect(scrub("xoxb-123456789012-abcdefABCDEF").hasChanges).toBe(true));
  it("Google API key", () =>
    expect(scrub("AIzaSyA1234567890abcdefghijklmnopqrstuv").hasChanges).toBe(true));
  it("PEM 私钥块", () =>
    expect(scrub("-----BEGIN RSA PRIVATE KEY-----").hasChanges).toBe(true));

  // 误报守卫：普通文本不应命中这些前缀规则
  it("普通含 sk- 词不误脱（task-...）", () =>
    expect(scrub("task-management-board-component").hasChanges).toBe(false));
  it("普通大写串不误脱", () =>
    expect(scrub("STATUS REPORT GENERATED OK").hasChanges).toBe(false));
});

describe("无分隔符键名变体（回归：apikey 等漏脱）", () => {
  it("apikey 多参不漏", () => {
    const out = scrub("/cb?token=SECRETtk&apikey=SECRETak&password=SECRETpw&page=2").masked;
    expect(out).not.toContain("SECRETak");
    expect(out).toContain("page=2");
  });
  it("accesstoken=", () => expect(scrub("accesstoken=SECRETat").hasChanges).toBe(true));
  it("secretkey=", () => expect(scrub("secretkey=SECRETsk").hasChanges).toBe(true));
});

describe("过宽关键词误报（回归：code/hash/sign 误掩常见日志词）", () => {
  it("HTTP 状态码不掩", () => expect(scrub("HTTP status code: 200").hasChanges).toBe(false));
  it("错误码不掩", () => expect(scrub("error code: 500 timeout").hasChanges).toBe(false));
  it("退出码不掩", () => expect(scrub("process exit code: 0").hasChanges).toBe(false));
  it("file hash 标签不掩", () => expect(scrub("file hash: verifying now").hasChanges).toBe(false));
  it("sign in 文案不掩", () => expect(scrub("sign: please review").hasChanges).toBe(false));
  it("auth 状态不掩", () => expect(scrub("auth: success").hasChanges).toBe(false));
  it("test pass 不掩", () => expect(scrub("test pass: 5 of 5").hasChanges).toBe(false));
  it("cert 状态不掩", () => expect(scrub("cert: valid until 2027").hasChanges).toBe(false));
  it("salt 文案不掩", () => expect(scrub("salt: added to recipe").hasChanges).toBe(false));
  // 真敏感仍脱（专用键覆盖）
  it("certificate= 仍脱", () => expect(scrub("certificate=SECRETcert").hasChanges).toBe(true));
  it("authtoken= 仍脱", () => expect(scrub("authtoken=SECRETauth").hasChanges).toBe(true));
  it("Authorization 头仍脱", () =>
    expect(scrub("Authorization: Bearer SECRETtok").masked).toBe("Authorization: ***"));

  // 真敏感仍脱（确保没误删）
  it("X-API-Key 头仍脱", () => expect(scrub("X-API-Key: SECRETkey456").hasChanges).toBe(true));
  it("X-Auth-Token 头仍脱", () => expect(scrub("X-Auth-Token: SECRETtok").hasChanges).toBe(true));
  it("password 仍脱", () => expect(scrub("password=SECRETpw").hasChanges).toBe(true));
  it("otp 仍脱", () => expect(scrub("otp: 123456").hasChanges).toBe(true));
});

describe("Authorization 头（回归：只掩 scheme、token 泄露）", () => {
  it("Bearer token 整体掩码", () =>
    expect(scrub("Authorization: Bearer abc123XYZsecrettoken456").masked).toBe(
      "Authorization: ***",
    ));
  it("Basic 凭据（无数字 base64）不再泄露", () => {
    const out = scrub("authorization=Basic dXNlcjpwYXNz").masked;
    expect(out).toBe("authorization=***");
    expect(out).not.toContain("dXNlcjpwYXNz");
  });
  it("无 scheme 的 authorization 值也掩码", () =>
    expect(scrub("Authorization: rawtoken123").masked).toBe("Authorization: ***"));
});

describe("带前缀/引号的结构化日志（回归：极常见的整条漏脱）", () => {
  it("时间前缀 JSON：2026-06-25 INFO {\"password\":\"x\"}", () => {
    const r = scrub('2026-06-25 INFO {"password":"secret123"}');
    expect(r.hasChanges).toBe(true);
    expect(r.masked).toBe('2026-06-25 INFO {"password":"***"}');
  });
  it("级别前缀 JSON：[ERROR] {\"token\":\"x\"}", () =>
    expect(scrub('[ERROR] {"token":"abc123def"}').hasChanges).toBe(true));
  it("文本中的引号 KV：\"password\":\"x\"", () => {
    const r = scrub('msg "password":"secret123" end');
    expect(r.masked).toBe('msg "password":"***" end');
  });
  it("纯 JSON 仍正常（不回归）", () =>
    expect(scrub('{"password":"secret123"}').masked).toBe('{"password":"***"}'));

  // 误报守卫仍生效
  it("monkey: banana 仍不误脱", () =>
    expect(scrub("monkey: banana").hasChanges).toBe(false));
  it("密码是什么 仍不误脱", () =>
    expect(scrub("用户问 密码是什么 呢").hasChanges).toBe(false));
});

describe("默认禁用规则的正则正确性（防 license_plate 式静默漏报）", () => {
  it("license_plate 启用后应匹配 京A12345（回归：原 \\b 导致永不匹配）", () =>
    expect(scrubWith(["license_plate"], "车牌 京A12345 已登记").hasChanges).toBe(true));
  it("license_plate 兼容中文后缀（京A1234学）", () =>
    expect(scrubWith(["license_plate"], "教练车 京A1234学 年检").hasChanges).toBe(true));
});
