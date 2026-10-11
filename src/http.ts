import { CliError, statusFailure } from "./errors.js";
import { resolveAuth } from "./auth.js";
import type { GlobalOptions, HttpMethod, RequestPlan, RuntimeContext } from "./types.js";
import { isObject, redact } from "./values.js";

export class ProviderError extends CliError {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode: string | undefined,
    readonly requestId: string | undefined,
    readonly retryable: boolean,
  ) {
    super(message, statusFailure(status).code, statusFailure(status).exitCode, { status, provider_code: providerCode, request_id: requestId, retryable });
  }
}

export function buildRequestPlan(input: {
  method: HttpMethod;
  path: string;
  options: GlobalOptions;
  context: RuntimeContext;
  query?: Record<string, string> | URLSearchParams;
  body?: unknown;
  label?: string;
}): RequestPlan {
  if (!input.path.startsWith("/")) throw new CliError("API paths must start with /");
  const url = new URL(input.path, `${input.context.baseUrl}/`);
  if (url.origin !== new URL(input.context.baseUrl).origin || url.username || url.password || url.hash) throw new CliError("API path must stay on the configured Zendesk origin without credentials or fragment");
  const queryEntries = input.query instanceof URLSearchParams ? input.query.entries() : Object.entries(input.query ?? {});
  for (const [key, value] of queryEntries) url.searchParams.append(key, value);
  const auth = resolveAuth(input.options, input.context);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: auth.authorization,
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";

  return {
    method: input.method,
    timeoutMs: input.options.timeoutMs,
    url: url.toString(),
    auth,
    headers,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.label ? { label: input.label } : {}),
  };
}

export function renderDryRun(plan: RequestPlan): unknown {
  return {
    ...(plan.label ? { operation: plan.label } : {}),
    method: plan.method,
    url: plan.url,
    auth: { kind: plan.auth.kind, source: plan.auth.source },
    headers: redact(plan.headers),
    ...(plan.body === undefined ? {} : { body: redact(plan.body) }),
  };
}

export async function executeRequest(plan: RequestPlan): Promise<unknown> {
  let response: Response;
  try { response = await fetch(plan.url, {
    method: plan.method,
    redirect: "error",
    headers: plan.headers,
    signal: AbortSignal.timeout(plan.timeoutMs ?? 30000),
    ...(plan.body === undefined ? {} : { body: JSON.stringify(plan.body) }),
  }); } catch { throw new CliError("Zendesk request failed or timed out; verify mutation state before retrying", "TRANSIENT_FAILURE", 7, { retryable: plan.method === "GET", outcome_unknown: plan.method !== "GET" }); }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("json") && !contentType.startsWith("text/")) throw new CliError("Binary responses are unsupported", "UNSUPPORTED_RESPONSE", 1);
  let text: string;
  try { text = await response.text(); } catch { throw new CliError("Response transfer failed; verify mutation state before retrying", "TRANSIENT_FAILURE", 7, { retryable: plan.method === "GET", outcome_unknown: plan.method !== "GET" }); }
  const payload = parseResponse(text, contentType);

  if (!response.ok) {
    const requestId = response.headers.get("x-zendesk-request-id") ?? response.headers.get("x-request-id");
    const retryAfter = response.headers.get("retry-after");
    const details = [describeError(payload), requestId ? `request id: ${requestId}` : undefined, retryAfter ? `retry after: ${retryAfter}s` : undefined]
      .filter(Boolean)
      .join("; ");
    const providerCode = isObject(payload) ? (typeof payload.code === "string" ? payload.code : typeof payload.error === "string" ? payload.error : undefined) : undefined;
    throw new ProviderError(
      `Zendesk API ${plan.method} ${new URL(plan.url).pathname} failed (${response.status} ${response.statusText})${details ? `: ${details}` : ""}`,
      response.status,
      providerCode,
      requestId ?? undefined,
      response.status === 429 || response.status >= 500,
    );
  }

  return payload;
}

export async function executeAllPages(plan: RequestPlan, maxItems?: number): Promise<unknown> {
  let current = plan;
  let combined: Record<string, unknown> | undefined;
  let listKey: string | undefined;
  const items: unknown[] = [];
  const visited = new Set<string>();
  let pages = 0;
  while (true) {
    const fetched = withPageLimit(current, maxItems === undefined ? 100 : maxItems - items.length);
    if (visited.has(fetched.url)) throw new CliError("Zendesk pagination repeated a page", "INVALID_RESPONSE", 1);
    visited.add(fetched.url);
    const payload = await executeRequest(fetched);
    pages++;
    if (!isObject(payload)) throw new CliError("Expected paginated object", "INVALID_RESPONSE", 1);
    listKey ??= ["articles", "categories", "sections", "results"].find(key => Array.isArray(payload[key]));
    if (!listKey || !Array.isArray(payload[listKey])) throw new CliError("Expected collection array", "INVALID_RESPONSE", 1);
    const page = payload[listKey] as unknown[];
    const fetchedUrl = new URL(fetched.url);
    const requested = Number(fetchedUrl.searchParams.get("per_page") ?? fetchedUrl.searchParams.get("page[size]"));
    if (page.length > requested) throw new CliError("Provider exceeded requested page size; continuation cannot be guaranteed", "INVALID_RESPONSE", 1);
    items.push(...page);
    combined = { ...payload, [listKey]: items, pages };
    const next = nextPage(payload);
    if (!next || items.length === maxItems) return combined;
    current = resumeRequest(fetched, next);
  }
}
export function resumeRequest(plan: RequestPlan, cursor: string): RequestPlan {
  const url = new URL(cursor, plan.url);
  if (url.origin !== new URL(plan.url).origin || url.username || url.password || url.hash) throw new CliError("Continuation must stay on the configured Zendesk origin");
  return { ...plan, method: "GET", url: url.toString(), body: undefined };
}
function withPageLimit(plan: RequestPlan, remaining: number): RequestPlan {
  if (remaining <= 0) throw new CliError("Pagination bound exhausted without a continuation", "INVALID_RESPONSE", 1);
  const url = new URL(plan.url);
  if (url.searchParams.has("per_page") || url.searchParams.has("page")) {
    const size = Number(url.searchParams.get("per_page") ?? 100);
    const page = Number(url.searchParams.get("page") ?? 1);
    const offset = (page - 1) * size;
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) throw new CliError("Invalid provider pagination parameters", "INVALID_RESPONSE", 1);
    let count = Math.min(size, remaining, 100);
    while (offset % count !== 0) count--;
    url.searchParams.set("per_page", String(count));
    url.searchParams.set("page", String(offset / count + 1));
  } else {
    const size = Number(url.searchParams.get("page[size]") ?? 100);
    url.searchParams.set("page[size]", String(Math.min(size, remaining, 100)));
  }
  return { ...plan, url: url.toString() };
}
function nextPage(payload: Record<string, unknown>): string | undefined {
  if (isObject(payload.meta) && payload.meta.has_more === false) return undefined;
  if (typeof payload.next_page === "string" && payload.next_page) return payload.next_page;
  if (isObject(payload.links) && typeof payload.links.next === "string" && payload.links.next) return payload.links.next;
  return undefined;
}

function parseResponse(text: string, contentType: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (contentType.includes("json")) throw new CliError("Provider returned invalid JSON", "INVALID_RESPONSE", 1);
    return text;
  }
}

function describeError(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload.slice(0, 500);
  if (!isObject(payload)) return undefined;
  const parts = [payload.error, payload.description, payload.message].filter((value): value is string => typeof value === "string");
  if (parts.length > 0) return parts.join(": ");
  return JSON.stringify(payload).slice(0, 500);
}
