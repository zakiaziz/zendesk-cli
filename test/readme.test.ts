import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"), "utf8");

test("README documents every first-class knowledge command", () => {
  for (const command of [
    "locales list",
    "categories list",
    "categories get <id>",
    "categories create",
    "categories update <id>",
    "categories delete <id>",
    "sections list",
    "sections get <id>",
    "sections create",
    "sections update <id>",
    "sections delete <id>",
    "articles list",
    "articles search [words]",
    "articles get <id>",
    "articles create",
    "articles update <id>",
    "articles publish <id>",
    "articles unpublish <id>",
    "articles archive <id>",
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(`zendesk ${command}`)), `missing zendesk ${command}`);
  }
});

test("README documents every article field", () => {
  for (const option of [
    "--title",
    "--body-file",
    "--section",
    "--draft",
    "--publish",
    "--author-id",
    "--comments-disabled",
    "--content-tag-ids",
    "--labels",
    "--permission-group-id",
    "--position",
    "--promoted",
    "--user-segment-id",
    "--user-segment-ids",
    "--notify-subscribers",
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(option)), `missing ${option}`);
  }
});

test("README documents every built-in command", () => {
  for (const command of [
    "setup",
    "profiles list",
    "profiles get <name>",
    "profiles create <name>",
    "profiles update <name>",
    "profiles delete <name>",
    "profiles use <name>",
    "config path",
    "config list",
    "config get <key>",
    "config set <key> <value>",
    "config unset <key>",
    "auth verify",
    "completions bash",
    "completions zsh",
    "api request",
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(`zendesk ${command}`)), `missing zendesk ${command}`);
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
