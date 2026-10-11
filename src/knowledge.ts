import { CliError } from "./errors.js";
import type { GlobalOptions, ParsedArgs, RequestPlan, RuntimeContext } from "./types.js";
import { buildRequestPlan } from "./http.js";
import {
  assertAllowedFlags,
  boolean,
  compact,
  csv,
  flagMap,
  integer,
  optionalString,
  readContent,
  requireString,
} from "./values.js";

export interface KnowledgeOperation {
  readonly name: string;
  readonly mutation: boolean;
  readonly paginated?: boolean;
  readonly plans: RequestPlan[];
}

const listFlags = ["sort-by", "sort-order", "page-size", "include"] as const;
const articleMetadataFlags = [
  "section",
  "author-id",
  "comments-disabled",
  "content-tag-ids",
  "labels",
  "clear-labels",
  "clear-content-tag-ids",
  "clear-user-segment-ids",
  "permission-group-id",
  "position",
  "promoted",
  "user-segment-id",
  "user-segment-ids",
] as const;

export function buildKnowledgeOperation(
  parsed: ParsedArgs,
  options: GlobalOptions,
  context: RuntimeContext,
): KnowledgeOperation | undefined {
  if (options.data || options.set.length > 0 || options.query.length > 0) {
    throw new CliError("--file and --query are only supported by zendesk api request");
  }
  const [resource, action] = parsed.command;

  if (resource === "locales" && (action === undefined || action === "list")) {
    assertNoPositionals(parsed, 2, "Usage: zendesk locales list");
    assertAllowedFlags(flagMap(parsed.unknownFlags), []);
    return operation("locales list", false, [plan("GET", "/api/v2/help_center/locales", options, context)]);
  }

  if (resource === "categories" && action === "list") return listCategories(parsed, options, context);
  if (resource === "sections" && action === "list") return listSections(parsed, options, context);
  if (resource === "articles" && action === "list") return listArticles(parsed, options, context);
  if (resource === "articles" && action === "search") return searchArticles(parsed, options, context);

  if (resource === "categories") return categoryCommand(action, parsed, options, context);
  if (resource === "sections") return sectionCommand(action, parsed, options, context);
  if (resource === "articles") return articleCommand(action, parsed, options, context);

  return undefined;
}

function listCategories(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  assertNoPositionals(parsed, 2, "Usage: zendesk categories list [--locale en-us] [--all]");
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, listFlags);
  return operation(
    "categories list",
    false,
    [plan("GET", `/api/v2/help_center/${locale(context)}/categories`, options, context, listQuery(flags))],
    true,
  );
}

function listSections(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  assertNoPositionals(parsed, 2, "Usage: zendesk sections list [--category ID] [--locale en-us] [--all]");
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, ["category", ...listFlags]);
  const categoryId = optionalId(flags.get("category"), "category");
  const path = categoryId
    ? `/api/v2/help_center/${locale(context)}/categories/${encodeURIComponent(categoryId)}/sections`
    : `/api/v2/help_center/${locale(context)}/sections`;
  return operation("sections list", false, [plan("GET", path, options, context, listQuery(flags))], true);
}

function listArticles(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  assertNoPositionals(parsed, 2, "Usage: zendesk articles list [--section ID | --category ID] [--all]");
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, ["section", "category", "labels", ...listFlags]);
  const sectionId = optionalId(flags.get("section"), "section");
  const categoryId = optionalId(flags.get("category"), "category");
  if (sectionId && categoryId) throw new CliError("Use either --section or --category, not both");
  const base = `/api/v2/help_center/${locale(context)}`;
  const path = sectionId
    ? `${base}/sections/${encodeURIComponent(sectionId)}/articles`
    : categoryId
      ? `${base}/categories/${encodeURIComponent(categoryId)}/articles`
      : `${base}/articles`;
  const query = listQuery(flags);
  if (flags.has("labels")) query.label_names = csv(flags.get("labels"))?.join(",") ?? "";
  return operation("articles list", false, [plan("GET", path, options, context, query)], true);
}

function searchArticles(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  const searchText = parsed.command.slice(2).join(" ").trim();
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, ["category", "section", "labels", "sort-by", "sort-order", "page-size"]);
  if (!searchText && !flags.has("category") && !flags.has("section") && !flags.has("labels")) {
    throw new CliError('Usage: zendesk articles search "words" [--section ID] [--locale en-us]');
  }
  const query: Record<string, string> = {
    locale: context.locale,
    ...(searchText ? { query: searchText } : {}),
    ...searchQuery(flags),
  };
  return operation(
    "articles search",
    false,
    [plan("GET", "/api/v2/help_center/articles/search", options, context, query)],
    true,
  );
}

