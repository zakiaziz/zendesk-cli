#!/usr/bin/env node
import { CliError, asCliError } from "./errors.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { Writable } from "node:stream";
import { getGlobalOptions, getString, parseArgs } from "./args.js";
import { loadRuntimeContext } from "./auth.js";
import {
  configDir,
  configGet,
  configPath,
  configSet,
  configUnset,
  deleteProfile,
  getActiveProfileName,
  listProfiles,
  profilePath,
  readConfig,
  readProfile,
  requireProfile,
  setActiveProfileName,
  showProfile,
  writeProfile,
} from "./config.js";
import { executeAllPages, executeRequest, buildRequestPlan, ProviderError, renderDryRun, resumeRequest } from "./http.js";
import { help, commandHelp, completionScript, validateCommand } from "./commands.js";
import { buildKnowledgeOperation } from "./knowledge.js";
import { configureOutput, printError, printJson, printRaw, printRedacted, printResult, printText } from "./output.js";
import type { GlobalOptions, HttpMethod, ParsedArgs, Profile, RequestPlan } from "./types.js";
import { assignmentsToQuery, isObject, readJson } from "./values.js";

class PartialFailure extends CliError {
  constructor(
    readonly completed: Array<{ operation?: string; result: unknown }>,
    readonly total: number,
    readonly failedOperation: string,
    readonly causeValue: unknown,
  ) {
    super(`Completed ${completed.length} of ${total} requests; ${failedOperation} failed. No rollback was attempted.`, "PARTIAL_FAILURE", 8);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  preconfigureOutput(argv);
  const parsed = parseArgs(argv);
  const options = getGlobalOptions(parsed);
  configureOutput(options.format, options.color);
  if (options.verbose) process.stderr.write(JSON.stringify({ diagnostic: { profile: options.profile ?? "active", format: options.format } }) + "\n");

  if (options.version) {
    printText(version());
    return;
  }
  if (options.help || parsed.command.length === 0) {
    printText(parsed.command.length > 0 ? commandHelp(parsed.command) : help());
    return;
  }

  if (options.profile && parsed.command[0] !== "setup" && !readProfile(options.profile)) throw new CliError("Selected profile does not exist", "CONFIGURATION_ERROR", 3);
  await dispatch(parsed, options);
}

async function dispatch(parsed: ParsedArgs, options: GlobalOptions): Promise<void> {
  const [group, action] = parsed.command;
  if (options.maxItems !== undefined && !options.all) throw new CliError("--max-items requires --all");

  if (group === "setup") {
    await runSetup(parsed);
    return;
  }
  if (group === "profiles") {
    runProfiles(parsed, options);
    return;
  }
  if (group === "config") {
    runConfig(parsed);
    return;
  }
  if (group === "auth") {
    await runAuth(parsed, action, options);
    return;
  }
  if (group === "completions") {
    runCompletions(parsed, action);
    return;
  }
  if (group === "api" && action === "request") {
    await runApiRequest(parsed, options);
    return;
  }

  validateCommand(parsed.command);
  const cursor = getString(parsed.flags, "cursor");
  if (cursor && (parsed.unknownFlags.length > 0 || options.locale)) throw new CliError("--cursor preserves its original query and cannot be combined with filters, --page-size, or --locale");
  if (cursor && group === "articles" && action === "search") {
    const suppliedSearch = parsed.command.slice(2).join(" ").trim();
    let cursorSearch: string | null;
    try { cursorSearch = new URL(cursor).searchParams.get("query"); }
    catch { throw new CliError("--cursor must be the absolute URL returned in meta.next_cursor"); }
    if (suppliedSearch && suppliedSearch !== cursorSearch) throw new CliError(`Search text "${suppliedSearch}" does not match the cursor query "${cursorSearch ?? ""}". Resume without search text or use the original text.`);
  }
  const context = loadRuntimeContext(options);
  const operation = buildKnowledgeOperation(parsed, options, context);
  if (!operation) throw new CliError(`Unknown command "${parsed.command.join(" ")}". Run zendesk --help.`);
  validateKnowledgeFlags(parsed, operation.mutation, operation.paginated === true);
  if (options.all && !operation.paginated) throw new CliError(`--all is not supported by "${operation.name}"`);
  await confirmMutation(operation.name, operation.mutation, options, context.profileName, parsed.unknownFlags.some(flag => flag.name === "body-file" && flag.value === "-"), operation.plans.map(plan => new URL(plan.url).pathname).join(", "));

  if (options.dryRun) {
    printResult(operation.plans.length === 1
      ? renderDryRun(operation.plans[0] as RequestPlan)
      : { command: operation.name, requests: operation.plans.map(renderDryRun) });
    return;
  }

  if (operation.plans.length === 1) {
    const initial = operation.plans[0] as RequestPlan;
    const cursor = getString(parsed.flags, "cursor");
    const request = cursor ? resumeRequest(initial, cursor) : initial;
    const result = options.all ? await executeAllPages(request, options.maxItems) : await executeRequest(request);
    if (operation.name.endsWith(" get") && (result === null || (isObject(result) && Object.values(result).length === 1 && Object.values(result)[0] === null))) throw new CliError("Requested resource was not returned", "NOT_FOUND", 5);
    printResult(result);
    return;
  }

  const results: Array<{ operation?: string; result: unknown }> = [];
  for (const request of operation.plans) {
    try {
      results.push({ ...(request.label ? { operation: request.label } : {}), result: await executeRequest(request) });
    } catch (error) {
      if (results.length === 0) throw error;
      throw new PartialFailure(results, operation.plans.length, request.label ?? request.method, error);
    }
  }
  printJson({ command: operation.name, results });
}

async function runSetup(parsed: ParsedArgs): Promise<void> {
  if (parsed.command.length > 2) throw new CliError("Usage: zendesk setup [profile] [--subdomain NAME] [--email EMAIL] [--api-token TOKEN]");
  const options = getGlobalOptions(parsed);
  const setupAllowed = new Set([...globalFlags, "profile", "subdomain", "email", "api-token", "oauth-token", "locale", "base-url", "from-env", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
  if (parsed.unknownFlags.length > 0) throw new CliError(`Unknown option --${parsed.unknownFlags[0]?.name}`);
  for (const name of Object.keys(parsed.flags)) if (!setupAllowed.has(name)) throw new CliError(`--${name} is not valid for zendesk setup`);
  if (parsed.command[1] && options.profile && parsed.command[1] !== options.profile) throw new CliError("Setup positional profile conflicts with --profile");
  const profileName = parsed.command[1] ?? options.profile ?? "default";
  if (readProfile(profileName)) throw new CliError("Profile already exists; use profiles update", "CONFLICT", 6);
  const fromEnv = parsed.flags["from-env"] === true;
  let subdomain = options.subdomain ?? (fromEnv ? process.env.ZENDESK_SUBDOMAIN : undefined);
  let email = options.email ?? (fromEnv ? process.env.ZENDESK_EMAIL : undefined);
  let apiToken = options.apiToken ?? (fromEnv ? process.env.ZENDESK_API_TOKEN : undefined);
  let oauthToken = options.oauthToken ?? (fromEnv ? process.env.ZENDESK_OAUTH_TOKEN : undefined);

  if (process.stdin.isTTY && !options.noInput && !isCi() && (!subdomain || (!oauthToken && (!email || !apiToken)))) {
    const rl = createInterface({ input, output });
    try {
      subdomain ??= (await rl.question("Zendesk subdomain (the part before .zendesk.com): ")).trim() || undefined;
      if (!oauthToken) email ??= (await rl.question("Zendesk email: ")).trim() || undefined;
    } finally {
      rl.close();
    }
    if (!oauthToken && !apiToken) apiToken = (await askSecret("Zendesk API token: ")).trim() || undefined;
  }

  if (!subdomain && !options.baseUrl) throw new CliError("Setup needs --subdomain", "CONFIGURATION_ERROR", 3);
  if (!oauthToken && (!email || !apiToken)) {
    throw new CliError("Setup needs --oauth-token, or both --email and --api-token", "CONFIGURATION_ERROR", 3);
  }

  const profile: Profile = {
    ...(subdomain ? { subdomain } : {}),
    ...(email ? { email } : {}),
    ...(apiToken ? { apiToken } : {}),
    ...(oauthToken ? { oauthToken } : {}),
    ...(options.locale ? { defaultLocale: options.locale } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  };
  writeProfile(profileName, profile);
  setActiveProfileName(profileName);
  printJson({ profile: profileName, path: profilePath(profileName), active: true });
}

function runProfiles(parsed: ParsedArgs, options: GlobalOptions): void {
  const action = parsed.command[1];
  const name = parsed.command[2];
  if (parsed.unknownFlags.length > 0) throw new CliError(`Unknown option --${parsed.unknownFlags[0]?.name}`);

  switch (action) {
    case "list":
      assertUtility(parsed, 2, ["profile", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      printJson({ active: getActiveProfileName(), profiles: listProfiles() });
      return;
    case "get":
      assertUtility(parsed, 3, ["profile", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!name) throw new CliError("Usage: zendesk profiles get <name>");
      printRedacted(showProfile(name));
      return;
    case "create":
      if (action === "create" && name && listProfiles().includes(name)) throw new CliError(`Profile "${name}" already exists. Use zendesk profiles update ${name}.`, "CONFLICT", 6);
      assertUtility(parsed, 3, ["profile", "subdomain", "email", "api-token", "oauth-token", "locale", "base-url", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
    case "update": {
      assertUtility(parsed, 3, ["profile", "subdomain", "email", "api-token", "oauth-token", "locale", "base-url", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!name) throw new CliError(`Usage: zendesk profiles ${action} <name> [--subdomain NAME] [--oauth-token TOKEN]`);
      const fields = profileFields(options);
      if (Object.keys(fields).length === 0) throw new CliError(`zendesk profiles ${action} needs at least one profile option`);
      writeProfile(name, { ...(action === "update" ? requireProfile(name) : {}), ...fields });
      printJson({ profile: name, path: profilePath(name) });
      return;
    }
    case "delete":
      assertUtility(parsed, 3, ["profile", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!name) throw new CliError("Usage: zendesk profiles delete <name>");
      deleteProfile(name);
      printJson({ deleted: name });
      return;
    case "use":
      assertUtility(parsed, 3, ["profile", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!name) throw new CliError("Usage: zendesk profiles use <name>");
      requireProfile(name);
      setActiveProfileName(name);
      printJson({ active: name });

      return;
    default:
      throw new CliError("Usage: zendesk profiles <list|get|create|update|delete|use>");
  }
}

function assertUtility(parsed: ParsedArgs, length: number, allowed: readonly string[]): void { if (parsed.unknownFlags.length) throw new CliError("Unknown option --" + parsed.unknownFlags[0]!.name);  if (parsed.command.length !== length) throw new CliError(`Usage: zendesk ${parsed.command.slice(0, length).join(" ")}`); const allowedSet = new Set([...globalFlags, ...allowed]); for (const name of Object.keys(parsed.flags)) if (!allowedSet.has(name)) throw new CliError(`--${name} is not valid for "${parsed.command.join(" ")}"`); }

function runConfig(parsed: ParsedArgs): void {
  const action = parsed.command[1];
  const key = parsed.command[2];

  const value = parsed.command[3];
  switch (action) {
    case "path":
      assertUtility(parsed, 2, ["format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      printJson({ configDir: configDir(), configPath: configPath() });
      return;
    case "list":
      assertUtility(parsed, 2, ["format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      printRedacted(readConfig());
      return;
    case "get":
      assertUtility(parsed, 3, ["format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!key) throw new CliError("Usage: zendesk config get <key>");
      printJson({ key, value: configGet(key) ?? null });
      return;
    case "set":
      assertUtility(parsed, 4, ["format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!key || value === undefined) throw new CliError("Usage: zendesk config set <key> <value>");
      printRedacted(configSet(key, value));
      return;
    case "unset":
      assertUtility(parsed, 3, ["format", "color", "quiet", "verbose", "no-input", "help", "version"]);
      if (!key) throw new CliError("Usage: zendesk config unset <key>");
      printRedacted(configUnset(key));
      return;
    default:
      throw new CliError("Usage: zendesk config <path|list|get|set|unset>");
  }
}

async function runAuth(parsed: ParsedArgs, action: string | undefined, options: GlobalOptions): Promise<void> {
  if (action !== undefined && action !== "verify") throw new CliError("Usage: zendesk auth verify");
  assertUtility(parsed, 2, ["profile", "subdomain", "email", "api-token", "oauth-token", "locale", "base-url", "timeout", "format", "color", "quiet", "verbose", "no-input", "help", "version"]);
  const context = loadRuntimeContext(options);
  const request = buildRequestPlan({ method: "GET", path: "/api/v2/users/me", options, context });
  const result = await executeRequest(request);
  printJson({ ok: true, baseUrl: context.baseUrl, locale: context.locale, ...(isObject(result) ? result : { result }) });
}

async function runApiRequest(parsed: ParsedArgs, options: GlobalOptions): Promise<void> {
  if (options.all || options.maxItems !== undefined) throw new CliError("--all and --max-items are not valid for zendesk api request");
  const method = parsed.command[2]?.toUpperCase() as HttpMethod | undefined;
  const path = parsed.command[3];
  if (!method || !["GET", "POST", "PUT", "DELETE"].includes(method) || !path || parsed.command.length !== 4) {
    throw new CliError("Usage: zendesk api request <GET|POST|PUT|DELETE> </api/path>");
  }
  assertUtility(parsed, 4, ["subdomain", "email", "api-token", "oauth-token", "base-url", "query", ...(method === "GET" ? [] : ["file", "yes", "dry-run"])]);
  const mutation = method !== "GET";
  const context = loadRuntimeContext(options);
  if (parsed.unknownFlags.length > 0) throw new CliError(`Unknown option --${parsed.unknownFlags[0]?.name}. Use repeatable --query key=value.`);
  const body = method === "GET" ? undefined : buildRawBody(options, parsed);
  const query = method === "GET"
    ? assignmentsToQuery(options.query)
    : assignmentsToQuery(options.query);
  const request = buildRequestPlan({ method, path, options, context, query, body });
  await confirmMutation("api request", mutation, options, context.profileName, options.data === "-", new URL(request.url).pathname);
  if (options.dryRun) {
    printResult(renderDryRun(request));
    return;
  }
  printRaw(await executeRequest(request));
}

function validateKnowledgeFlags(parsed: ParsedArgs, mutation: boolean, paginated: boolean): void {
  const allowed = new Set(["profile", "subdomain", "email", "api-token", "oauth-token", "locale", "base-url", "format", "color", "quiet", "verbose", "no-input", "timeout", "help", "version"]);
  if (mutation) {
    allowed.add("yes");
    allowed.add("dry-run");
  }
  if (paginated) {
    allowed.add("all");
    allowed.add("max-items");
    allowed.add("cursor");
  }
  for (const name of Object.keys(parsed.flags)) {
    if (!allowed.has(name)) throw new CliError(`--${name} is not valid for "${parsed.command.join(" ")}"`);
  }
}

function buildRawBody(options: GlobalOptions, parsed: ParsedArgs): unknown {
  if (parsed.unknownFlags.length > 0) throw new CliError("Unknown option --" + parsed.unknownFlags[0]?.name + ". Use --file for a request body.");
  if (options.set.length > 0) throw new CliError("--set is not supported. Use --file for a complete request body.");
  return readJson(options.data);
}

function isCi(): boolean { const value = process.env.CI?.toLowerCase(); return value !== undefined && value !== "" && value !== "0" && value !== "false"; }

async function askSecret(prompt: string): Promise<string> {
  let muted = false;
  const hiddenOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input, output: hiddenOutput, terminal: true });
  try {
    const answer = rl.question(prompt);
    muted = true;
    return await answer;
  } finally {
    rl.close();
    output.write("\n");
  }
}

function profileFields(options: GlobalOptions): Profile {
  return {
    ...(options.subdomain ? { subdomain: options.subdomain } : {}),
    ...(options.email ? { email: options.email } : {}),
    ...(options.apiToken ? { apiToken: options.apiToken } : {}),
    ...(options.oauthToken ? { oauthToken: options.oauthToken } : {}),
    ...(options.locale ? { defaultLocale: options.locale } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  };
}

async function confirmMutation(name: string, mutation: boolean, options: GlobalOptions, profileName?: string, stdinIsContent = false, target = name): Promise<void> {
  if (!mutation || options.yes || options.dryRun) return;
  const ci = process.env.CI?.toLowerCase();
  const blocked = options.noInput || stdinIsContent || !process.stdin.isTTY || (ci !== undefined && ci !== "" && ci !== "0" && ci !== "false");
  if (blocked) throw new CliError(`"${name}" changes Zendesk state. Re-run with --dry-run or --yes.`, "CONFIRMATION_REQUIRED", 9);
  process.stderr.write(`Profile: ${profileName ?? "explicit credentials"}\nTarget: ${target}\nOperation: ${name}\nEffect: changes Zendesk state\n`);
  const readline = createInterface({ input, output: process.stderr });
  try {
    const answer = (await readline.question("Continue? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") throw new CliError(`Confirmation declined for "${name}".`, "CONFIRMATION_DECLINED", 9);
  } finally {
    readline.close();
  }
}

function runCompletions(parsed: ParsedArgs, shell: string | undefined): void {
  assertUtility(parsed, 2, []);
  printText(completionScript(shell));
}

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
    try {
      return `zendesk ${(JSON.parse(readFileSync(path, "utf8")) as { version: string }).version}`;
    } catch {
      continue;
    }
  }
  return "unknown";
}

const globalFlags = ["profile", "format", "color", "quiet", "verbose", "no-input", "timeout", "help", "version"];
function preconfigureOutput(argv: readonly string[]): void {
  let format: GlobalOptions["format"] = "json";
  let color: GlobalOptions["color"] = "auto";
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--") break;
    const [name, inline] = (argv[index] ?? "").split("=", 2);
    const value = inline ?? argv[index + 1];
    if (name === "--format" && (value === "json" || value === "pretty" || value === "human")) format = value;
    if (name === "--color" && (value === "auto" || value === "always" || value === "never")) color = value;
  }
  configureOutput(format, color);
}
process.on("SIGINT", () => { printError("Interrupted", "INTERRUPTED", undefined, { retryable: false }); process.exit(130); });
main().catch((error: unknown) => {
  const failure = asCliError(error);
  const details: Record<string, unknown> = { retryable: false, ...failure.details };
  if (error instanceof PartialFailure) {
    const cause = asCliError(error.causeValue);
    Object.assign(details, { completed: error.completed, failed: { operation: error.failedOperation, code: cause.code, message: cause.message, ...cause.details }, total: error.total });
  }
  printError(failure.message, failure.code, undefined, details);
  process.exitCode = error instanceof PartialFailure ? 8 : failure.exitCode;
});
