# Command specifications

These specifications follow [`cli-conventions.md`](cli-conventions.md).

## Knowledge resources

```yaml
commands:
  - command: zendesk categories get|create|update|delete
    arguments: [category-id for get/update/delete]
    options: [name, description, position, include]
    authentication: selected profile or explicit Zendesk credentials
    effects: reads for get; confirmed remote mutations for create/update/delete
    output: category object in data; empty meta
    pagination: not-applicable
    failures: [INVALID_ARGUMENT, AUTHENTICATION_FAILED, PERMISSION_DENIED, NOT_FOUND, CONFLICT]
    retry: no automatic retries
    compatibility: canonical spelling; no aliases
    exceptions: []
  - command: zendesk sections list|get|create|update|delete
    arguments: [section-id for get/update/delete]
    options: [category, name, description, position, parent-section-id, sorting, theme-template, include, all, max-items]
    authentication: selected profile or explicit Zendesk credentials
    effects: reads for list/get; confirmed remote mutations otherwise
    output: section object or section array in data; continuation in meta
    pagination: one page by default; all follows provider links; max-items stops at a resumable page boundary
    failures: [INVALID_ARGUMENT, AUTHENTICATION_FAILED, PERMISSION_DENIED, NOT_FOUND, CONFLICT, SERVICE_UNAVAILABLE]
    retry: no automatic retries
    compatibility: canonical spelling; no aliases
    exceptions: []
  - command: zendesk articles list|search|get|create|update|publish|unpublish|archive
    arguments: [article-id for get/update/publish/unpublish/archive]
    options: [section, category, labels, title, body-file, draft, publish, all, max-items]
    authentication: selected profile or explicit Zendesk credentials
    effects: reads for list/search/get; confirmed remote mutations otherwise
    output: article object or article array in data; continuation in meta
    pagination: one page by default; all follows provider links; max-items stops at a resumable page boundary
    failures: [INVALID_ARGUMENT, AUTHENTICATION_FAILED, PERMISSION_DENIED, NOT_FOUND, CONFLICT, PARTIAL_FAILURE]
    retry: no automatic retries
    atomic: update can issue metadata and translation requests; partial completion exits 8 without rollback
    compatibility: canonical spelling; no aliases
    exceptions: []
```

## Utility and raw commands

```yaml
commands:
  - command: zendesk profiles list|get|create|update|delete|use
    authentication: local configuration
    effects: local reads and local configuration writes
    output: profile data with credentials redacted
    pagination: not-applicable
    failures: [INVALID_ARGUMENT, AUTHENTICATION_FAILED]
    retry: not-applicable
    compatibility: canonical spelling; no aliases
    exceptions: []
  - command: zendesk auth verify
    authentication: selected profile or explicit Zendesk credentials
    effects: remote read of /api/v2/users/me
    output: authenticated user response in data
    pagination: not-applicable
    failures: [AUTHENTICATION_FAILED, PERMISSION_DENIED, SERVICE_UNAVAILABLE]
    retry: no automatic retries
    compatibility: no deprecated aliases
    exceptions: [CLI-RETRY-1 safe-read retries deferred because Zendesk retry guidance needs a shared bounded backoff policy]
  - command: zendesk api request METHOD PATH
    arguments: [method, same-origin-api-path]
    options: [query, file, yes, dry-run]
    authentication: selected profile or explicit Zendesk credentials
    effects: GET is a read; other supported methods require confirmation
    output: provider response shape is preserved
    pagination: caller-managed
    failures: [INVALID_ARGUMENT, AUTHENTICATION_FAILED, PERMISSION_DENIED, NOT_FOUND, CONFLICT, SERVICE_UNAVAILABLE]
    retry: no automatic retries
    compatibility: canonical spelling; no aliases
    exceptions: []
```

## Partial completion schema

Article, category, and section updates can issue separate metadata and localized-content requests. If a later request fails, the command exits `8` and writes one structured error document. `error.completed` contains each completed step and its provider response. `error.failed` identifies the failed operation and message. `error.total` gives the planned step count. Provider `status`, `provider_code`, and `request_id` appear when available. The CLI does not roll back completed requests, and `retryable` remains `false` because repeating the whole mutation can duplicate effects.
