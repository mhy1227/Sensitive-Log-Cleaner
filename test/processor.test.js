import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import iconv from "iconv-lite";
import Mod from "../src/core/processor.js";

const FileProcessor = Mod.default ?? Mod;

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pf-proc-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const noTmpLeft = () => readdirSync(dir).filter((x) => x.includes(".tmp.")).length === 0;

describe("processFile 基本", () => {
  it("脱敏文件、原子写出、返回统计", async () => {
    const inP = join(dir, "a.log");
    writeFileSync(inP, "email a@b.com\ntoken=secret123abc\nplain ok\n", "utf8");
    const p = new FileProcessor();
    const r = await p.processFile(inP);

    expect(r.success).toBe(true);
    expect(r.cancelled).toBe(false);
    expect(r.outputPath).toBe(join(dir, "a.masked.log"));
    const out = readFileSync(r.outputPath, "utf8");
    expect(out).toContain("***@***.***");
    expect(out).toContain("token=***");
    expect(out).toContain("plain ok");
    expect(r.stats.totalLines).toBe(3);
    expect(r.stats.maskedLines).toBe(2);
    expect(noTmpLeft()).toBe(true);
  });

  it("空文件", async () => {
    const inP = join(dir, "empty.log");
    writeFileSync(inP, "", "utf8");
    const r = await new FileProcessor().processFile(inP);
    expect(r.success).toBe(true);
    expect(r.stats.totalLines).toBe(0);
  });
});

describe("processFile 编码", () => {
  it("gbk 往返", async () => {
    const inP = join(dir, "gbk.log");
    writeFileSync(inP, iconv.encode("用户 a@b.com\n密码=secret123\n", "gbk"));
    const r = await new FileProcessor({ encoding: "gbk" }).processFile(inP);
    expect(r.success).toBe(true);
    const out = iconv.decode(readFileSync(r.outputPath), "gbk");
    expect(out).toContain("***@***.***");
    expect(out).toContain("密码=***");
  });
});

describe("processFile 校验/错误", () => {
  it("二进制文件被跳过", async () => {
    const inP = join(dir, "bin.log");
    writeFileSync(inP, Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02, 0x68, 0x69]));
    const r = await new FileProcessor().processFile(inP);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binary|二进制/i);
  });

  it("输入文件不存在", async () => {
    const r = await new FileProcessor().processFile(join(dir, "nope.log"));
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(noTmpLeft()).toBe(true);
  });
});

describe("processFile 中止", () => {
  it("预先 abort 的 signal → cancelled", async () => {
    const inP = join(dir, "ab.log");
    writeFileSync(inP, "x\n".repeat(100), "utf8");
    const ac = new AbortController();
    ac.abort();
    const r = await new FileProcessor().processFile(inP, null, { signal: ac.signal });
    expect(r.cancelled).toBe(true);
    expect(noTmpLeft()).toBe(true);
  });

  it("处理中途 abort 不挂起（回归：背压期间 abort）", async () => {
    const inP = join(dir, "big.log");
    // ~2MB，含敏感内容，制造写入背压
    writeFileSync(inP, ("token=secret123abc&x=1 ".repeat(40) + "\n").repeat(2000), "utf8");
    const ac = new AbortController();
    const p = new FileProcessor({ highWaterMark: 16 });
    const promise = p.processFile(inP, null, { signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    const r = await promise; // 若 drain 期间 abort 挂起，这里会超时失败
    expect(r.cancelled || r.success).toBe(true);
    expect(noTmpLeft()).toBe(true);
  }, 8000);
});
