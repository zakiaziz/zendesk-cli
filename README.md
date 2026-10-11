# zendesk-cli

Command-line interface for the Zendesk Help Center API. It lists enabled locales, reads and changes categories, sections, and articles, and sends raw API requests to any Zendesk API path. It is not an official Zendesk product.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g @zakiaziz/zendesk-cli
bun add -g @zakiaziz/zendesk-cli
cd zendesk-cli && bun run build && bun link
```

## Quick start

```bash
zendesk setup
# List the articles in one section as a table.
zendesk articles list --section-id 456 --all --format human
# Preview a new draft article without creating it.
zendesk articles create --section-id 456 --title 'Reset your password' --body-file reset-password.html --dry-run
# Publish the Japanese translation of an article.
zendesk articles publish 789 --locale ja --yes
```

## Commands

### articles

| Command | Description | Options |
| --- | --- | --- |
| zendesk articles list | List articles. | --section-id ID, --category-id ID, --label NAME, --sort-by FIELD, --sort-order ORDER, --locale LOCALE, --page-size N, --cursor TOKEN, --all, --max-items N |
| zendesk articles get ARTICLE_ID | Get one article. | --locale LOCALE |
| zendesk articles search QUERY | Search articles. | --section-id ID, --category-id ID, --label NAME, --sort-by FIELD, --sort-order ORDER, --locale LOCALE, --page-size N, --cursor TOKEN, --all, --max-items N |
| zendesk articles create | Create an article. | --title TEXT, --body-file PATH, --section-id ID, --author-id ID, --comments-disabled BOOLEAN, --content-tag-id ID, --label NAME, --permission-group-id ID, --position N, --promoted BOOLEAN, --user-segment-id ID, --locale LOCALE, --publish, --notify-subscribers, --yes, --dry-run |
| zendesk articles update ARTICLE_ID | Update article metadata or localized content. | --title TEXT, --body-file PATH, --section-id ID, --author-id ID, --comments-disabled BOOLEAN, --content-tag-id ID, --clear-content-tag-id, --label NAME, --clear-label, --permission-group-id ID, --position N, --promoted BOOLEAN, --user-segment-id ID, --clear-user-segment-id, --locale LOCALE, --yes, --dry-run |
| zendesk articles archive ARTICLE_ID | Archive an article. | --yes, --dry-run |
| zendesk articles publish ARTICLE_ID | Publish an article's translation. | --locale LOCALE, --yes, --dry-run |
| zendesk articles unpublish ARTICLE_ID | Return an article's translation to draft. | --locale LOCALE, --yes, --dry-run |

### categories

| Command | Description | Options |
| --- | --- | --- |
| zendesk categories list | List categories. | --sort-by FIELD, --sort-order ORDER, --locale LOCALE, --page-size N, --cursor TOKEN, --all, --max-items N |
| zendesk categories get CATEGORY_ID | Get one category. | --locale LOCALE |
| zendesk categories create | Create a category. | --name TEXT, --description TEXT, --position N, --locale LOCALE, --yes, --dry-run |
| zendesk categories update CATEGORY_ID | Update category metadata or localized content. | --name TEXT, --description TEXT, --position N, --locale LOCALE, --yes, --dry-run |
| zendesk categories delete CATEGORY_ID | Delete a category. | --yes, --dry-run |

### locales

| Command | Description | Options |
| --- | --- | --- |
| zendesk locales list | List enabled Help Center locales. | None |

### sections

| Command | Description | Options |
| --- | --- | --- |
| zendesk sections list | List sections. | --category-id ID, --sort-by FIELD, --sort-order ORDER, --locale LOCALE, --page-size N, --cursor TOKEN, --all, --max-items N |
| zendesk sections get SECTION_ID | Get one section. | --locale LOCALE |
| zendesk sections create | Create a section. | --name TEXT, --description TEXT, --position N, --category-id ID, --parent-section-id ID, --sorting VALUE, --theme-template TEXT, --locale LOCALE, --yes, --dry-run |
| zendesk sections update SECTION_ID | Update section metadata or localized content. | --name TEXT, --description TEXT, --position N, --category-id ID, --parent-section-id ID, --sorting VALUE, --theme-template TEXT, --locale LOCALE, --yes, --dry-run |
| zendesk sections delete SECTION_ID | Delete a section. | --yes, --dry-run |

### setup

| Command | Description | Options |
| --- | --- | --- |
| zendesk setup [NAME] | Create and activate a profile. | --email EMAIL, --api-token-file PATH, --base-url URL, --subdomain SUBDOMAIN, --default-locale LOCALE, --from-env |

### profiles

| Command | Description | Options |
| --- | --- | --- |
| zendesk profiles list | List saved profiles. | None |
| zendesk profiles get NAME | Get one saved profile with secrets redacted. | None |
| zendesk profiles create NAME | Create a profile without activating it. | --email EMAIL, --api-token-file PATH, --base-url URL, --subdomain SUBDOMAIN, --default-locale LOCALE |
| zendesk profiles update NAME | Update fields of a profile. | --email EMAIL, --api-token-file PATH, --base-url URL, --subdomain SUBDOMAIN, --default-locale LOCALE, --clear-base-url, --clear-subdomain, --clear-default-locale |
| zendesk profiles delete NAME | Delete a profile. | None |
| zendesk profiles use NAME | Make a profile the active profile. | None |

### config

| Command | Description | Options |
| --- | --- | --- |
| zendesk config list | List every configuration key. | None |
| zendesk config get KEY | Get one configuration value. | None |
| zendesk config set KEY VALUE | Set one configuration value. | None |
| zendesk config unset KEY | Remove one configuration value. | None |
| zendesk config path | Get the configuration paths. | None |

### auth

| Command | Description | Options |
| --- | --- | --- |
| zendesk auth verify | Verify the email and API token. | None |

### api

| Command | Description | Options |
| --- | --- | --- |
| zendesk api request METHOD PATH | Send a raw API request. | --query KEY=VALUE, --file PATH, --yes, --dry-run |

### completions

| Command | Description | Options |
| --- | --- | --- |
| zendesk completions SHELL | Print a shell completion script. | None |

## Global options

| Option | Description |
| --- | --- |
| -h, --help | Show help. Uses no credentials or network. |
| --version | Print the executable name and version. |
| --profile NAME | Select a saved profile. |
| --format FORMAT | Output format. Allowed: json, pretty, human. Default: json. |
| --color WHEN | Color for pretty and human output. Allowed: auto, always, never. Default: auto. |
| -q, --quiet | Suppress progress and notices. Results and errors still print. |
| -v, --verbose | Print redacted diagnostics to stderr. |
| --no-input | Never prompt. Fail when input is missing. |
| --timeout DURATION | Per-request timeout in ms, s, or m, from 1ms to 10m. Default: 30s. |

Network commands (the resource commands, `auth verify`, and `api request`) accept every option except `--version`. Local commands (`setup`, `profiles`, and `config`) accept `--help`, `--format`, `--color`, `--quiet`, `--verbose`, and `--no-input`. `completions` accepts only `--help`. With no command, only `--help`, `--version`, `--verbose`, and `--quiet` apply, and `--version` with a command word fails.

## Authentication

Create an API token in Zendesk Admin Center under **Apps and integrations > APIs > API tokens**, save the token to a file, and run `setup` with the email of the agent and the account's subdomain:

```bash
zendesk setup work --email agent@example.com --api-token-file ./zendesk-api-token.txt --subdomain acme
zendesk auth verify
```

`setup [NAME]` creates a profile (default name: `default`) and makes it the active profile. It fails when the profile exists. If activation fails after the profile is written, the profile stays saved and `setup` exits 8 with `PARTIAL_FAILURE`. In a terminal without `--no-input`, `setup` prompts for a missing email with visible input and a missing API token with hidden input. The API token is never a command-line value: pass `--api-token-file PATH` (`-` reads stdin), set `ZENDESK_API_TOKEN`, or enter it at the prompt. The email is not secret: pass `--email EMAIL`, set `ZENDESK_EMAIL`, or enter it at the prompt. `setup --from-env` copies `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`, and `ZENDESK_BASE_URL` into the profile and cannot be combined with `--email`, `--api-token-file`, `--base-url`, `--subdomain`, or `--default-locale`.

| Variable | Purpose |
| --- | --- |
| `ZENDESK_PROFILE` | Select a saved profile. |
| `ZENDESK_EMAIL` | Email of the agent who owns the API token. |
| `ZENDESK_API_TOKEN` | Zendesk API token. Needs `ZENDESK_EMAIL`. |
| `ZENDESK_SUBDOMAIN` | Zendesk subdomain, such as `acme`. Chooses the base URL `https://acme.zendesk.com`. |
| `ZENDESK_BASE_URL` | Account base URL, an origin such as `https://acme.zendesk.com`. Beats the subdomain within the same source. |
| `ZENDESK_DEFAULT_LOCALE` | Locale that Help Center commands use when `--locale` is not set. Default: `en-us`. |
| `XDG_CONFIG_HOME` | Configuration root when it is an absolute path. Otherwise `~/.config`. |
| `NO_COLOR` | Disables color with `--color auto` when set and nonempty. |
| `CI` | Disables prompts when nonempty and not `0` or `false`. |

