import { test } from "bun:test";
import assert from "node:assert/strict";
import { getGlobalOptions, parseArgs } from "../src/args.js";

test("parseArgs keeps human command fields separate from global options", () => {
  const parsed = parseArgs([
    "articles",
    "update",
    "123",
    "--profile",
    "work",
    "--locale",
    "ja",
    "--title",
    "New title",
    "--draft=false",
    "--dry-run",
  ]);

  assert.deepEqual(parsed.command, ["articles", "update", "123"]);
  assert.equal(getGlobalOptions(parsed).profile, "work");
  assert.equal(getGlobalOptions(parsed).locale, "ja");
  assert.equal(getGlobalOptions(parsed).dryRun, true);
  assert.deepEqual(parsed.unknownFlags, [
    { name: "title", value: "New title" },
    { name: "draft", value: "false" },
  ]);
});

test("parseArgs supports exact query parameters", () => {
  const parsed = parseArgs(["api", "request", "GET", "/api/v2/help_center/articles", "--query", "page[size]=50"]);
  assert.deepEqual(getGlobalOptions(parsed).query, ["page[size]=50"]);
});
