import { readFileSync } from "node:fs";
import { CliError, usageError } from "./core/errors.js";
import type { Endpoint } from "./core/access.js";
import type { RequestSpec, ResourceCommand } from "./core/provider.js";
import type { ArgumentSpec, Context, GroupSpec, OptionSpec, PaginationSpec } from "./core/registry.js";
import { invalidValue, isRecord, missingFields, validateId } from "./core/values.js";

const HELP_CENTER = "/api/v2/help_center";
export const DEFAULT_LOCALE = "en-us";
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PAGE_MAX = 100;
const SEARCH_RESULT_CAP = 1000;

const BY_POSITION: PaginationSpec = {
  max: PAGE_MAX,
  default: PAGE_MAX,
  ordering: "Ordered by position unless --sort-by is set.",
};

// Sideloads Zendesk documents for each list and get endpoint (Help Center API, "Sideloads"). Translations are embedded in
// each record. Every other relation arrives as an array beside the collection.
const ARTICLE_INCLUDES = ["users", "sections", "categories", "translations"];
const SECTION_INCLUDES = ["categories", "translations"];
const CATEGORY_INCLUDES = ["translations"];

/** The relations that arrive as an array beside the collection, which a list moves into meta.provider. */
function arrays(includes: readonly string[]): string[] {
  return includes.filter((relation) => relation !== "translations");
}

const ARTICLE_ORDER: PaginationSpec = {
  max: PAGE_MAX,
  default: PAGE_MAX,
  ordering: "Ordered by Zendesk unless --sort-by is set: the default is position, and a section can define its own article order.",
};

export const groups: GroupSpec[] = [
  {
    path: ["articles"],
    summary: "List, search, get, create, update, archive, and publish articles.",
    title: "Manage Help Center articles.",
  },
  { path: ["categories"], summary: "List, get, create, update, and delete categories.", title: "Manage Help Center categories." },
  { path: ["locales"], summary: "List enabled Help Center locales.", title: "Inspect Help Center locales." },
  { path: ["sections"], summary: "List, get, create, update, and delete sections.", title: "Manage Help Center sections." },
];

// Options

const LOCALE: OptionSpec = {
  name: "locale",
  placeholder: "LOCALE",
  type: "string",
  description: "Locale of the content. Default: the default locale of the profile, en-us unless it sets one.",
  check: checkLocale,
};

function localeOption(scope: string): OptionSpec {
  return { ...LOCALE, description: `Locale of the localized content. Applies only to ${scope}.` };
}

const SORT_ORDER: OptionSpec = {
  name: "sort-order",
  placeholder: "ORDER",
  type: "enum",
  choices: ["asc", "desc"],
  description: "Sort direction.",
};

const BODY_FILE: OptionSpec = {
  name: "body-file",
  placeholder: "PATH",
  type: "path",
  description: "Read the HTML body from PATH. - reads stdin. An empty file sets an empty body.",
};

/** Zendesk side-loads related records through a comma-separated include query parameter. */
function includeOption(choices: string[]): OptionSpec {
  return {
    name: "include",
    placeholder: "RELATION",
    type: "enum",
    choices,
    repeatable: true,
    description: "Side-load a related record into the response. Repeat to side-load several.",
  };
}

function includeQuery(context: Context): [string, string | undefined] {
  const relations = context.options.strings("include");
  return ["include", relations.length > 0 ? relations.join(",") : undefined];
}

function getQuery(context: Context): [string, string][] {
  const [name, value] = includeQuery(context);
  return value === undefined ? [] : [[name, value]];
}

function labelOption(description: string): OptionSpec {
  return { name: "label", placeholder: "NAME", type: "string", repeatable: true, description, check: checkLabel };
}

function sortBy(choices: string[]): OptionSpec {
  return { name: "sort-by", placeholder: "FIELD", type: "enum", choices, description: "Sort field." };
}

function idOption(name: string, description: string): OptionSpec {
  return { name, placeholder: "ID", type: "string", description, check: (value) => validateId(`--${name}`, value) };
}

function numberIdOption(name: string, description: string): OptionSpec {
  return { name, placeholder: "ID", type: "integer", min: 1, description: `${description} Positive integer.` };
}