A `ZENDESK_` variable that is set but empty, a malformed `ZENDESK_PROFILE`, and an invalid `ZENDESK_BASE_URL`, `ZENDESK_SUBDOMAIN`, or `ZENDESK_DEFAULT_LOCALE` fail with `CONFIGURATION_ERROR` and name the variable. None of them falls through to the next source.

Precedence:

1. Profile selection: `--profile`, `ZENDESK_PROFILE`, then `activeProfile` in `config.json`. A selected or active profile that does not exist fails with `CONFIGURATION_ERROR`, with no fallback.
2. Credentials: `ZENDESK_EMAIL` and `ZENDESK_API_TOKEN`, then the selected profile. A credential set comes whole from the first source that supplies any part of it. A partial set fails with `AUTHENTICATION_REQUIRED`.
3. Endpoint: `ZENDESK_BASE_URL` or `ZENDESK_SUBDOMAIN`, the selected profile, `config.json`, then the built-in default. Within one source a base URL beats the subdomain. Zendesk has no shared host, so the base URL has no default: with neither a base URL nor a subdomain set, requests and `--dry-run` fail with `CONFIGURATION_ERROR`. `ZENDESK_DEFAULT_LOCALE` follows the same order and defaults to `en-us`.

`zendesk auth verify` sends `GET /api/v2/users/me`. Success proves that Zendesk accepted the credential and returns the user it identifies, with secrets redacted. It does not prove permission for any Help Center resource.

