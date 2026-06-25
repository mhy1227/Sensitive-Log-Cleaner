import { describe, it, expect } from "vitest";
import Mod from "../src/core/scrubber.js";

// CJS 模块经 vitest 互操作：default 即类本身
const LogScrubber = Mod.default ?? Mod;

// 每次用全新实例（processLine 只对 stats 有状态）
const scrub = (s) => new LogScrubber().processLine(s);

describe("结构化 PII（应脱敏）", () => {
  it("邮箱", () => expect(scrub("联系 alice@example.com").hasChanges).toBe(true));
  it("中国手机号", () => expect(scrub("电话 13800138000").hasChanges).toBe(true));
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

describe("不应误脱（既有正确行为，防回归）", () => {
  it("UUID 不脱", () =>
    expect(scrub("trace 550e8400-e29b-41d4-a716-446655440000").hasChanges).toBe(false));
});
