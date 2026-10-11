# zendesk-cli

A human-friendly command line interface for browsing and editing a Zendesk knowledge base.

This project owns the `zendesk` binary. It is not an official Zendesk CLI.

## Install

Install from npm with Node 22 or newer, or with Bun:

```bash
npm install -g @zakiaziz/zendesk-cli
bun add -g @zakiaziz/zendesk-cli
```

To work on the CLI, build and link a checkout with `bun install`, `bun run build`, and `bun link`.

## Development setup

Build and link the local checkout for testing:

```bash
bun install
bun run build
bun test
bun link
```

## Setup

API token authentication:

```bash
zendesk setup --subdomain acme \
  --email agent@example.com \
  --api-token "$ZENDESK_API_TOKEN" \
  --locale en-us
zendesk auth verify
```

Create API tokens in Zendesk Admin Center at **Apps and integrations > APIs > API tokens**.

OAuth authentication:

```bash
zendesk setup --subdomain acme --oauth-token "$ZENDESK_OAUTH_TOKEN" --locale en-us
```

Profiles live in `~/.config/zendesk`. Files containing credentials are written with mode `0600`. For a multi-brand account, configure the brand-specific Zendesk subdomain.

Credential resolution order is command flags, environment variables, then the selected profile. Supported environment variables are `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`, `ZENDESK_OAUTH_TOKEN`, `ZENDESK_LOCALE`, and `ZENDESK_BASE_URL`.

## Command Conventions

Commands return compact JSON with data and meta fields by default. Use --format pretty for highlighted JSON or --format human for terminal output. List and search commands accept `--all` to follow every page and combine the resource array.

Every mutation requires `--yes` to execute in non-interactive use. Use `--dry-run` to print every redacted request without changing Zendesk. New articles are drafts unless `--publish` is supplied.

`--locale` selects the localized content to read or edit. It defaults to the profile locale, then `en-us`. Article bodies use `--body-file PATH`; other content options are literal text.

## Complete Command Reference

### Setup, Profiles, and Configuration

| Command | Description |
| --- | --- |
| `zendesk setup [profile] [options]` | Create and activate a profile. Prompts for missing API-token credentials in a terminal. |
| `zendesk profiles list` | List profile names and the active profile. |
| `zendesk profiles get <name>` | Show a profile with secrets redacted. |
| `zendesk profiles create <name> [options]` | Create a profile. |
| `zendesk profiles update <name> [options]` | Update a profile. |
| `zendesk profiles delete <name>` | Delete a profile. |
| `zendesk profiles use <name>` | Make a profile active. |
| `zendesk config path` | Show the config directory and config file path. |
| `zendesk config list` | Show global configuration with secrets redacted. |
| `zendesk config get <key>` | Read a dotted configuration key. |
| `zendesk config set <key> <value>` | Set a dotted configuration key. JSON-like values are parsed. |
| `zendesk config unset <key>` | Remove a dotted configuration key. |
| `zendesk auth verify` | Verify credentials against `/api/v2/users/me`. |
| `zendesk completions bash` | Print Bash completions. |
| `zendesk completions zsh` | Print Zsh completions. |
| `zendesk completions fish` | Print Fish completions. |
| `zendesk api request <GET\|POST\|PUT\|DELETE> </api/path>` | Call any Zendesk API path. Non-GET methods are mutations. |

Setup accepts `--profile`, `--subdomain`, `--email`, `--api-token`, `--oauth-token`, `--locale`, `--base-url`, and `--from-env`. Profile create/update accepts the same stored profile fields except `--from-env`.

### Locales

| Command | Options | Description |
| --- | --- | --- |
| `zendesk locales list` | None | List enabled Help Center locales and the default locale. |

### Categories

| Command | Options | Description |
| --- | --- | --- |
| `zendesk categories list` | `--sort-by`, `--sort-order`, `--cursor`, `--page-size`, `--include`, `--all`, `--max-items` | List categories in the selected locale. |
| `zendesk categories get <id>` | `--include` | Show one category. |
| `zendesk categories get <id>` | `--include` | Get one category. |
| `zendesk categories get <id>` | `--include` | Alias for `category show`. |
| `zendesk categories create` | `--name` (required), `--description`, `--position` | Create a category. Mutation. |
| `zendesk categories update <id>` | `--name`, `--description`, `--position` | Edit localized content and/or category metadata. Mutation. |
| `zendesk categories delete <id>` | None | Delete a category. Mutation. |

### Sections

| Command | Options | Description |
| --- | --- | --- |
| `zendesk sections list` | `--category`, `--sort-by`, `--sort-order`, `--cursor`, `--page-size`, `--include`, `--all`, `--max-items` | List all sections or sections in one category. |
| `zendesk sections get <id>` | `--include` | Get one section. |
| `zendesk sections create` | `--category` and `--name` (required), `--description`, `--position`, `--parent-section-id`, `--sorting`, `--theme-template` | Create a section. Mutation. |
| `zendesk sections update <id>` | `--category`, `--name`, `--description`, `--position`, `--parent-section-id`, `--sorting`, `--theme-template` | Edit localized content, move the section, and/or change metadata. Mutation. |
| `zendesk sections delete <id>` | None | Delete a section. Mutation. |

### Articles: Browse

