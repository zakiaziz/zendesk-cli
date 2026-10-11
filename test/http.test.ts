import { test } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildRequestPlan, executeAllPages, renderDryRun } from "../src/http.js";
import type { GlobalOptions, RuntimeContext } from "../src/types.js";

const options: GlobalOptions = {
  oauthToken: "secret",
  set: [],
  query: [],
  yes: false,
  dryRun: true,
  all: false,
  help: false,
  version: false,
};

test("dry runs redact authorization", () => {
  const context: RuntimeContext = { baseUrl: "https://acme.zendesk.com", locale: "en-us" };
  const request = buildRequestPlan({ method: "PUT", path: "/api/v2/help_center/articles/1", options, context, body: { article: { promoted: true } } });
  assert.deepEqual(renderDryRun(request), {
    method: "PUT",
    url: "https://acme.zendesk.com/api/v2/help_center/articles/1",
    auth: { kind: "oauth", source: "--oauth-token" },
    headers: {
      Accept: "application/json",
      Authorization: "[redacted]",
      "Content-Type": "application/json",
    },
    body: { article: { promoted: true } },
  });
});

test("executeAllPages follows Zendesk next_page links", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    response.end(!new URL(request.url!, origin).searchParams.has("page")
      ? JSON.stringify({ articles: [{ id: 1 }], next_page: `${origin}/articles?page=2`, count: 2 })
      : JSON.stringify({ articles: [{ id: 2 }], next_page: null, count: 2 }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const port = (server.address() as { port: number }).port;
  const context: RuntimeContext = { baseUrl: `http://127.0.0.1:${port}`, locale: "en-us" };
  const request = buildRequestPlan({ method: "GET", path: "/articles", options, context });
  const result = await executeAllPages(request);
  assert.deepEqual(result, { articles: [{ id: 1 }, { id: 2 }], next_page: null, count: 2, pages: 2 });
  server.close();
});

test("executeAllPages rejects pagination cycles", async () => {
  const server = createServer((_request, response) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ articles: [], next_page: `${origin}/articles` }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const port = (server.address() as { port: number }).port;
  const context: RuntimeContext = { baseUrl: `http://127.0.0.1:${port}`, locale: "en-us" };
  const request = buildRequestPlan({ method: "GET", path: "/articles", options, context });
  await assert.rejects(executeAllPages(request), /repeated a page/);
  server.close();
});
