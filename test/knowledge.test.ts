import { test } from "bun:test";
import assert from "node:assert/strict";
import { getGlobalOptions, parseArgs } from "../src/args.js";
import { buildKnowledgeOperation } from "../src/knowledge.js";
import type { RuntimeContext } from "../src/types.js";

const context: RuntimeContext = {
  baseUrl: "https://acme.zendesk.com",
  locale: "en-us",
};

function build(argv: string[]) {
  const parsed = parseArgs([...argv, "--oauth-token", "secret"]);
  const options = getGlobalOptions(parsed);
  const result = buildKnowledgeOperation(parsed, options, context);
  assert.ok(result);
  return result;
}

test("article edit hides Zendesk translation routing and splits metadata from content", () => {
  const operation = build([
    "articles",
    "update",
    "123",
    "--title",
    "Reset your password",
    "--labels",
    "account",
    "--labels",
    "security",
    "--position",
    "4",
  ]);

  assert.equal(operation.name, "articles update");
  assert.equal(operation.plans.length, 2);
  assert.equal(operation.plans[0]?.url, "https://acme.zendesk.com/api/v2/help_center/articles/123");
  assert.deepEqual(operation.plans[0]?.body, {
    article: { label_names: ["account", "security"], position: 4 },
  });
  assert.equal(operation.plans[1]?.url, "https://acme.zendesk.com/api/v2/help_center/articles/123/translations/en-us");
  assert.deepEqual(operation.plans[1]?.body, {
    translation: { title: "Reset your password" },
  });
});

test("article create is a draft unless publishing is explicit", () => {
  const draft = build(["articles", "create", "--section", "42", "--title", "New article"]);
  assert.deepEqual(draft.plans[0]?.body, {
    article: { title: "New article", locale: "en-us", draft: true },
    notify_subscribers: false,
  });

  const published = build(["articles", "create", "--section", "42", "--title", "New article", "--publish"]);
  assert.deepEqual(published.plans[0]?.body, {
    article: { title: "New article", locale: "en-us", draft: false },
    notify_subscribers: false,
  });
});

test("category edit presents name and description while using translation fields internally", () => {
  const operation = build(["categories", "update", "77", "--name", "Billing", "--description", "Payment help"]);
  assert.equal(operation.plans.length, 1);
  assert.equal(operation.plans[0]?.url, "https://acme.zendesk.com/api/v2/help_center/categories/77/translations/en-us");
  assert.deepEqual(operation.plans[0]?.body, { translation: { title: "Billing", body: "Payment help" } });
});

test("article list scopes by section and uses the selected locale", () => {
  const operation = build(["articles", "list", "--section", "42", "--sort-by", "updated_at"]);
  assert.equal(operation.plans[0]?.url, "https://acme.zendesk.com/api/v2/help_center/en-us/sections/42/articles?sort_by=updated_at&page%5Bsize%5D=100");
  assert.equal(operation.paginated, true);
});

test("article edit rejects an empty change", () => {
  assert.throws(() => build(["articles", "update", "123"]), /needs at least one field/);
});

test("article edit rejects conflicting publication options", () => {
  assert.throws(() => build(["articles", "update", "123", "--draft", "--publish"]), /either --draft or --publish/);
});

test("content fields reject a missing value", () => {
  assert.throws(() => build(["articles", "update", "123", "--body-file"]), /--body-file requires/);
  assert.throws(() => build(["categories", "update", "123", "--description"]), /--description requires/);
});

test("first-class commands reject raw API-only flags", () => {
  assert.throws(() => build(["articles", "list", "--file", "{}"]), /only supported by zendesk api request/);
});