function textOption(name: string, description: string): OptionSpec {
  return { name, placeholder: "TEXT", type: "string", description };
}

function positionOption(description: string): OptionSpec {
  return { name: "position", placeholder: "N", type: "integer", min: 0, description: `${description} Nonnegative integer.` };
}

function booleanOption(name: string, description: string): OptionSpec {
  return { name, placeholder: "BOOLEAN", type: "enum", choices: ["true", "false"], description };
}

function clearOption(name: string, field: string, description: string): OptionSpec {
  return { name, type: "boolean", conflicts: [field], description };
}

function required(option: OptionSpec): OptionSpec {
  return { ...option, required: true };
}

// Validation

function checkLocale(value: string): string {
  if (LOCALE_PATTERN.test(value)) return value;
  throw invalidValue("--locale", "be a locale such as en-us", value, "Use --locale en-us.");
}

function checkLabel(value: string): string {
  if (!value.includes(",")) return value;
  throw invalidValue("--label", "not contain a comma", value, "Repeat --label once for each label.");
}

function checkSegmentId(value: string): string {
  if (/^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value))) return value;
  throw invalidValue("--user-segment-id", "be a positive integer ID", value, "Use --user-segment-id 123.", ">=1");
}

function checkSearchText(value: string): string {
  if (value.trim() !== "") return value;
  throw invalidValue("QUERY", "not be blank", value, "Pass the words to search for.");
}

function checkOffset(value: string | undefined): void {
  if (value === undefined || /^(0|[1-9][0-9]{0,14})$/.test(value)) return;
  throw invalidValue(
    "--cursor",
    'be a decimal result offset for "articles search"',
    value,
    "Use meta.next_cursor from the previous response.",
  );
}

function idArgument(name: string, description: string): ArgumentSpec {
  return { name, description, check: (value) => validateId(name, value) };
}

const ARTICLE_ID = idArgument("ARTICLE_ID", "Article ID.");
const CATEGORY_ID = idArgument("CATEGORY_ID", "Category ID.");
const SECTION_ID = idArgument("SECTION_ID", "Section ID.");

// Request helpers

function locale(context: Context, endpoint: Endpoint): string {
  return context.options.string("locale") ?? endpoint.require("defaultLocale");
}

function localePath(context: Context, endpoint: Endpoint): string {
  return `${HELP_CENTER}/${encodeURIComponent(locale(context, endpoint))}`;
}

function encodedId(context: Context): string {
  return encodeURIComponent(context.args[0] ?? "");
}

