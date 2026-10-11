import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/args.js";
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "zendesk-standards-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });
async function run(args: string[], url?: string, content?: string, authenticated = true) {
  const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { PATH: process.env.PATH, XDG_CONFIG_HOME: home, CI: "1", ...(authenticated ? { ZENDESK_OAUTH_TOKEN: "fake-token", ZENDESK_BASE_URL: url ?? "http://127.0.0.1:1" } : {}) },
    stdin: content === undefined ? "ignore" : new Blob([content]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exit };
}
test("strict booleans, spelling, and bounded timeout prevent accidental confirmation", async () => {
  for (const flag of ["--yes=garbage", "-quiet", "--q", "---help"]) expect(() => parseArgs(["articles", "archive", "123", flag])).toThrow();
  expect((await run(["profiles", "list", "--timeout", "9999999999999999999999s"])).exit).toBe(2);
});
test("invalid commands and missing IDs fail before configuration", async () => {
  for (const args of [["articles", "get"], ["categories", "nonsense"], ["nope"]]) expect((await run(args, undefined, undefined, false)).exit).toBe(2);
});
test("raw requests reject cross-origin URL and irrelevant flags before HTTP", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return Response.json({}); } });
  try {
    for (const args of [["api", "request", "GET", "//other.invalid/x"], ["api", "request", "GET", "/api/x", "--file", "ignored.json"], ["api", "request", "GET", "/api/x", "--yes"], ["articles", "list", "--yes"]]) expect((await run(args, server.url.toString())).exit).toBe(2);
    expect(calls).toBe(0);
  } finally { server.stop(true); }
});
test("raw request preserves duplicate literal query values and provider output", async () => {
  let query: string[] = [];
  const server = Bun.serve({ port: 0, fetch(request) { query = new URL(request.url).searchParams.getAll("id"); return Response.json({ custom: [1, 2] }); } });
  try {
    const result = await run(["api", "request", "GET", "/api/x", "--query", "id=001", "--query", "id=002"], server.url.toString());
    expect(result.exit).toBe(0); expect(query).toEqual(["001", "002"]); expect(JSON.parse(result.stdout)).toEqual({ custom: [1, 2] });
  } finally { server.stop(true); }
});
test("stdin JSON and article content are read literally before confirmation", async () => {
  const raw = await run(["api", "request", "POST", "/api/x", "--file", "-", "--dry-run"], undefined, '{"x":1}');
  expect(raw.exit).toBe(0); expect(JSON.parse(raw.stdout).data.body).toEqual({ x: 1 });
  const article = await run(["articles", "update", "123", "--body-file", "-", "--dry-run"], undefined, "@literal\n<p>123 true</p>");
  expect(article.exit).toBe(0); expect(JSON.parse(article.stdout).data.body.translation.body).toBe("@literal\n<p>123 true</p>");
  expect((await run(["api", "request", "POST", "/api/x", "--file", "-"], undefined, "{")).exit).toBe(2);
});
test("pretty ANSI coloring preserves JSON values exactly", async () => {
  const result = await run(["articles", "update", "123", "--title", "123 true null", "--dry-run", "--format", "pretty", "--color", "always"]);
  expect(result.exit).toBe(0);
  const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, "");
  expect(JSON.parse(plain).data.body.translation.title).toBe("123 true null");
  expect(result.stdout).toContain("\x1b[");
});
test("config get returns key/value and local unknown options reject", async () => {
  expect((await run(["config", "set", "defaultLocale", "en-us"])).exit).toBe(0);
  expect(JSON.parse((await run(["config", "get", "defaultLocale"])).stdout).data).toEqual({ key: "defaultLocale", value: "en-us" });
  expect((await run(["config", "list", "--typo"])).exit).toBe(2);
  expect((await run(["config", "set", "__proto__.x", "1"])).exit).toBe(2);
});
test("partial multi-request failure preserves completed responses and provider details", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return calls === 1 ? Response.json({ article: { id: "123" } }) : Response.json({ error: "Forbidden", description: "translation denied" }, { status: 403, headers: { "x-request-id": "req-2" } }); } });
  try {
    const result = await run(["articles", "update", "123", "--position", "2", "--title", "Updated", "--yes"], server.url.toString());
    expect(result.exit).toBe(8); expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr).error;
    expect(error.code).toBe("PARTIAL_FAILURE"); expect(error.completed[0].result.article.id).toBe("123");
    expect(error.failed.status).toBe(403); expect(error.failed.request_id).toBe("req-2"); expect(error.total).toBe(2);
  } finally { server.stop(true); }
});
test("cursor pagination bound preserves the next unread item", async () => {
  const server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url); const start = Number(url.searchParams.get("page[after]") ?? 0);
    const size = Number(url.searchParams.get("page[size]") ?? 100); const end = Math.min(5, start + size);
    const next = new URL(url); next.searchParams.set("page[after]", String(end));
    return Response.json({ articles: Array.from({ length: end - start }, (_, n) => ({ id: String(start + n) })), meta: { has_more: end < 5 }, links: { next: end < 5 ? next.toString() : null } });
  } });
  try {
    const first = await run(["articles", "list", "--page-size", "2", "--all", "--max-items", "3"], server.url.toString());
    expect(first.exit).toBe(0); const a = JSON.parse(first.stdout); expect(a.data.map((x: {id: string}) => x.id)).toEqual(["0", "1", "2"]); expect(a.meta.has_more).toBe(true);
    const resume = await run(["articles", "list", "--cursor", a.meta.next_cursor, "--all"], server.url.toString());
    expect(resume.exit).toBe(0); const b = JSON.parse(resume.stdout); expect(b.data.map((x: {id: string}) => x.id)).toEqual(["3", "4"]); expect(b.meta.has_more).toBe(false);
  } finally { server.stop(true); }
});
test("offset search pagination adjusts page number when page size changes", async () => {
  const server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url); const size = Number(url.searchParams.get("per_page") ?? 100); const page = Number(url.searchParams.get("page") ?? 1);
    const start = (page - 1) * size; const end = Math.min(start + size, 5); const next = new URL(url); next.searchParams.set("page", String(page + 1));
    return Response.json({ results: Array.from({ length: end - start }, (_, n) => ({ id: String(start + n) })), next_page: end < 5 ? next.toString() : null });
  } });
  try {
    const first = await run(["articles", "search", "words", "--page-size", "2", "--all", "--max-items", "3"], server.url.toString());
    expect(first.exit).toBe(0); const a = JSON.parse(first.stdout); expect(a.data.map((x: {id: string}) => x.id)).toEqual(["0", "1", "2"]);
    const second = await run(["articles", "search", "words", "--cursor", a.meta.next_cursor, "--all"], server.url.toString());
    expect(second.exit).toBe(0); expect(JSON.parse(second.stdout).data.map((x: {id: string}) => x.id)).toEqual(["3", "4"]);
  } finally { server.stop(true); }
});
test("resumed search rejects different positional search text before a request", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return Response.json({ results: [] }); } });
  try {
    const cursor = new URL("/api/v2/help_center/articles/search?query=original&page=2", server.url).toString();
    const result = await run(["articles", "search", "different", "--cursor", cursor, "--all"], server.url.toString());
    expect(result.exit).toBe(2);
    expect(JSON.parse(result.stderr).error.message).toContain("does not match the cursor query");
    expect(calls).toBe(0);
  } finally { server.stop(true); }
});
test("help accepts identifiers and get does not advertise mutation fields", async () => {
  const result = await run(["articles", "get", "123", "--help"], undefined, undefined, false);
  expect(result.exit).toBe(0); expect(result.stdout).toContain("Options:"); expect(result.stdout).not.toContain("--title");
});
test("missing singleton and request failure have distinct exit codes", async () => {
  const server = Bun.serve({ port: 0, fetch() { return Response.json({ article: null }); } });
  try { expect((await run(["articles", "get", "123"], server.url.toString())).exit).toBe(5); } finally { server.stop(true); }
  expect((await run(["articles", "get", "123"])).exit).toBe(7);
});
