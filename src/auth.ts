import { CliError } from "./errors.js";
import { getActiveProfileName, readConfig, readProfile } from "./config.js";
import type { GlobalOptions, ResolvedAuth, RuntimeContext } from "./types.js";

export function loadRuntimeContext(options: GlobalOptions): RuntimeContext {
  const profileName = options.profile ?? process.env.ZENDESK_PROFILE ?? getActiveProfileName();
  const profile = readProfile(profileName);
  if (profileName && !profile) throw new CliError(`Profile "${profileName}" does not exist`, "CONFIGURATION_ERROR", 3);
  const config = readConfig();
  const baseUrl = options.baseUrl
    ?? subdomainUrl(options.subdomain)
    ?? process.env.ZENDESK_BASE_URL
    ?? subdomainUrl(process.env.ZENDESK_SUBDOMAIN)
    ?? profile?.baseUrl
    ?? subdomainUrl(profile?.subdomain)
    ?? config.baseUrl;
  const locale = options.locale ?? process.env.ZENDESK_LOCALE ?? profile?.defaultLocale ?? config.defaultLocale ?? "en-us";

  if (!baseUrl) {
    throw new CliError("Zendesk subdomain is missing. Run zendesk setup or set ZENDESK_SUBDOMAIN.", "CONFIGURATION_ERROR", 3);
  }

  return {
    profileName,
    profile,
    baseUrl: validateBaseUrl(baseUrl),
    locale,
  };
}

export function resolveAuth(options: GlobalOptions, context: RuntimeContext): ResolvedAuth {
  if (options.oauthToken) {
    return {
      kind: "oauth",
      source: "--oauth-token",
      authorization: `Bearer ${options.oauthToken}`,
    };
  }

  if (options.apiToken || options.email) {
    return apiTokenAuth(
      options.apiToken ?? process.env.ZENDESK_API_TOKEN ?? context.profile?.apiToken,
      options.email ?? process.env.ZENDESK_EMAIL ?? context.profile?.email,
      "command line",
    );
  }

  if (process.env.ZENDESK_OAUTH_TOKEN) {
    return { kind: "oauth", source: "ZENDESK_OAUTH_TOKEN", authorization: `Bearer ${process.env.ZENDESK_OAUTH_TOKEN}` };
  }
  if (process.env.ZENDESK_API_TOKEN || process.env.ZENDESK_EMAIL) {
    return apiTokenAuth(process.env.ZENDESK_API_TOKEN, process.env.ZENDESK_EMAIL, "environment");
  }
  if (context.profile?.oauthToken) {
    return { kind: "oauth", source: `profile:${context.profileName}`, authorization: `Bearer ${context.profile.oauthToken}` };
  }
  return apiTokenAuth(context.profile?.apiToken, context.profile?.email, `profile:${context.profileName}`);
}

function apiTokenAuth(apiToken: string | undefined, email: string | undefined, source: string): ResolvedAuth {
  if (!apiToken || !email) {
    throw new CliError("Zendesk credentials are missing. Provide an OAuth token, or both email and API token. Run zendesk setup.", "AUTHENTICATION_REQUIRED", 3);
  }
  return {
    kind: "api-token",
    source,
    authorization: `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`,
  };
}

function subdomainUrl(subdomain: string | undefined): string | undefined {
  if (!subdomain) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(subdomain)) {
    throw new CliError("Zendesk subdomain must be the account name only, for example 'acme', not a URL.");
  }
  return `https://${subdomain}.zendesk.com`;
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError("Base URL must be an absolute HTTP(S) URL", "CONFIGURATION_ERROR", 3); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new CliError("Base URL cannot contain credentials, query, or fragment", "CONFIGURATION_ERROR", 3);
  return url.toString().replace(/\/$/, "");
}