function categoryCommand(
  action: string | undefined,
  parsed: ParsedArgs,
  options: GlobalOptions,
  context: RuntimeContext,
): KnowledgeOperation | undefined {
  if (action === "get") {
    const id = positionalId(parsed, 2, `Usage: zendesk categories ${action} <id>`);
    assertAllowedFlags(flagMap(parsed.unknownFlags), ["include"]);
    const include = optionalString(flagMap(parsed.unknownFlags), "include");
    return operation("categories get", false, [plan("GET", `/api/v2/help_center/${locale(context)}/categories/${encodeURIComponent(id)}`, options, context, include ? { include } : {})]);
  }

  if (action === "create") {
    assertNoPositionals(parsed, 2, "Usage: zendesk categories create --name NAME [--description TEXT] --yes");
    const flags = flagMap(parsed.unknownFlags);
    assertAllowedFlags(flags, ["name", "description", "position"]);
    const category = compact({
      name: requireString(flags, "name"),
      description: optionalString(flags, "description"),
      position: integer(flags.get("position"), "position"),
      locale: context.locale,
    });
    return operation("categories create", true, [plan("POST", "/api/v2/help_center/categories", options, context, {}, { category })]);
  }

  if (action === "update") {
    const id = positionalId(parsed, 2, "Usage: zendesk categories update <id> [--name NAME] [--description TEXT] [--position N] --yes");
    const flags = flagMap(parsed.unknownFlags);
    assertAllowedFlags(flags, ["name", "description", "position"]);
    const metadata = compact({ position: integer(flags.get("position"), "position") });
    const translation = compact({
      title: optionalString(flags, "name"),
      body: optionalString(flags, "description"),
    });
    return splitEdit("categories update", "category", id, metadata, translation, options, context);
  }

  if (action === "delete") {
    const id = positionalId(parsed, 2, "Usage: zendesk categories delete <id> --yes");
    assertAllowedFlags(flagMap(parsed.unknownFlags), []);
    return operation("categories delete", true, [plan("DELETE", `/api/v2/help_center/categories/${encodeURIComponent(id)}`, options, context)]);
  }

  return undefined;
}

function sectionCommand(
  action: string | undefined,
  parsed: ParsedArgs,
  options: GlobalOptions,
  context: RuntimeContext,
): KnowledgeOperation | undefined {
  if (action === "get") {
    const id = positionalId(parsed, 2, `Usage: zendesk sections ${action} <id>`);
    assertAllowedFlags(flagMap(parsed.unknownFlags), ["include"]);
    const include = optionalString(flagMap(parsed.unknownFlags), "include");
    return operation("sections get", false, [plan("GET", `/api/v2/help_center/${locale(context)}/sections/${encodeURIComponent(id)}`, options, context, include ? { include } : {})]);
  }

  if (action === "create") {
    assertNoPositionals(parsed, 2, "Usage: zendesk sections create --category ID --name NAME --yes");
    const flags = flagMap(parsed.unknownFlags);
    assertAllowedFlags(flags, ["category", "name", "description", "position", "parent-section-id", "sorting", "theme-template"]);
    const categoryId = requiredId(flags.get("category"), "category");
    const section = compact({
      name: requireString(flags, "name"),
      description: optionalString(flags, "description"),
      position: integer(flags.get("position"), "position"),
      parent_section_id: integer(flags.get("parent-section-id"), "parent-section-id"),
      sorting: optionalString(flags, "sorting"),
      theme_template: optionalString(flags, "theme-template"),
      locale: context.locale,
    });
    return operation("sections create", true, [plan("POST", `/api/v2/help_center/categories/${encodeURIComponent(categoryId)}/sections`, options, context, {}, { section })]);
  }

  if (action === "update") {
    const id = positionalId(parsed, 2, "Usage: zendesk sections update <id> [--name NAME] [--description TEXT] --yes");
    const flags = flagMap(parsed.unknownFlags);
    assertAllowedFlags(flags, ["category", "name", "description", "position", "parent-section-id", "sorting", "theme-template"]);
    const metadata = compact({
      category_id: optionalId(flags.get("category"), "category"),
      position: integer(flags.get("position"), "position"),
      parent_section_id: integer(flags.get("parent-section-id"), "parent-section-id"),
      sorting: optionalString(flags, "sorting"),
      theme_template: optionalString(flags, "theme-template"),
    });
    const translation = compact({
      title: optionalString(flags, "name"),
      body: optionalString(flags, "description"),
    });
    return splitEdit("sections update", "section", id, metadata, translation, options, context);
  }

  if (action === "delete") {
    const id = positionalId(parsed, 2, "Usage: zendesk sections delete <id> --yes");
    assertAllowedFlags(flagMap(parsed.unknownFlags), []);
    return operation("sections delete", true, [plan("DELETE", `/api/v2/help_center/sections/${encodeURIComponent(id)}`, options, context)]);
  }

  return undefined;
}

