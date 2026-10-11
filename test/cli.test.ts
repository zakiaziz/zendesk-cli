import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

test("CLI dry-run makes article edit intent and internal requests obvious", () => {
  const output = execFileSync(process.execPath, [
    cli,
    "articles",
    "update",
    "123",
    "--title",
    "Clear title",
    "--promoted",
    "--base-url",
    "https://acme.zendesk.com",
    "--oauth-token",
    "secret",
    "--dry-run",
  ], { encoding: "utf8" });
  const parsed = JSON.parse(output).data as { command: string; requests: Array<{ operation: string; url: string }> };
  assert.equal(parsed.command, "articles update");
  assert.deepEqual(parsed.requests.map((request) => request.operation), ["update article metadata", "update en-us content"]);
  assert.match(output, /\[redacted\]/);
});

test("CLI requires confirmation for mutations", () => {
  const result = spawnSync(process.execPath, [
    cli,
    "articles",
    "publish",
    "123",
    "--base-url",
    "https://acme.zendesk.com",
    "--oauth-token",
    "secret",
  ], { encoding: "utf8" });
  assert.equal(result.status, 9);
  assert.match(result.stderr, /--dry-run or --yes/);
});

test("help uses knowledge-base language rather than translation commands", () => {
  const output = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(output, /zendesk articles update <id>/);
  assert.doesNotMatch(output, /zendesk translate/);
});

test("raw API shorthand preserves JSON value types", () => {
  const output = execFileSync(process.execPath, [
    cli,
    "api",
    "request",
    "PUT",
    "/api/v2/help_center/articles/123",
    "--file", "test/fixtures/api-body.json",
    "--base-url",
    "https://acme.zendesk.com",
    "--oauth-token",
    "secret",
    "--dry-run",
  ], { encoding: "utf8" });
  const parsed = JSON.parse(output).data as { body: Record<string, unknown> };
  assert.deepEqual(parsed.body, { promoted: true });
});
