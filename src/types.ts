export type OutputFormat = "json" | "pretty" | "human";
export type ColorMode = "auto" | "always" | "never";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface UnknownFlag {
  readonly name: string;
  readonly value: string | boolean;
}

export interface ParsedArgs {
  readonly command: string[];
  readonly flags: Record<string, string | boolean | string[]>;
  readonly unknownFlags: UnknownFlag[];
}

export interface Profile {
  readonly subdomain?: string;
  readonly email?: string;
  readonly apiToken?: string;
  readonly oauthToken?: string;
  readonly defaultLocale?: string;
  readonly baseUrl?: string;
}

export interface GlobalOptions {
  readonly profile?: string;
  readonly subdomain?: string;
  readonly email?: string;
  readonly apiToken?: string;
  readonly oauthToken?: string;
  readonly locale?: string;
  readonly baseUrl?: string;
  readonly data?: string;
  readonly set: string[];
  readonly query: string[];
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly all: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly format: OutputFormat;
  readonly color: ColorMode;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly noInput: boolean;
  readonly timeoutMs: number;
  readonly maxItems?: number;
}

export interface ResolvedAuth {
  readonly kind: "api-token" | "oauth";
  readonly source: string;
  readonly authorization: string;
}

export interface RuntimeContext {
  readonly profileName?: string;
  readonly profile?: Profile;
  readonly baseUrl: string;
  readonly locale: string;
}

export interface RequestPlan {
  readonly method: HttpMethod;
  readonly url: string;
  readonly auth: ResolvedAuth;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly label?: string;
  readonly timeoutMs: number;
  readonly maxItems?: number;
}