function articleCommand(
  action: string | undefined,
  parsed: ParsedArgs,
  options: GlobalOptions,
  context: RuntimeContext,
): KnowledgeOperation | undefined {
  if (action === "get") {
    const id = positionalId(parsed, 2, `Usage: zendesk articles ${action} <id>`);
    const flags = flagMap(parsed.unknownFlags);
    assertAllowedFlags(flags, ["include"]);
    const include = optionalString(flags, "include");
    return operation("articles get", false, [plan("GET", `/api/v2/help_center/${locale(context)}/articles/${encodeURIComponent(id)}`, options, context, include ? { include } : {})]);
  }

  if (action === "create") return createArticle(parsed, options, context);
  if (action === "update") return editArticle(parsed, options, context);

  if (action === "publish" || action === "unpublish") {
    const id = positionalId(parsed, 2, `Usage: zendesk articles ${action} <id> --yes`);
    assertAllowedFlags(flagMap(parsed.unknownFlags), []);
    return operation("articles " + action, true, [plan(
      "PUT",
      `/api/v2/help_center/articles/${encodeURIComponent(id)}/translations/${locale(context)}`,
      options,
      context,
      {},
      { translation: { draft: action === "unpublish" } },
      `set ${context.locale} ${action === "publish" ? "published" : "draft"}`,
    )]);
  }

  if (action === "archive") {
    const id = positionalId(parsed, 2, "Usage: zendesk articles archive <id> --yes");
    assertAllowedFlags(flagMap(parsed.unknownFlags), []);
    return operation("articles archive", true, [plan("DELETE", `/api/v2/help_center/articles/${encodeURIComponent(id)}`, options, context)]);
  }

  return undefined;
}

function createArticle(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  assertNoPositionals(parsed, 2, "Usage: zendesk articles create --section ID --title TITLE [--body-file article.html] --yes");
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, ["title", "body-file", "draft", "publish", "notify-subscribers", ...articleMetadataFlags.filter(name => !name.startsWith("clear-"))]);
  const sectionId = requiredId(flags.get("section"), "section");
  const article = compact({
    title: requireString(flags, "title"),
    body: readContent(flags.get("body-file")),
    locale: context.locale,
    draft: publicationState(flags, true),
    ...articleMetadata(flags, { omitSection: true }),
  });
  const notifySubscribers = boolean(flags.get("notify-subscribers"), "notify-subscribers") ?? false;
  return operation("articles create", true, [plan(
    "POST",
    `/api/v2/help_center/sections/${encodeURIComponent(sectionId)}/articles`,
    options,
    context,
    {},
    { article, notify_subscribers: notifySubscribers },
  )]);
}

function editArticle(parsed: ParsedArgs, options: GlobalOptions, context: RuntimeContext): KnowledgeOperation {
  const id = positionalId(parsed, 2, "Usage: zendesk articles update <id> [--title TITLE] [--body-file article.html] --yes");
  const flags = flagMap(parsed.unknownFlags);
  assertAllowedFlags(flags, ["title", "body-file", "draft", "publish", ...articleMetadataFlags]);
  const metadata = articleMetadata(flags);
  const translation = compact({
    title: optionalString(flags, "title"),
    body: readContent(flags.get("body-file")),
    draft: publicationState(flags),
  });
  return splitEdit("articles update", "article", id, metadata, translation, options, context);
}

function articleMetadata(
  flags: ReadonlyMap<string, unknown>,
  options: { omitSection?: boolean } = {},
): Record<string, unknown> {
  if (flags.has("user-segment-id") && flags.has("user-segment-ids")) throw new CliError("--user-segment-id conflicts with --user-segment-ids");
  for (const name of ["labels", "content-tag-ids", "user-segment-ids"]) if (flags.has("clear-" + name) && flags.has(name)) throw new CliError("--clear-" + name + " conflicts with --" + name);
  for (const name of ["clear-labels", "clear-content-tag-ids", "clear-user-segment-ids"]) if (flags.has(name)) boolean(flags.get(name), name);
  const userSegmentId = flags.get("user-segment-id");
  const userSegmentIds = csv(flags.get("user-segment-ids"))?.map((value) => requiredInteger(value, "user-segment-ids"));
  return compact({
    section_id: options.omitSection ? undefined : integer(flags.get("section"), "section"),
    author_id: integer(flags.get("author-id"), "author-id"),
    comments_disabled: boolean(flags.get("comments-disabled"), "comments-disabled"),
    content_tag_ids: flags.get("clear-content-tag-ids") === true ? [] : csv(flags.get("content-tag-ids")),
    label_names: flags.get("clear-labels") === true ? [] : csv(flags.get("labels")),
    permission_group_id: integer(flags.get("permission-group-id"), "permission-group-id"),
    position: integer(flags.get("position"), "position"),
    promoted: boolean(flags.get("promoted"), "promoted"),
    user_segment_id: userSegmentId === "null" || userSegmentId === null ? null : integer(userSegmentId, "user-segment-id"),
    user_segment_ids: flags.get("clear-user-segment-ids") === true ? [] : userSegmentIds,
  });
}

