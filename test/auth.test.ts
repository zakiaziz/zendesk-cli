import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolveAuth } from "../src/auth.js";
import type { GlobalOptions, RuntimeContext } from "../src/types.js";

const baseOptions: GlobalOptions = {
  set: [],
  query: [],
  yes: false,
  dryRun: false,
  all: false,
  help: false,
  version: false,
};

const context: RuntimeContext = {
  baseUrl: "https://acme.zendesk.com",
  locale: "en-us",
};

test("OAuth authentication takes precedence", () => {
  const auth = resolveAuth({ ...baseOptions, oauthToken: "oauth-secret", apiToken: "api-secret", email: "agent@example.com" }, context);
  assert.equal(auth.kind, "oauth");
  assert.equal(auth.authorization, "Bearer oauth-secret");
});

test("API token authentication uses email/token as the basic username", () => {
  const auth = resolveAuth({ ...baseOptions, apiToken: "api-secret", email: "agent@example.com" }, context);
  assert.equal(auth.kind, "api-token");
  assert.equal(Buffer.from(auth.authorization.slice("Basic ".length), "base64").toString(), "agent@example.com/token:api-secret");
});

test("explicit API token credentials outrank an OAuth token in the environment", { concurrency: false }, () => {
  const previous = process.env.ZENDESK_OAUTH_TOKEN;
  process.env.ZENDESK_OAUTH_TOKEN = "environment-oauth";
  try {
    const auth = resolveAuth({ ...baseOptions, apiToken: "api-secret", email: "agent@example.com" }, context);
    assert.equal(auth.kind, "api-token");
    assert.equal(auth.source, "command line");
  } finally {
    if (previous === undefined) delete process.env.ZENDESK_OAUTH_TOKEN;
    else process.env.ZENDESK_OAUTH_TOKEN = previous;
  }
});