## Output and errors

The default output format is `json`: one compact, uncolored line on stdout with the envelope `{"data":...,"meta":{...}}`. `--format pretty` prints the same document indented, with syntax highlighting when color applies. `--format human` prints tables for collections and labeled fields for one resource. Errors go to stderr in the selected format. Help, `--version`, and `completions` print plain text.

`data` is an object for one resource, an array for a collection, or `null`, and keeps Zendesk's field names. For one resource, `data` is the Zendesk response body, which holds the object under its wrapper key, such as `article` or `translation`. For a collection, the array is unwrapped from its collection key. `meta` is always present.

| `meta` key | When |
| --- | --- |
| `next_cursor` | Paginated collection reads. A string, or `null` when no page remains. |
| `has_more` | Paginated collection reads. |
| `provider` | Other collection fields that Zendesk returns: `count` for `articles search`. |
| `dry_run`, `validation` | Dry-run previews. `validation` is `local`. |

Errors print one document on stderr, for example `{"error":{"code":"RATE_LIMITED","message":"...","hint":"...","retryable":true,"provider":{"status":429}}}`. Optional keys are `hint`, `outcome` (`unknown` when a mutation may have applied), `provider` (`status`, `code`, `request_id`, `retry_after_seconds`), `details`, and `partial`. `--format human` prints `Error [CODE]: message` and `Hint: ...`.

