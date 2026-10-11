import { redact } from "./values.js";
import type { ColorMode, OutputFormat } from "./types.js";

let format: OutputFormat = "json";
let color: ColorMode = "auto";

export function configureOutput(selectedFormat: OutputFormat, selectedColor: ColorMode): void {
  format = selectedFormat;
  color = selectedColor;
}

export function printJson(value: unknown): void {
  printResult(value);
}

export function printText(value: string): void {
  process.stdout.write(`${value}\n`);
}

export function printResult(value: unknown): void {
  printValue({ data: extractData(value), meta: extractMeta(value) });
}

export function printRaw(value: unknown): void {
  printValue(value);
}

export function printRedacted(value: unknown): void {
  printResult(redact(value));
}

export function printError(message: string, code: string, hint?: string, details: Record<string, unknown> = {}): void {
  if (format === "human") {
    process.stderr.write(`${message}${hint ? `\n${hint}` : ""}\n`);
    return;
  }
  process.stderr.write(render({ error: { code, message, ...(hint ? { hint } : {}), ...details } }, process.stderr.isTTY));
}

function printValue(value: unknown): void {
  if (format === "human") {
    process.stdout.write(renderHuman(value));
    return;
  }
  process.stdout.write(render(value, process.stdout.isTTY));
}

function render(value: unknown, terminal: boolean): string {
  const text = JSON.stringify(value, null, format === "pretty" ? 2 : undefined);
  const useColor = format === "pretty" && (color === "always" || (color === "auto" && terminal && !process.env.NO_COLOR));
  if (!useColor) return `${text}\n`;
  const highlighted = text.replace(/("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token, key, string) => {
    const rgb = key ? "88;166;255" : string ? "63;185;80" : ["true", "false", "null"].includes(token) ? "57;197;207" : "210;153;34";
    return "\u001b[38;2;" + rgb + "m" + token + "\u001b[0m";
  });
  return highlighted + "\n";
}

function renderHuman(value: unknown): string {
  const content = value && typeof value === "object" && !Array.isArray(value) && "data" in value
    ? (value as { data: unknown }).data
    : value;
  if (Array.isArray(content)) {
    if (content.length === 0) return "No results.\n";
    const records = content.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    if (records.length !== content.length) return `${content.map(display).join("\n")}\n`;
    const headers = [...new Set(records.flatMap((item) => Object.keys(item)))];
    return `${[headers, ...records.map((item) => headers.map((header) => display(item[header])))].map((row) => row.join("\t")).join("\n")}\n`;
  }
  if (content && typeof content === "object") {
    return `${Object.entries(content as Record<string, unknown>).map(([key, item]) => `${key}: ${display(item)}`).join("\n")}\n`;
  }
  return `${display(content)}\n`;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function extractData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of ["articles", "categories", "sections", "results", "locales", "profiles"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  for (const key of ["article", "category", "section", "translation", "user"]) {
    if (record[key] && typeof record[key] === "object") return record[key];
  }
  return value;
}

function extractMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const collection = ["articles", "categories", "sections", "results", "locales", "profiles"].find(key => Array.isArray(record[key]));
  if (!collection) return {};
  const { [collection]: ignored, ...metadata } = record;
  if (collection === "profiles") return { active: record.active ?? null };
  const links = typeof record.links === "object" && record.links ? record.links as Record<string, unknown> : {};
  const providerMeta = typeof record.meta === "object" && record.meta ? record.meta as Record<string, unknown> : {};
  if (!("next_page" in record) && !("next" in links) && !("has_more" in providerMeta)) return metadata;
  const next = providerMeta.has_more === false ? null : record.next_page ?? links.next ?? null;
  return { ...metadata, next_cursor: next, has_more: providerMeta.has_more ?? next !== null };
}