| Command | Options | Description |
| --- | --- | --- |
| `zendesk articles list` | `--section` or `--category`, `--labels`, `--sort-by`, `--sort-order`, `--cursor`, `--page-size`, `--include`, `--all`, `--max-items` | List articles, optionally scoped to one section or category. |
| `zendesk articles search [words]` | `--category`, `--section`, `--labels`, `--sort-by`, `--sort-order`, `--cursor`, `--page-size`, `--all`, `--max-items` | Search articles. Supply words or at least one category, section, or label filter. |
| `zendesk articles get <id>` | `--include` | Show one article in the selected locale. |
| `zendesk articles get <id>` | `--include` | Get one article. |
| `zendesk articles get <id>` | `--include` | Alias for `article show`. |

`--section` and `--category` are mutually exclusive on `articles list`. `--labels` is repeatable. List sorting supports Zendesk values such as `position`, `title`, `created_at`, and `updated_at`.

### Articles: Create, Edit, and Publish

| Command | Options | Description |
| --- | --- | --- |
| `zendesk articles create` | `--section` and `--title` (required), plus article fields below | Create an article as a draft by default. Mutation. |
| `zendesk articles update <id>` | One or more article fields below | Edit localized content and/or article metadata. Mutation. |
| `zendesk articles publish <id>` | None | Publish the selected locale by setting `draft: false`. Mutation. |
| `zendesk articles unpublish <id>` | None | Return the selected locale to draft by setting `draft: true`. Mutation. |
| `zendesk articles archive <id>` | None | Archive the article. It can be restored in Zendesk Guide. Mutation. |

Article create/edit fields:

| Option | Create | Edit | Meaning |
| --- | --- | --- | --- |
| `--title <text>` | Required | Optional | Localized article title. |
| `--body-file <path>` | Optional | Optional | Read localized HTML from a file; `-` reads stdin. |
| `--section <id>` | Required | Optional | Parent section; on edit, moves the article. |
| `--draft[=true\|false]` | Optional | Optional | Set the selected locale's draft state. |
| `--publish[=true\|false]` | Optional | Optional | Inverse of `--draft`; cannot be combined with it. |
| `--author-id <id>` | Optional | Optional | Article author. |
| `--comments-disabled[=true\|false]` | Optional | Optional | Disable or enable comments. |
| `--content-tag-ids <id>` | Optional | Optional | Content tag ID; repeat the option for multiple IDs. |
| `--labels <name>` | Optional | Optional | Label name; repeat the option for multiple labels. |
| `--permission-group-id <id>` | Optional | Optional | Management permission group. |
| `--position <number>` | Optional | Optional | Position within the section. |
| `--promoted[=true\|false]` | Optional | Optional | Promote or unpromote the article. |
| `--user-segment-id <id\|null>` | Optional | Optional | One viewing user segment, or `null` for public access. |
| `--user-segment-ids <id>` | Optional | Optional | Viewing user segment; repeat the option for multiple segments. |
| `--notify-subscribers[=true\|false]` | Optional | Not supported | Notify subscribers when creating the article; defaults to false. |

Examples:

```bash
zendesk articles create \
  --section 456 \
  --title "Reset your password" \
  --body-file reset-password.html \
  --dry-run

zendesk articles update 789 \
  --title "Reset your account password" \
  --body-file reset-password.html \
  --labels account --labels security \
  --dry-run

zendesk articles publish 789 --yes
```

## The Article Update Gotcha

Zendesk's article update endpoint only changes article-level metadata. It does not change the title, body, locale, or draft state; those fields belong to a translation resource.

The CLI deliberately hides that API detail. `zendesk articles update` splits one human-facing edit into labeled metadata and localized-content requests. `categories update` and `sections update` follow the same rule for localized names and descriptions. There is no `translate` command for ordinary editing.

Zendesk does not provide transactions across those requests. Metadata is updated first, then localized content. If the second request fails, the CLI reports the failure but cannot roll back the first request.

Articles using reusable content blocks have additional Help Center API limitations. Inspect a dry run and test against a non-production article before bulk edits.

## Global Options

| Option | Purpose |
| --- | --- |
| `--profile <name>` | Select a saved profile. |
| `--format <json|pretty|human>` | Select compact JSON (default), highlighted JSON, or human output. |
| `--color <auto|always|never>` | Control color in pretty and human output; default `auto`. |
| `--quiet`, `-q` | Suppress progress and notices. |
| `--verbose`, `-v` | Write redacted diagnostics to stderr. |
| `--no-input` | Never prompt. |
| `--timeout <duration>` | Set the per-request timeout; default `30s`. |
| `--help`, `-h` | Show local help without network access. |
| `--version` | Show the executable name and version. |

Provider credential and locale options are accepted only by commands that use them. Pagination (`--all`, `--max-items`), preview (`--dry-run`), confirmation (`--yes`, `-y`), and file input (`--file`) are command-specific.

## Raw API Access

Use the raw escape hatch for Zendesk endpoints or fields without a first-class command:

```bash
zendesk api request GET /api/v2/help_center/articles --query per_page=100
zendesk api request PUT /api/v2/help_center/articles/789 \
  --file request.json \
  --dry-run
```

Exact query names, including bracketed cursor parameters, use repeatable `--query`:

```bash
zendesk api request GET /api/v2/help_center/articles \
  --query 'page[size]=100' \
  --query 'page[after]=CURSOR'
```

## Development

```bash
bun run check
bun test
bun run build
```

The CLI requires Node.js 20 or newer and has no runtime dependencies.

## API References

- [Zendesk Help Center API](https://developer.zendesk.com/api-reference/help_center/help-center-api/introduction/)
- [Articles API](https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/)
- [Translations API](https://developer.zendesk.com/api-reference/help_center/help-center-api/translations/)
- [Zendesk API authentication](https://developer.zendesk.com/api-reference/introduction/security-and-auth/)