function present(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function triState(context: Context, name: string): boolean | undefined {
  const value = context.options.string(name);
  return value === undefined ? undefined : value === "true";
}

function replacement<T>(context: Context, values: T[], clear: string): T[] | undefined {
  if (context.options.flag(clear)) return [];
  return values.length > 0 ? values : undefined;
}

function listQuery(context: Context, extra: [string, string | undefined][] = []): [string, string][] {
  const entries: [string, string | undefined][] = [
    ["sort_by", context.options.string("sort-by")],
    ["sort_order", context.options.string("sort-order")],
    ...extra,
  ];
  return entries.filter((entry): entry is [string, string] => entry[1] !== undefined);
}

function labelQuery(context: Context): [string, string | undefined] {
  const labels = context.options.strings("label");
  return ["label_names", labels.length > 0 ? labels.join(",") : undefined];
}

function bodyText(context: Context): string | undefined {
  const path = context.options.string("body-file");
  if (path === undefined) return undefined;
  try {
    return readFileSync(path === "-" ? 0 : path, "utf8");
  } catch {
    throw invalidValue(
      "--body-file",
      "name a readable file, or be - for stdin",
      path,
      "Check that the path exists and is readable, or use - for stdin.",
    );
  }
}

function flagList(names: string[]): string {
  return names.map((name) => `--${name}`).join(", ");
}

interface UpdateTarget {
  kind: "article" | "category" | "section";
  path: string;
  contentFields: string[];
  metadataFields: string[];
  content(): Record<string, unknown>;
  metadata(): Record<string, unknown>;
}

/**
 * Zendesk keeps metadata and localized content behind separate endpoints, and the shared request builder sends one
 * request per command, so one update carries either content fields or metadata fields.
 */
function updateRequest(context: Context, endpoint: Endpoint, target: UpdateTarget): RequestSpec {
  const command = context.spec.path.join(" ");
  const content = target.contentFields.filter((name) => context.options.has(name));
  const metadata = target.metadataFields.filter((name) => context.options.has(name));
  if (content.length === 0 && metadata.length === 0) {
    throw missingFields(command, [...target.contentFields, ...target.metadataFields], true);
  }
  if (content.length > 0 && metadata.length > 0) {
    throw usageError(
      `"${command}" sends one request, so ${flagList(content)} cannot be combined with ${flagList(metadata)}.`,
      "Run the command once for the localized content and once for the metadata.",
    );
  }
  if (metadata.length > 0 && context.options.has("locale")) {
    throw usageError(
      `--locale cannot be used when "${command}" changes only metadata.`,
      `Drop --locale, or change localized content with ${flagList(target.contentFields)}.`,
    );
  }
  const id = context.args[0] ?? "";
  const base = `${HELP_CENTER}/${target.path}/${encodedId(context)}`;
  if (content.length > 0) {
    return {
      path: `${base}/translations/${encodeURIComponent(locale(context, endpoint))}`,
      body: { translation: target.content() },
      effect: `Updates the ${locale(context, endpoint)} content of ${target.kind} ${id} (${flagList(content)}).`,
    };
  }
  return {
    path: base,
    body: { [target.kind]: target.metadata() },
    effect: `Updates the metadata of ${target.kind} ${id} (${flagList(metadata)}).`,
  };
}

// Articles

const ARTICLE_CONTENT_FIELDS = ["title", "body-file"];
const ARTICLE_METADATA_FIELDS = [
  "section-id",
  "author-id",
  "comments-disabled",
  "content-tag-id",
  "clear-content-tag-id",
  "label",
  "clear-label",
  "permission-group-id",
  "position",
  "promoted",
  "user-segment-id",
  "clear-user-segment-id",
];

function contentTagOption(description: string): OptionSpec {
  return {
    name: "content-tag-id",
    placeholder: "ID",
    type: "string",
    repeatable: true,
    description,
    check: (value) => validateId("--content-tag-id", value),
  };
}

function userSegmentOption(description: string): OptionSpec {
  return {
    name: "user-segment-id",
    placeholder: "ID",
    type: "string",
    repeatable: true,
    description: `${description} Positive integer.`,
    check: checkSegmentId,
  };
}

function articleFieldOptions(creating: boolean): OptionSpec[] {
  return [
    creating ? required(textOption("title", "Article title.")) : textOption("title", "Article title."),
    BODY_FILE,
    creating
      ? required(idOption("section-id", "Section that receives the article."))
      : numberIdOption("section-id", "Move the article to this section."),
    numberIdOption("author-id", "Article author."),
    booleanOption("comments-disabled", "Disable or enable comments."),
    contentTagOption(creating ? "Content tag ID." : "Replace all content tags with these IDs."),
    ...(creating ? [] : [clearOption("clear-content-tag-id", "content-tag-id", "Remove every content tag.")]),
    labelOption(creating ? "Article label name." : "Replace all labels with these names."),
    ...(creating ? [] : [clearOption("clear-label", "label", "Remove every label.")]),
    numberIdOption("permission-group-id", "Management permission group."),
    positionOption("Position within the section."),
    booleanOption("promoted", "Promote or unpromote the article."),
    userSegmentOption(creating ? "User segment that can view the article." : "Replace the user segments that can view the article with these IDs."),
    ...(creating ? [] : [clearOption("clear-user-segment-id", "user-segment-id", "Remove every user segment restriction.")]),
    creating ? LOCALE : localeOption("--title and --body-file"),
  ];
}

function articleMetadata(context: Context, creating: boolean): Record<string, unknown> {
  const { options } = context;
  return present({
    section_id: creating ? undefined : options.number("section-id"),
    author_id: options.number("author-id"),
    comments_disabled: triState(context, "comments-disabled"),
    content_tag_ids: replacement(context, options.strings("content-tag-id"), "clear-content-tag-id"),
    label_names: replacement(context, options.strings("label"), "clear-label"),
    permission_group_id: options.number("permission-group-id"),
    position: options.number("position"),
    promoted: triState(context, "promoted"),
    user_segment_ids: replacement(context, options.strings("user-segment-id").map(Number), "clear-user-segment-id"),
  });
}

const articleCommands: ResourceCommand[] = [
  {
    path: ["articles", "list"],
    summary: "List articles.",
    arguments: [],
    options: [
      idOption("section-id", "List only articles in this section."),
      { ...idOption("category-id", "List only articles in this category."), conflicts: ["section-id"] },
      labelOption("Article label name."),
      sortBy(["position", "title", "created_at", "updated_at", "edited_at"]),
      SORT_ORDER,
      includeOption(ARTICLE_INCLUDES),
      LOCALE,
    ],
    effects: { kind: "read" },
    output:
      "Collection envelope. data is an array of articles; meta holds profile, next_cursor, and has_more. With --include users, sections, or categories, meta.provider holds each side-loaded array under its relation name, merged across --all pages without repeats. Translations are embedded in each article.",
    method: "GET",
    collectionKey: "articles",
    providerMeta: arrays(ARTICLE_INCLUDES),
    pagination: ARTICLE_ORDER,
    examples: [
      "zendesk articles list --section-id 456",
      "zendesk articles list --label account --all --format json",
      "zendesk articles list --include users --include sections",
    ],
    request: (context, endpoint) => {
      const section = context.options.string("section-id");
      const category = context.options.string("category-id");
      const scope = section
        ? `sections/${encodeURIComponent(section)}/`
        : category
          ? `categories/${encodeURIComponent(category)}/`
          : "";
      return {
        path: `${localePath(context, endpoint)}/${scope}articles`,
        query: listQuery(context, [labelQuery(context), includeQuery(context)]),
      };
    },
  },
  {
    path: ["articles", "get"],
    summary: "Get one article.",
    arguments: [ARTICLE_ID],
    options: [includeOption(ARTICLE_INCLUDES), LOCALE],
    effects: { kind: "read" },
    output:
      "Resource envelope. data is the article object. With --include users, sections, or categories, meta.provider holds each side-loaded array under its relation name. Translations are embedded in the article. meta has profile.",
    method: "GET",
    resourceKey: "article",
    providerMeta: arrays(ARTICLE_INCLUDES),
    emptyIsNotFound: true,
    examples: ["zendesk articles get 789", "zendesk articles get 789 --locale ja --format json", "zendesk articles get 789 --include users --include translations"],
    request: (context, endpoint) => ({
      path: `${localePath(context, endpoint)}/articles/${encodedId(context)}`,
      query: getQuery(context),
    }),
  },
  {
    path: ["articles", "search"],
    summary: "Search articles.",
    arguments: [{ name: "QUERY", description: "Search text.", check: checkSearchText }],
    options: [
      idOption("section-id", "Search only this section."),
      idOption("category-id", "Search only this category."),
      labelOption("Article label name."),
      sortBy(["created_at", "updated_at"]),
      SORT_ORDER,
      LOCALE,
    ],
    effects: { kind: "read" },
    output:
      "Collection envelope. data is an array of search results; meta holds profile, next_cursor, has_more, and provider.count, the total number of matches. A query that matches more than 1000 results returns only the first 1000, so narrow the query.",
    method: "GET",
    collectionKey: "results",
    pagination: {
      max: PAGE_MAX,
      default: PAGE_MAX,
      ordering: `Ordered by relevance unless --sort-by is set. --cursor is a decimal result offset. Zendesk returns at most ${SEARCH_RESULT_CAP} search results.`,
    },
    examples: ['zendesk articles search "reset password"', 'zendesk articles search "billing" --section-id 456 --all --max-items 50'],
    request: (context, endpoint) => {
      checkOffset(context.options.string("cursor"));
      return {
        path: `${HELP_CENTER}/articles/search`,
        query: listQuery(context, [
          ["query", context.args[0]],
          ["locale", locale(context, endpoint)],
          ["category", context.options.string("category-id")],
          ["section", context.options.string("section-id")],
          labelQuery(context),
        ]),
      };
    },
  },
  {
    path: ["articles", "create"],
    summary: "Create an article.",
    arguments: [],
    options: [
      ...articleFieldOptions(true),
      { name: "publish", type: "boolean", description: "Publish the article instead of saving a draft." },
      { name: "notify-subscribers", type: "boolean", description: "Notify subscribers when the article is created." },
    ],
    effects: { kind: "remote-mutation", summary: "Creates an article in the section. It is a draft unless --publish is set." },
    output: "Resource envelope. data is the created article object; meta has profile.",
    method: "POST",
    resourceKey: "article",
    examples: [
      `zendesk articles create --section-id 456 --title 'Reset your password' --body-file reset-password.html --dry-run`,
      `zendesk articles create --section-id 456 --title 'Reset your password' --body-file reset-password.html --yes`,
    ],
    request: (context, endpoint) => {
      const { options } = context;
      const section = options.string("section-id") ?? "";
      const title = options.string("title") ?? "";
      const publish = options.flag("publish");
      const article = present({
        title,
        body: bodyText(context),
        locale: locale(context, endpoint),
        draft: !publish,
        ...articleMetadata(context, true),
      });
      return {
        path: `${HELP_CENTER}/sections/${encodeURIComponent(section)}/articles`,
        body: { article, notify_subscribers: options.flag("notify-subscribers") },
        effect: `Creates ${publish ? "a published" : "a draft"} ${locale(context, endpoint)} article "${title}" in section ${section}.`,
      };
    },
  },
  {
    path: ["articles", "update"],
    summary: "Update article metadata or localized content.",
    arguments: [ARTICLE_ID],
    options: articleFieldOptions(false),
    effects: {
      kind: "remote-mutation",
      summary:
        "Changes only the supplied fields. Omitted fields keep their values. Sends one request: --title and --body-file change the localized content, and every other field changes the metadata, so the two groups cannot share one command.",
    },
    output: "Resource envelope. data is the updated article object, or the updated translation object when --title or --body-file changes localized content; meta has profile.",
    method: "PUT",
    select: unwrapResource,
    examples: [
      `zendesk articles update 789 --title 'Reset your account password' --dry-run`,
      "zendesk articles update 789 --label account --label security --yes",
    ],
    request: (context, endpoint) =>
      updateRequest(context, endpoint, {
        kind: "article",
        path: "articles",
        contentFields: ARTICLE_CONTENT_FIELDS,
        metadataFields: ARTICLE_METADATA_FIELDS,
        content: () => present({ title: context.options.string("title"), body: bodyText(context) }),
        metadata: () => articleMetadata(context, false),
      }),
  },
  {
    path: ["articles", "archive"],
    summary: "Archive an article.",
    arguments: [ARTICLE_ID],
    options: [],
    effects: { kind: "remote-mutation", summary: "Archives the article. It can be restored in Zendesk Guide." },
    output: "Resource envelope. data is null; meta has profile.",
    method: "DELETE",
    examples: ["zendesk articles archive 789 --dry-run", "zendesk articles archive 789 --yes"],
    request: (context) => ({
      path: `${HELP_CENTER}/articles/${encodedId(context)}`,
      effect: `Archives article ${context.args[0]}. It can be restored in Zendesk Guide.`,
    }),
  },
  publicationCommand("publish", "Publish an article's translation.", false),
  publicationCommand("unpublish", "Return an article's translation to draft.", true),
];

/** The updated resource out of an update response, which wraps a metadata change by kind and a content change as a translation. */
function unwrapResource(payload: unknown): unknown {
  const body = isRecord(payload) ? payload : {};
  const key = ["article", "section", "category", "translation"].find((name) => isRecord(body[name]));
  if (key === undefined) throw new CliError("INVALID_RESPONSE", "Zendesk returned no article, section, category, or translation object for the update.");
  return body[key];
}

function publicationCommand(action: "publish" | "unpublish", summary: string, draft: boolean): ResourceCommand {
  return {
    path: ["articles", action],
    summary,
    arguments: [ARTICLE_ID],
    options: [LOCALE],
    effects: { kind: "remote-mutation", summary: `Sets draft to ${draft} on the translation in the selected locale.` },
    output: "Resource envelope. data is the translation object; meta has profile.",
    method: "PUT",
    resourceKey: "translation",
    examples: [`zendesk articles ${action} 789 --dry-run`, `zendesk articles ${action} 789 --locale ja --yes`],
    exceptions: [{ rule: "CLI-GRAM-4", reason: `${action} preserves the Zendesk Guide term for changing a translation's draft state.` }],
    request: (context, endpoint) => ({
      path: `${HELP_CENTER}/articles/${encodedId(context)}/translations/${encodeURIComponent(locale(context, endpoint))}`,
      body: { translation: { draft } },
      effect: `${draft ? "Returns" : "Publishes"} the ${locale(context, endpoint)} translation of article ${context.args[0]}${draft ? " to draft" : ""}.`,
    }),
  };
}

// Categories and sections

function containerCommands(kind: "category" | "section"): ResourceCommand[] {
  const sections = kind === "section";
  const plural = sections ? "sections" : "categories";
  const label = sections ? "Section" : "Category";
  const argument = sections ? SECTION_ID : CATEGORY_ID;
  const includes = sections ? SECTION_INCLUDES : CATEGORY_INCLUDES;
  const metadataFields = ["position", ...(sections ? ["category-id", "parent-section-id", "sorting", "theme-template"] : [])];

  const fieldOptions = (creating: boolean): OptionSpec[] => [
    creating ? required(textOption("name", `${label} name.`)) : textOption("name", `${label} name.`),
    textOption("description", `${label} description.`),
    positionOption("Position among siblings."),
    ...(sections
      ? [
          creating
            ? required(idOption("category-id", "Category that receives the section."))
            : numberIdOption("category-id", "Move the section to this category."),
          numberIdOption("parent-section-id", "Parent section."),
          {
            name: "sorting",
            placeholder: "VALUE",
            type: "enum" as const,
            choices: ["manual", "title", "created_at", "updated_at"],
            description: "Article sort order.",
          },
          textOption("theme-template", "Theme template name."),
        ]
      : []),
    creating ? LOCALE : localeOption("--name and --description"),
  ];

  const metadata = (context: Context, creating: boolean): Record<string, unknown> =>
    present({
      position: context.options.number("position"),
      ...(sections
        ? {
            category_id: creating ? undefined : context.options.number("category-id"),
            parent_section_id: context.options.number("parent-section-id"),
            sorting: context.options.string("sorting"),
            theme_template: context.options.string("theme-template"),
          }
        : {}),
    });

  return [
    {
      path: [plural, "list"],
      summary: `List ${plural}.`,
      arguments: [],
      options: [
        ...(sections ? [idOption("category-id", "List only sections in this category.")] : []),
        sortBy(["position", "created_at", "updated_at"]),
        SORT_ORDER,
        includeOption(includes),
        LOCALE,
      ],
      effects: { kind: "read" },
      output: `Collection envelope. data is an array of ${plural}; meta holds profile, next_cursor, and has_more. ${sections ? "With --include categories, meta.provider holds the side-loaded categories, merged across --all pages without repeats. " : ""}Translations are embedded in each ${kind}.`,
      method: "GET",
      collectionKey: plural,
      ...(arrays(includes).length > 0 ? { providerMeta: arrays(includes) } : {}),
      pagination: BY_POSITION,
      examples: sections
        ? ["zendesk sections list --category-id 123", "zendesk sections list --all --format json", "zendesk sections list --include categories"]
        : ["zendesk categories list", "zendesk categories list --all --format json", "zendesk categories list --include translations"],
      request: (context, endpoint) => {
        const category = sections ? context.options.string("category-id") : undefined;
        const scope = category ? `categories/${encodeURIComponent(category)}/sections` : plural;
        return { path: `${localePath(context, endpoint)}/${scope}`, query: listQuery(context, [includeQuery(context)]) };
      },
    },
    {
      path: [plural, "get"],
      summary: `Get one ${kind}.`,
      arguments: [argument],
      options: [includeOption(includes), LOCALE],
      effects: { kind: "read" },
      output: `Resource envelope. data is the ${kind} object.${includes.length > 0 && arrays(includes).length > 0 ? ` With --include ${arrays(includes).join(", ")}, meta.provider holds each side-loaded array under its relation name.` : ""} meta has profile.`,
      method: "GET",
      resourceKey: kind,
      providerMeta: arrays(includes),
      emptyIsNotFound: true,
      examples: [`zendesk ${plural} get 123`, `zendesk ${plural} get 123 --locale ja --format json`, `zendesk ${plural} get 123 --include ${includes[0]}`],
      request: (context, endpoint) => ({
        path: `${localePath(context, endpoint)}/${plural}/${encodedId(context)}`,
        query: getQuery(context),
      }),
    },
    {
      path: [plural, "create"],
      summary: `Create a ${kind}.`,
      arguments: [],
      options: fieldOptions(true),
      effects: { kind: "remote-mutation", summary: `Creates a ${kind} with the supplied localized name and description.` },
      output: `Resource envelope. data is the created ${kind} object; meta has profile.`,
      method: "POST",
      resourceKey: kind,
      examples: sections
        ? ['zendesk sections create --category-id 123 --name "Billing" --dry-run', 'zendesk sections create --category-id 123 --name "Billing" --yes']
        : ['zendesk categories create --name "Support" --dry-run', 'zendesk categories create --name "Support" --yes'],
      request: (context, endpoint) => {
        const name = context.options.string("name") ?? "";
        const parent = sections ? (context.options.string("category-id") ?? "") : undefined;
        const fields = present({
          name,
          description: context.options.string("description"),
          locale: locale(context, endpoint),
          ...metadata(context, true),
        });
        return {
          path: parent === undefined ? `${HELP_CENTER}/categories` : `${HELP_CENTER}/categories/${encodeURIComponent(parent)}/sections`,
          body: { [kind]: fields },
          effect: `Creates ${kind} "${name}" in ${locale(context, endpoint)}${parent === undefined ? "" : ` under category ${parent}`}.`,
        };
      },
    },
    {
      path: [plural, "update"],
      summary: `Update ${kind} metadata or localized content.`,
      arguments: [argument],
      options: fieldOptions(false),
      effects: {
        kind: "remote-mutation",
        summary: `Changes only the supplied fields. Omitted fields keep their values. Sends one request: --name and --description change the localized content, and every other field changes the metadata, so the two groups cannot share one command.`,
      },
      output: `Resource envelope. data is the updated ${kind} object, or the updated translation object when --name or --description changes localized content; meta has profile.`,
      method: "PUT",
      select: unwrapResource,
      examples: [`zendesk ${plural} update 123 --name 'Account help' --dry-run`, `zendesk ${plural} update 123 --position 2 --yes`],
      request: (context, endpoint) =>
        updateRequest(context, endpoint, {
          kind,
          path: plural,
          contentFields: ["name", "description"],
          metadataFields,
          content: () => present({ title: context.options.string("name"), body: context.options.string("description") }),
          metadata: () => metadata(context, false),
        }),
    },
    {
      path: [plural, "delete"],
      summary: `Delete a ${kind}.`,
      arguments: [argument],
      options: [],
      effects: {
        kind: "remote-mutation",
        summary: sections
          ? "Deletes the section together with the articles it contains. Zendesk documents no way to restore a deleted section."
          : "Deletes the category together with the sections and articles it contains. Zendesk documents no way to restore a deleted category.",
      },
      output: "Resource envelope. data is null; meta has profile.",
      method: "DELETE",
      examples: [`zendesk ${plural} delete 123 --dry-run`, `zendesk ${plural} delete 123 --yes`],
      request: (context) => ({
        path: `${HELP_CENTER}/${plural}/${encodedId(context)}`,
        effect: `Deletes ${kind} ${context.args[0]} together with ${sections ? "the articles" : "the sections and articles"} it contains.`,
      }),
    },
  ];
}

const localeCommands: ResourceCommand[] = [
  {
    path: ["locales", "list"],
    summary: "List enabled Help Center locales.",
    arguments: [],
    options: [],
    effects: { kind: "read" },
    output: "Collection envelope. data is an array of locale codes; meta has profile.",
    method: "GET",
    collectionKey: "locales",
    unpaginated: "Not paginated. Zendesk returns every enabled locale; meta has profile.",
    examples: ["zendesk locales list", "zendesk locales list --format json"],
    request: () => ({ path: `${HELP_CENTER}/locales` }),
  },
];

export const commands: ResourceCommand[] = [
  ...articleCommands,
  ...containerCommands("category"),
  ...localeCommands,
  ...containerCommands("section"),
];
