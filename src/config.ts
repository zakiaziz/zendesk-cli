import { CliError } from "./errors.js";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Profile } from "./types.js";
import { isObject, parseValue, redact } from "./values.js";

export interface AppConfig {
  readonly activeProfile?: string;
  readonly baseUrl?: string;
  readonly defaultLocale?: string;
  readonly [key: string]: unknown;
}

export function configDir(): string {
  const configured = process.env.XDG_CONFIG_HOME;
  return join(configured && isAbsolute(configured) ? configured : join(homedir(), ".config"), "zendesk");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function profilesDir(): string {
  return join(configDir(), "profiles");
}

export function profilePath(name: string): string {
  assertProfileName(name);
  return join(profilesDir(), `${name}.json`);
}

export function readConfig(): AppConfig {
  const value = existsSync(configPath()) ? readJsonFile<AppConfig>(configPath()) : {};
  validateFields(value, ["activeProfile", "baseUrl", "defaultLocale"], 3);
  return value;
}

export function writeConfig(config: AppConfig): void {
  writeSecureJson(configPath(), config);
}

export function getActiveProfileName(): string | undefined {
  return readConfig().activeProfile;
}

export function setActiveProfileName(name: string): void {
  assertProfileName(name);
  writeConfig({ ...readConfig(), activeProfile: name });
}

export function listProfiles(): string[] {
  if (!existsSync(profilesDir())) return [];
  return readdirSync(profilesDir()).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort();
}

export function readProfile(name: string | undefined): Profile | undefined {
  if (!name || !existsSync(profilePath(name))) return undefined;
  const profile = readJsonFile<Profile>(profilePath(name));
  validateFields(profile, profileKeys, 3);
  return profile;
}

export function requireProfile(name: string): Profile {
  const profile = readProfile(name);
  if (!profile) throw new CliError(`Profile "${name}" does not exist`, "NOT_FOUND", 5);
  return profile;
}

export function writeProfile(name: string, profile: Profile): void {
  validateFields(profile, profileKeys, 2);
  writeSecureJson(profilePath(name), profile);
}

export function deleteProfile(name: string): void {
  const path = profilePath(name);
  if (!existsSync(path)) throw new CliError(`Profile "${name}" does not exist`, "NOT_FOUND", 5);
  if (getActiveProfileName() === name) throw new CliError("Select another profile or unset activeProfile before deleting the active profile", "CONFLICT", 6);
  rmSync(path);
}

export function showProfile(name: string): unknown {
  return redact(requireProfile(name));
}

export function configGet(path: string): unknown {
  assertConfigKey(path);
  let current: unknown = readConfig();
  for (const part of path.split(".").filter(Boolean)) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

export function configSet(path: string, raw: string): AppConfig {
  assertConfigKey(path);
  if (!raw) throw new CliError("Configuration value must not be empty");
  if (path === "activeProfile") requireProfile(raw);
  validateFields({ [path]: raw }, [path], 2);
  const config = { ...readConfig() };
  setPath(config, path, raw);
  writeConfig(config);
  return config;
}

export function configUnset(path: string): AppConfig {
  assertConfigKey(path);
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new CliError("Config key cannot be empty");
  const config = { ...readConfig() };
  let cursor: Record<string, unknown> = config;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) return config;
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[parts.at(-1) as string];
  writeConfig(config);
  return config;
}

function writeSecureJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(configDir(), 0o700);
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readJsonFile<T>(path: string): T {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(value)) throw new Error("object required");
    return value as T;
  } catch { throw new CliError("Cannot read configuration object at " + path, "CONFIGURATION_ERROR", 3); }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new CliError("Config key cannot be empty");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) as string] = value;
}

function assertProfileName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new CliError("Profile names may only contain letters, numbers, dots, underscores, and hyphens");
  }
}

function assertConfigKey(key: string): void {
  if (!["activeProfile", "baseUrl", "defaultLocale"].includes(key)) throw new CliError("Unknown configuration key; use activeProfile, baseUrl, or defaultLocale");
}

const profileKeys = ["subdomain", "email", "apiToken", "oauthToken", "defaultLocale", "baseUrl"];
function validateFields(value: object, allowed: readonly string[], exit: number): void {
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.includes(key) || typeof field !== "string" || !field) throw new CliError("Configuration fields must be recognized nonempty strings", "CONFIGURATION_ERROR", exit);
    if (key === "baseUrl") {
      let url: URL;
      try { url = new URL(field); } catch { throw new CliError("baseUrl must be an absolute HTTP(S) URL", "CONFIGURATION_ERROR", exit); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new CliError("baseUrl must use HTTP(S) without credentials, query, or fragment", "CONFIGURATION_ERROR", exit);
    }
  }
}
