import { CliError } from "./core/errors.js";
import type { PageInfo, PagedRequest, PageRequest, Provider, ProviderErrorDetail } from "./core/provider.js";
import { HTTP_METHODS } from "./core/types.js";
import { isRecord, redact, visibleAsciiConstraint } from "./core/values.js";
import { commands, DEFAULT_LOCALE, groups, LOCALE_PATTERN } from "./registry.js";

const MAX_MESSAGE_LENGTH = 300;
const SUBDOMAIN = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const OFFSET = /^(0|[1-9][0-9]{0,14})$/;

export const provider: Provider = {
  bin: "zendesk",
  name: "Zendesk",
  secrets: [
    { key: "email", label: "email", secret: false, validate: emailConstraint },
    { key: "apiToken", label: "API token", validate: visibleAsciiConstraint },
    { key: "oauthToken", label: "OAuth token", validate: visibleAsciiConstraint },
  ],
  credentialSets: [
    { name: "api-token", fields: ["email", "apiToken"] },
    { name: "oauth", fields: ["oauthToken"] },
  ],
  authScheme: "HTTP Basic authentication with the email and API token, or a bearer OAuth token",
  authorize: (credential) => ({
    Authorization:
      credential.oauthToken === undefined
        ? `Basic ${Buffer.from(`${credential.email}/token:${credential.apiToken}`).toString("base64")}`
        : `Bearer ${credential.oauthToken}`,
  }),
  // Zendesk has no shared host, so the subdomain field derives the base URL and an unconfigured endpoint fails.
  baseUrl: { allowPath: false },
  endpointFields: [
    {
      key: "subdomain",
      label: "subdomain",
      example: "acme",
      validate: (value) => (SUBDOMAIN.test(value) ? undefined : "be a Zendesk subdomain of letters, digits, and hyphens, such as acme"),
      baseUrl: (value) => `https://${value}.zendesk.com`,
    },
    {
      key: "defaultLocale",
      label: "default locale",
      placeholder: "LOCALE",
      default: DEFAULT_LOCALE,
      validate: (value) => (LOCALE_PATTERN.test(value) ? undefined : "be a locale such as en-us"),
    },
  ],
  requestIdHeader: "x-request-id",
  errorDetail,
  pagination: { apply: applyPage, read: readPage },
  verify: {
    method: "GET",
    path: "/api/v2/users/me",
    query: [],
    effect:
      "Sends GET /api/v2/users/me. Success proves that Zendesk accepted the credential and identifies the returned user. It does not prove permission for any Help Center resource.",
    identity,
  },
  api: {
    methods: HTTP_METHODS,
    examples: [
      "zendesk api request GET /api/v2/help_center/articles --query per_page=10",
      "zendesk api request PUT /api/v2/help_center/articles/789 --file request.json --dry-run",
    ],
  },
  groups,
  commands,
};

function emailConstraint(value: string): string | undefined {
  return /^[^\s:\u0000-\u001f\u007f]+$/.test(value) ? undefined : "contain no whitespace, colons, or control characters";
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value !== "");
}

function errorDetail(body: unknown): ProviderErrorDetail {
  if (!isRecord(body)) return {};
  const nested = isRecord(body.error) ? body.error : undefined;
  const code = firstString(body.code, nested?.code, body.error, nested?.title);
  const summary = firstString(body.description, nested?.message, body.message, nested?.title, body.error);
  const message = [summary, fieldProblems(body.errors) ?? fieldProblems(body.details)].filter(Boolean).join(": ");
  return {
    ...(message ? { message: message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
    ...(code ? { code: code.slice(0, MAX_MESSAGE_LENGTH) } : {}),
  };
}

/** Reads Zendesk validation failures: a field map of strings, or of objects with a description, or a list of either. */
function fieldProblems(value: unknown): string | undefined {
  const entries: [string | undefined, unknown][] = Array.isArray(value)
    ? value.map((item) => [undefined, item])
    : isRecord(value)
      ? Object.entries(value).flatMap(([field, item]) => (Array.isArray(item) ? item : [item]).map((each): [string, unknown] => [field, each]))
      : [];
  const problems = entries.flatMap(([field, item]) => {
    const text = isRecord(item) ? firstString(item.description, item.detail, item.message, item.title) : firstString(item);
    return text === undefined ? [] : [field === undefined || text.toLowerCase().startsWith(`${field.toLowerCase()}:`) ? text : `${field}: ${text}`];
  });
  return problems.length > 0 ? problems.join("; ") : undefined;
}

function identity(payload: unknown): unknown {
  if (isRecord(payload) && isRecord(payload.user)) return redact(payload.user);
  throw new CliError("INVALID_RESPONSE", 'Zendesk response does not contain a "user" object for auth verify.', {
    hint: "Retry later. If the failure persists, the Zendesk API contract may have changed.",
  });
}

/**
 * Help Center lists use cursor pagination (page[size], page[after]). Article search is the one offset read: its
 * request carries a query parameter, and its cursor is the decimal result offset.
 */
function applyPage({ query }: PagedRequest, page: PageRequest): void {
  if (!query.has("query")) {
    query.set("page[size]", String(page.size));
    if (page.cursor === null) query.delete("page[after]");
    else query.set("page[after]", page.cursor);
    return;
  }
  const offset = page.cursor === null ? 0 : Number(page.cursor);
  let perPage = page.size;
  while (offset % perPage !== 0) perPage -= 1;
  query.set("per_page", String(perPage));
  query.set("page", String(offset / perPage + 1));
}

function readPage(payload: unknown, collectionKey: string | undefined): PageInfo | undefined {
  if (!isRecord(payload)) return undefined;
  return collectionKey === "results" ? readOffsetPage(payload) : readCursorPage(payload);
}

function readCursorPage(payload: Record<string, unknown>): PageInfo | undefined {
  const { meta } = payload;
  if (!isRecord(meta) || typeof meta.has_more !== "boolean") return undefined;
  if (!meta.has_more) return { nextCursor: null };
  return typeof meta.after_cursor === "string" && meta.after_cursor !== "" ? { nextCursor: meta.after_cursor } : undefined;
}

function readOffsetPage(payload: Record<string, unknown>): PageInfo | undefined {
  const count = typeof payload.count === "number" ? { provider: { count: payload.count } } : {};
  const next = payload.next_page;
  if (typeof next !== "string" || next === "") return { nextCursor: null, ...count };
  const offset = nextOffset(next);
  return offset === undefined ? undefined : { nextCursor: offset, ...count };
}

function nextOffset(nextPage: string): string | undefined {
  let params: URLSearchParams;
  try {
    params = new URL(nextPage).searchParams;
  } catch {
    return undefined;
  }
  const pageText = params.get("page") ?? "";
  const perPageText = params.get("per_page") ?? "";
  if (!OFFSET.test(pageText) || !OFFSET.test(perPageText)) return undefined;
  const page = Number(pageText);
  const perPage = Number(perPageText);
  const offset = (page - 1) * perPage;
  return page >= 1 && perPage >= 1 && Number.isSafeInteger(offset) ? String(offset) : undefined;
}