| Exit | Error codes |
| --- | --- |
| 0 | Success, including empty collections. |
| 1 | `UNEXPECTED_ERROR`, `PROVIDER_ERROR`, `INVALID_RESPONSE`, `UNSUPPORTED_RESPONSE` |
| 2 | `INVALID_ARGUMENT`, `INVALID_REQUEST` |
| 3 | `CONFIGURATION_ERROR`, `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_FAILED` |
| 4 | `PERMISSION_DENIED` |
| 5 | `NOT_FOUND` |
| 6 | `CONFLICT` |
| 7 | `RATE_LIMITED`, `TRANSIENT_FAILURE` |
| 8 | `PARTIAL_FAILURE` |
| 9 | `CONFIRMATION_REQUIRED`, `CONFIRMATION_DECLINED` |
| 130 | `INTERRUPTED` |

IDs are opaque strings. Options accept `--name value` and `--name=value`, and `--` ends options. `--locale LOCALE` selects the localized content that Help Center commands read or change; the default is `ZENDESK_DEFAULT_LOCALE` or `en-us`. Unknown commands, options, extra arguments, invalid values, and conflicting options fail with exit code 2 before any request.

Zendesk keeps the metadata and the localized content of articles, categories, and sections behind separate endpoints, and each command sends one request. An `update` command therefore changes either the localized content (`--title` and `--body-file` for articles, `--name` and `--description` for categories and sections) or the metadata, and mixing the two groups fails with `INVALID_ARGUMENT`. New articles are drafts unless you pass `--publish`.

Mutations (every `create`, `update`, `delete`, `archive`, `publish`, and `unpublish` command, and `api request` with `POST`, `PUT`, `PATCH`, or `DELETE`) need confirmation. The CLI validates arguments first, then resolves credentials (exit 3 when missing), then asks for confirmation. In a terminal, it shows the profile, operation, request, and effect, then prompts. `--yes` confirms without a prompt. With `--no-input`, a non-terminal stdin or stderr, or CI mode, a missing confirmation exits 9. Ctrl-C or end of input at a prompt exits 130 with `INTERRUPTED`. `--dry-run` prints a redacted preview of the request, with headers in the order `Authorization`, `Accept`, `Content-Type`, and sends nothing. It needs no credentials, but it prints the request URL, so with no base URL or subdomain configured it fails with `CONFIGURATION_ERROR`. Preview success does not guarantee that the request succeeds.

Reads make up to 3 attempts on HTTP 429, 500, 502, 503, 504, network errors, and timeouts, waiting 250 ms, then 500 ms, or the `Retry-After` value up to 10 seconds. A `Retry-After` above 10 seconds is not waited on: the command fails with `RATE_LIMITED` and `provider.retry_after_seconds`. Mutations make one attempt. When a mutation times out or Zendesk answers with a server error, the error carries `outcome: "unknown"`: check the current state before you repeat it. `--timeout` applies to each attempt. `--verbose` writes redacted request, response, and retry diagnostics to stderr.

## Pagination

Paginated commands (`articles list`, `articles search`, `categories list`, and `sections list`) fetch one page by default. `--page-size` is limited to 100, and 100 is the default. Categories and sections are ordered by `position` unless you set `--sort-by`. Articles are ordered by Zendesk unless you set `--sort-by`: the default is `position`, and a section can define its own article order. `articles search` is ordered by relevance unless you set `--sort-by`.

`--all` follows every cursor. `--max-items N` (with `--all`) shrinks the last request so the read stops on a page boundary, and `meta.next_cursor` resumes it. `--cursor TOKEN` resumes from a previous `meta.next_cursor`, with or without `--all`. Repeat the same filters when you resume.

```bash
zendesk articles list --all --max-items 100 > articles.json
zendesk articles list --all --cursor "$(jq -r '.meta.next_cursor' articles.json)"
```

Help Center lists use Zendesk cursor pagination. `articles search` uses offset pagination: its cursor is a decimal result offset, a resumed request can return fewer items than `--page-size` so the page aligns with the offset, and Zendesk returns at most 1000 results. `meta.provider.count` is the total number of matches. A query that matches more than 1000 results returns only the first 1000, so narrow the query.

A repeated cursor or an oversized page on the first page fails with `INVALID_RESPONSE` and exit 1. A failure on a later page exits 8 with `PARTIAL_FAILURE`. The items read so far are in `error.partial.data`, and `error.partial.next_cursor` points at the first unread item. `locales list` is unpaginated: Zendesk returns every enabled locale.

## Raw API access

