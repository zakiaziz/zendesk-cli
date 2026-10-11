import { CliError } from "./errors.js";
import { readFileSync } from "node:fs";
import type { UnknownFlag } from "./types.js";

export function parseValue(input: string | boolean): unknown {
  if (typeof input === "boolean") return input;
  const value = input.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value) as unknown;
  }
  return input;
}

export function readJson(source: string | undefined): Record<string, unknown> | unknown[] | undefined {
  if (!source) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(source === "-" ? 0 : source, "utf8")); } catch { throw new CliError("--file must name a readable file containing valid JSON"); }
  if (!isObject(parsed) && !Array.isArray(parsed)) throw new CliError("--file must be a JSON object or array");
  return parsed as Record<string, unknown> | unknown[];
}

export function readContent(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CliError("--body-file requires a path or - for stdin");
  try { return readFileSync(value === "-" ? 0 : value, "utf8"); } catch { throw new CliError("--body-file must name a readable file or - for stdin"); }
}

const repeatableFlags = new Set(["labels", "content-tag-ids", "user-segment-ids"]);

export function flagMap(flags: readonly UnknownFlag[]): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const flag of flags) {
    const typed = new Set(["position", "page-size", "per-page", "page", "draft", "publish", "notify-subscribers", "promoted", "comments-disabled", "clear-labels", "clear-content-tag-ids", "clear-user-segment-ids"]);
    const value = typed.has(flag.name) ? parseValue(flag.value) : flag.value;
    if (!result.has(flag.name)) {
      result.set(flag.name, repeatableFlags.has(flag.name) ? [value] : value);
      continue;
    }
    if (!repeatableFlags.has(flag.name)) throw new CliError(`Option --${flag.name} may only be provided once`);
    (result.get(flag.name) as unknown[]).push(value);
  }
  return result;
}

export function assertAllowedFlags(flags: ReadonlyMap<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...flags.keys()].filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new CliError(`Unknown option ${unknown.map((key) => `--${key}`).join(", ")}. Allowed: ${allowed.map((key) => `--${key}`).join(", ")}`);
  }
}

export function requireString(flags: ReadonlyMap<string, unknown>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || value.length === 0) throw new CliError(`Missing required --${name}`);
  return value;
}

export function optionalString(flags: ReadonlyMap<string, unknown>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CliError(`--${name} requires a value`);
  return value;
}

export function csv(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") throw new CliError("Expected a comma-separated list");
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function integer(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliError(`--${name} must be an integer`);
  return parsed;
}

export function boolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new CliError(`--${name} must be true or false`);
  return value;
}

export function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

export function assignmentsToQuery(assignments: readonly string[]): URLSearchParams {
  const result = new URLSearchParams();
  for (const assignment of assignments) {
    const [key, ...rest] = assignment.split("=");
    if (!key || rest.length === 0) throw new CliError(`Invalid query parameter "${assignment}". Use key=value.`);
    result.append(key, rest.join("="));
  }
  return result;
}

export function unknownFlagsToQuery(flags: readonly UnknownFlag[]): Record<string, string> {
  return Object.fromEntries(flags.map((flag) => [kebabToSnake(flag.name), String(parseValue(flag.value))]));
}

export function unknownFlagsToBody(flags: readonly UnknownFlag[]): Record<string, unknown> {
  return Object.fromEntries(flags.map((flag) => [kebabToSnake(flag.name), parseValue(flag.value)]));
}

export function applyAssignments(target: Record<string, unknown>, assignments: readonly string[]): void {
  for (const assignment of assignments) {
    const [key, ...rest] = assignment.split("=");
    if (!key || rest.length === 0) throw new CliError(`Invalid assignment "${assignment}". Use path=value.`);
    setPath(target, key, parseValue(rest.join("=")));
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /token|secret|password|authorization/i.test(key) ? "[redacted]" : redact(child),
  ]));
}

function kebabToSnake(value: string): string {
  return value.replaceAll("-", "_");
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.some(part => !part || ["__proto__", "constructor", "prototype"].includes(part))) throw new CliError("Invalid assignment path");
  if (parts.length === 0) throw new CliError("Assignment path cannot be empty");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) as string] = value;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
