import { CliError } from "./errors.js";
import type { GlobalOptions, ParsedArgs, UnknownFlag } from "./types.js";

const valueFlags = new Set([
  "profile",
  "subdomain",
  "email",
  "api-token",
  "oauth-token",
  "locale",
  "base-url",
  "file",
  "format",
  "color",
  "timeout",
  "max-items",
  "cursor",
  "set",
  "query",
]);

const booleanFlags = new Set(["yes", "dry-run", "all", "help", "version", "from-env", "quiet", "verbose", "no-input"]);

const aliases: Record<string, string> = {
  h: "help",
  q: "quiet",
  v: "verbose",
  y: "yes",
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const unknownFlags: UnknownFlag[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--") {
      command.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      command.push(arg);
      continue;
    }

    const token = parseFlagToken(arg);
    if (arg.startsWith("---") || (arg.startsWith("--") && token.name.length === 1) || (!arg.startsWith("--") && !(token.name in aliases))) throw new CliError("Unknown option " + arg);
    const name = arg.startsWith("--") ? token.name : aliases[token.name]!;

    if (booleanFlags.has(name)) {
      if (token.value !== undefined && token.value !== "true" && token.value !== "false") throw new CliError("--" + name + " must be true or false");
      setFlag(flags, name, token.value === undefined || token.value === "true");
      continue;
    }

    if (valueFlags.has(name)) {
      const value = token.value ?? argv[index + 1];
      if (value === undefined || (token.value === undefined && value.startsWith("-") && value !== "-")) {
        throw new CliError(`Missing value for --${name}`);
      }
      if (value === "") throw new CliError("--" + name + " cannot be empty");
      if (token.value === undefined) index += 1;
      setFlag(flags, name, value);
      continue;
    }

    const value = token.value ?? nextFlagValue(argv[index + 1]);
    if (token.value === undefined && value !== true) index += 1;
    unknownFlags.push({ name, value });
  }

  return { command, flags, unknownFlags };
}

export function getGlobalOptions(parsed: ParsedArgs): GlobalOptions {
  return {
    profile: getString(parsed.flags, "profile"),
    subdomain: getString(parsed.flags, "subdomain"),
    email: getString(parsed.flags, "email"),
    apiToken: getString(parsed.flags, "api-token"),
    oauthToken: getString(parsed.flags, "oauth-token"),
    locale: getString(parsed.flags, "locale"),
    baseUrl: getString(parsed.flags, "base-url"),
    data: getString(parsed.flags, "file"),
    set: getStringArray(parsed.flags, "set"),
    query: getStringArray(parsed.flags, "query"),
    yes: getBoolean(parsed.flags, "yes"),
    dryRun: getBoolean(parsed.flags, "dry-run"),
    all: getBoolean(parsed.flags, "all"),
    help: getBoolean(parsed.flags, "help"),
    version: getBoolean(parsed.flags, "version"),
    format: outputFormat(parsed.flags),
    color: colorMode(parsed.flags),
    quiet: getBoolean(parsed.flags, "quiet"),
    verbose: getBoolean(parsed.flags, "verbose"),
    noInput: getBoolean(parsed.flags, "no-input"),
    timeoutMs: durationMs(getString(parsed.flags, "timeout") ?? "30s"),
    ...(getString(parsed.flags, "max-items") ? { maxItems: positiveInteger(getString(parsed.flags, "max-items") as string, "--max-items") } : {}),
  };
}

export function getString(flags: Record<string, string | boolean | string[]>, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.at(-1);
  return undefined;
}

export function getBoolean(flags: Record<string, string | boolean | string[]>, name: string): boolean {
  const value = flags[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

export function getStringArray(flags: Record<string, string | boolean | string[]>, name: string): string[] {
  const value = flags[name];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

function outputFormat(flags: Record<string, string | boolean | string[]>): import("./types.js").OutputFormat {
  const value = getString(flags, "format") ?? "json";
  if (value !== "json" && value !== "pretty" && value !== "human") throw new CliError(`Invalid --format "${value}". Use json, pretty, or human.`);
  if (getBoolean(flags, "quiet") && getBoolean(flags, "verbose")) throw new CliError("--quiet and --verbose cannot be used together");
  return value;
}

function colorMode(flags: Record<string, string | boolean | string[]>): import("./types.js").ColorMode {
  const value = getString(flags, "color") ?? "auto";
  if (value !== "auto" && value !== "always" && value !== "never") throw new CliError(`Invalid --color "${value}". Use auto, always, or never.`);
  return value;
}

function positiveInteger(value: string, name: string): number { const parsed = Number(value); if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) throw new CliError(`${name} must be a positive integer; received "${value}".`); return parsed; }

function durationMs(value: string): number { const match = value.match(/^(\d+)(ms|s|m)$/); if (!match) throw new CliError(`Invalid --timeout "${value}". Use a duration such as 500ms, 30s, or 2m.`); const amount = Number(match[1]); if (amount <= 0) throw new CliError(`Invalid --timeout "${value}". Duration must be positive.`); const result = amount * (match[2] === "m" ? 60000 : match[2] === "s" ? 1000 : 1); if (!Number.isSafeInteger(result) || result > 2147483647) throw new CliError("--timeout exceeds 2147483647ms"); return result; }

function parseFlagToken(arg: string): { name: string; value?: string } {
  const trimmed = arg.replace(/^-+/, "");
  const separator = trimmed.indexOf("=");
  if (separator === -1) return { name: trimmed };
  return { name: trimmed.slice(0, separator), value: trimmed.slice(separator + 1) };
}

function nextFlagValue(value: string | undefined): string | boolean {
  if (value === undefined || (value.startsWith("-") && value !== "-")) return true;
  return value;
}

function setFlag(flags: Record<string, string | boolean | string[]>, name: string, value: string | boolean): void {
  if (name === "query") {
    const current = flags[name];
    if (Array.isArray(current)) {
      current.push(String(value));
      return;
    }
    flags[name] = [String(value)];
    return;
  }
  if (Object.hasOwn(flags, name)) throw new CliError("Option --" + name + " may only be provided once");
  flags[name] = value;
}