```bash
zendesk api request GET /api/v2/help_center/articles --query per_page=10
zendesk api request PUT /api/v2/help_center/articles/789 --file request.json --dry-run
```

Methods: `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`, `DELETE`. `PATH` starts with a single `/` and has no scheme, host, query string, fragment, whitespace, or `.` and `..` segments. Add query parameters with the repeatable `--query KEY=VALUE`, which keeps exact names such as `page[size]`. `--file PATH` sends a JSON body as `application/json` (`-` reads stdin). `--file`, `--yes`, and `--dry-run` are rejected on `GET`, `HEAD`, and `OPTIONS`. The CLI sends the selected profile's credentials only to the configured API origin. JSON responses print as parsed, other text prints as a JSON string, an empty body prints `null`, and binary responses fail with `UNSUPPORTED_RESPONSE`. Non-2xx responses use the same error mapping as other commands. Use this command for side-loading with `include`, which first-class commands do not expose.

## Configuration

Files live in `$XDG_CONFIG_HOME/zendesk` when `XDG_CONFIG_HOME` is an absolute path, and in `~/.config/zendesk` otherwise.

```text
zendesk/
  config.json            {"activeProfile": "work", "baseUrl": "https://acme.zendesk.com"}
  profiles/NAME.json     {"email": "...", "apiToken": "...", "baseUrl": "https://acme.zendesk.com"}
```

Keys are camelCase. Files use mode `0600`, directories use mode `0700`, and writes are atomic: the CLI creates a temporary file exclusively with mode `0600` in the same directory, then renames it. Reads reject unknown keys and non-object JSON with `CONFIGURATION_ERROR`. Profile names match `^[A-Za-z0-9._-]+$` and are not `.` or `..`. `config.json` keys: `activeProfile` (read-only through `config`; change it with `profiles use`), `baseUrl`, `subdomain`, and `defaultLocale`. Profile fields: `email`, `apiToken`, `baseUrl`, `subdomain`, and `defaultLocale`. The API token is redacted in previews, diagnostics, `profiles get`, and `config list`. The email is not secret and is shown unredacted.

A subdomain contains letters, digits, and hyphens, and starts and ends with a letter or digit. A base URL, from `--base-url`, `config set baseUrl`, `ZENDESK_BASE_URL`, or a stored file, must be an `https` URL (`http` only for `localhost`, `127.0.0.1`, or `::1`) with no credentials, query string, fragment, or path. Values are stored unchanged, and requests go to the URL's origin.

Completion scripts come from `zendesk completions bash|zsh|fish` and read only the command registry and local profile names. They complete commands, options, enum values (after `--OPT ` and `--OPT=`), `METHOD`, `SHELL`, and profile names (after `--profile` and for the `NAME` argument of `profiles get|update|delete|use`). They offer nothing after `--` or after an option that takes a free-form value.

## Exceptions

| Rule | Decision | Reason |
| --- | --- | --- |
| `CLI-GRAM-4` | The update commands reject content fields combined with metadata fields. | Zendesk updates content and metadata through two endpoints, and each command sends one request. |
| `CLI-GRAM-4` | `articles publish` and `articles unpublish` are domain actions. | They preserve the Zendesk Guide terms for changing a translation's draft state. |

## Development

```bash
bun run build
bun run check
bun link
```

`src/core/` is vendored from cli-core and is never edited here. Change cli-core and run its sync script instead. `docs/cli-conventions.md` restates the command-line contract this tool follows.

## API references

- [Zendesk Help Center API](https://developer.zendesk.com/api-reference/help_center/help-center-api/introduction/)
- [Articles API](https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/)
- [Categories API](https://developer.zendesk.com/api-reference/help_center/help-center-api/categories/)
- [Sections API](https://developer.zendesk.com/api-reference/help_center/help-center-api/sections/)
- [Translations API](https://developer.zendesk.com/api-reference/help_center/help-center-api/translations/)
- [Locales API](https://developer.zendesk.com/api-reference/help_center/help-center-api/locales/)
- [Help Center search](https://developer.zendesk.com/api-reference/help_center/help-center-api/search/)
- [Zendesk API authentication](https://developer.zendesk.com/api-reference/introduction/security-and-auth/)