function publicationState(flags: ReadonlyMap<string, unknown>, defaultValue?: boolean): boolean | undefined {
  const draft = boolean(flags.get("draft"), "draft");
  const publish = boolean(flags.get("publish"), "publish");
  if (draft !== undefined && publish !== undefined) throw new CliError("Use either --draft or --publish, not both");
  if (publish !== undefined) return !publish;
  return draft ?? defaultValue;
}

function splitEdit(
  name: string,
  resource: "article" | "category" | "section",
  id: string,
  metadata: Record<string, unknown>,
  translation: Record<string, unknown>,
  options: GlobalOptions,
  context: RuntimeContext,
): KnowledgeOperation {
  const plans: RequestPlan[] = [];
  const resourcePath = resource === "category" ? "categories" : `${resource}s`;
  if (Object.keys(metadata).length > 0) {
    plans.push(plan(
      "PUT",
      `/api/v2/help_center/${resourcePath}/${encodeURIComponent(id)}`,
      options,
      context,
      {},
      { [resource]: metadata },
      `update ${resource} metadata`,
    ));
  }
  if (Object.keys(translation).length > 0) {
    plans.push(plan(
      "PUT",
      `/api/v2/help_center/${resourcePath}/${encodeURIComponent(id)}/translations/${locale(context)}`,
      options,
      context,
      {},
      { translation },
      `update ${context.locale} content`,
    ));
  }
  if (plans.length === 0) throw new CliError(`${name} needs at least one field to change`);
  return operation(name, true, plans);
}

function plan(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: GlobalOptions,
  context: RuntimeContext,
  query: Record<string, string> = {},
  body?: unknown,
  label?: string,
): RequestPlan {
  return buildRequestPlan({ method, path, options, context, query, body, label });
}

function operation(name: string, mutation: boolean, plans: RequestPlan[], paginated = false): KnowledgeOperation {
  return { name, mutation, plans, ...(paginated ? { paginated: true } : {}) };
}

function listQuery(flags: ReadonlyMap<string, unknown>): Record<string, string> {
  return compactStrings({
    sort_by: optionalString(flags, "sort-by"),
    sort_order: optionalString(flags, "sort-order"),
    "page[size]": pageSize(flags),
    include: optionalString(flags, "include"),
  });
}

function searchQuery(flags: ReadonlyMap<string, unknown>): Record<string, string> {
  return compactStrings({
    category: optionalId(flags.get("category"), "category"),
    section: optionalId(flags.get("section"), "section"),
    label_names: csv(flags.get("labels"))?.join(","),
    sort_by: optionalString(flags, "sort-by"),
    sort_order: optionalString(flags, "sort-order"),
    page: 1,
    per_page: pageSize(flags),
  });
}

function compactStrings(value: Record<string, string | number | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, String(child)]));
}

function locale(context: RuntimeContext): string {
  return encodeURIComponent(context.locale);
}

function positionalId(parsed: ParsedArgs, index: number, usage: string): string {
  const value = parsed.command[index];
  if (!value || parsed.command.length !== index + 1) throw new CliError(usage);
  return requiredId(value, "id");
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== "string" && typeof value !== "number") throw new CliError(`Missing required --${name}`);
  const id = String(value);
  if (id.trim() === "" || /[\x00-\x1f]/.test(id)) throw new CliError(`--${name} must be a nonempty identifier`);
  return id;
}

function optionalId(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredId(value, name);
}

function assertNoPositionals(parsed: ParsedArgs, expected: number, usage: string): void {
  if (parsed.command.length !== expected) throw new CliError(usage);
}

function pageSize(flags: ReadonlyMap<string, unknown>): number {
  const size = integer(flags.get("page-size"), "page-size") ?? 100;
  if (size < 1 || size > 100) throw new CliError("--page-size must be between 1 and 100");
  return size;
}

function requiredInteger(value: unknown, name: string): number {
  const result = integer(value, name);
  if (result === undefined) throw new CliError("--" + name + " requires an integer");
  return result;
}
