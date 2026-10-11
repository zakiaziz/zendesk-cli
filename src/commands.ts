import { listProfiles } from "./config.js";
import { CliError } from "./errors.js";

export type CommandSpecification = { path: string[]; usage: string; purpose: string; options: string[]; example: string; effects: string; pagination?: string };
type Spec = CommandSpecification;
const globalOptions = ["--profile NAME", "--format json|pretty|human (default json)", "--color auto|always|never (default auto)", "--quiet, -q", "--verbose, -v", "--no-input", "--timeout DURATION (default 30s)", "--help, -h", "--version"];
const credentialOptions = ["--subdomain NAME", "--email EMAIL", "--api-token TOKEN", "--oauth-token TOKEN", "--base-url URL"];
const pageOptions = ["--all", "--cursor URL (from meta.next_cursor)", "--page-size N (1..100; default 100)", "--max-items N"];
const mutationOptions = ["--yes, -y", "--dry-run"];
const optionCatalog: Record<string,string> = {
  name:"--name TEXT", description:"--description TEXT", position:"--position N", include:"--include VALUE", category:"--category ID", "parent-section-id":"--parent-section-id ID", sorting:"--sorting VALUE", "theme-template":"--theme-template VALUE", section:"--section ID", labels:"--labels NAME (repeatable)", title:"--title TEXT", "body-file":"--body-file PATH (- reads stdin)", draft:"--draft true|false", publish:"--publish true|false", "notify-subscribers":"--notify-subscribers true|false", "author-id":"--author-id ID", "comments-disabled":"--comments-disabled true|false", "content-tag-ids":"--content-tag-ids ID (repeatable)", "permission-group-id":"--permission-group-id ID", promoted:"--promoted true|false", "user-segment-id":"--user-segment-id ID|null (null clears)", "user-segment-ids":"--user-segment-ids ID (repeatable)", "clear-labels":"--clear-labels (conflicts with --labels)", "clear-content-tag-ids":"--clear-content-tag-ids (conflicts with --content-tag-ids)", "clear-user-segment-ids":"--clear-user-segment-ids (conflicts with --user-segment-ids)", "sort-by":"--sort-by VALUE", "sort-order":"--sort-order VALUE"
};
const exactFields: Record<string,string[]> = {
  "categories list":["sort-by","sort-order","include"], "categories get":["include"], "categories create":["name","description","position"], "categories update":["name","description","position"], "categories delete":[],
  "sections list":["category","sort-by","sort-order","include"], "sections get":["include"], "sections create":["category","name","description","position","parent-section-id","sorting","theme-template"], "sections update":["category","name","description","position","parent-section-id","sorting","theme-template"], "sections delete":[],
  "articles list":["section","category","labels","sort-by","sort-order","include"], "articles search":["category","section","labels","sort-by","sort-order"], "articles get":["include"], "articles create":["section","title","body-file","draft","publish","notify-subscribers","author-id","comments-disabled","content-tag-ids","labels","permission-group-id","position","promoted","user-segment-id","user-segment-ids"], "articles update":["section","title","body-file","draft","publish","author-id","comments-disabled","content-tag-ids","labels","permission-group-id","position","promoted","user-segment-id","user-segment-ids","clear-labels","clear-content-tag-ids","clear-user-segment-ids"], "articles publish":[], "articles unpublish":[], "articles archive":[]
};
const actions: Record<string,string[]> = {
  categories: ["list","get","create","update","delete"],
  sections: ["list","get","create","update","delete"],
  articles: ["list","search","get","create","update","publish","unpublish","archive"],
};
const specs: Spec[] = [];
for (const [resource, verbs] of Object.entries(actions)) for (const action of verbs) {
  const collection = action === "list" || action === "search";
  const mutates = ["create","update","delete","publish","unpublish","archive"].includes(action);
  const id = ["get","update","delete","publish","unpublish","archive"].includes(action) ? " ID" : action === "search" ? " [WORDS]" : "";
  specs.push({ path:[resource,action], usage:`${resource} ${action}${id} [options]`, purpose:`${capital(action)} ${resource}.`, options:[...exactFields[`${resource} ${action}`]!.map(name=>optionCatalog[name]!),...(collection?pageOptions:[]),...(mutates?mutationOptions:[]),...credentialOptions,...globalOptions], example:`zendesk ${resource} ${action}${id ? (action === "search" ? " password" : " 123") : ""}${mutates ? " --dry-run" : " --format pretty"}`, effects:mutates ? "Remote mutation. Confirm interactively or use --yes. --dry-run performs no writes or requests." : "Remote read with no mutation confirmation.", ...(collection ? {pagination:"One page by default. --all follows continuation; --max-items stops without dropping unread items."} : {}) });
}
const utility: Spec[] = [
  {path:["setup"],usage:"setup [PROFILE] --subdomain NAME (--email EMAIL --api-token TOKEN | --oauth-token TOKEN)",purpose:"Create and activate a profile.",options:["--subdomain NAME","--email EMAIL","--api-token TOKEN","--oauth-token TOKEN","--locale LOCALE","--base-url URL","--from-env",...globalOptions],example:"zendesk setup work --subdomain acme --oauth-token TOKEN",effects:"Writes protected local configuration. Existing profiles are not overwritten."},
  ...["list","get","create","update","delete","use"].map((action):Spec=>({path:["profiles",action],usage:`profiles ${action}${action === "list" ? "" : " NAME"}${["create","update"].includes(action)?" [profile options]":""}`,purpose:`${capital(action)} saved profiles.`,options:[...(["create","update"].includes(action)?["--subdomain NAME","--email EMAIL","--api-token TOKEN","--oauth-token TOKEN","--locale LOCALE","--base-url URL"]:[]),...globalOptions],example:`zendesk profiles ${action}${action === "list" ? " --format human" : " work"}`,effects:["create","update","delete","use"].includes(action)?"Writes local configuration only.":"Reads local configuration only."})),
  ...["list","path","get","set","unset"].map((action):Spec=>({path:["config",action],usage:`config ${action}${["get","unset"].includes(action)?" KEY":action === "set"?" KEY VALUE":""}`,purpose:`${capital(action)} tool configuration.`,options:globalOptions,example:`zendesk config ${action}${action === "get"?" activeProfile":action === "set"?" defaultLocale en-us":action === "unset"?" defaultLocale":""}`,effects:["set","unset"].includes(action)?"Writes local configuration only.":"Reads local configuration only."})),
  {path:["auth","verify"],usage:"auth verify [credential options]",purpose:"Verify identity with Zendesk users/me.",options:[...credentialOptions,...globalOptions],example:"zendesk auth verify --profile work",effects:"Performs one remote read. Success proves identity for this endpoint, not complete permission coverage."},
  {path:["locales","list"],usage:"locales list",purpose:"List enabled Help Center locales.",options:[...credentialOptions,...globalOptions],example:"zendesk locales list --format human",effects:"Performs one remote read."},
  {path:["api","request"],usage:"api request <GET|POST|PUT|DELETE> /api/path [options]",purpose:"Send a raw same-origin Zendesk API request.",options:["--query KEY=VALUE (repeatable)","--file PATH (- reads stdin)",...mutationOptions,...credentialOptions,...globalOptions],example:"zendesk api request GET /api/v2/help_center/articles --query per_page=10",effects:"GET reads. Other methods require confirmation. Raw provider JSON shape is preserved."},
  ...["bash","zsh","fish"].map((shell):Spec=>({path:["completions",shell],usage:`completions ${shell}`,purpose:`Print ${shell} completion source.`,options:[],example:`zendesk completions ${shell}`,effects:"Prints text without editing shell files or requesting network data."})),
];
specs.push(...utility);
export const commandSpecifications: readonly CommandSpecification[] = specs;

export function help(): string {
  const roots = unique(specs.map(s=>s.path[0]!));
  return ["zendesk 0.1.0","","Usage: zendesk <resource> <action> [identifier] [options]","","Command groups:",...roots.map(x=>`  ${x}`),"","Commands:",...specs.map(spec=>`  zendesk ${spec.usage.replace(" ID", " <id>")}`),"","Compact uncolored JSON is the default. Use --format pretty or --format human explicitly.","Use zendesk <command> --help for full command help."].join("\n");
}
export function commandHelp(command: readonly string[]): string {
  const commandWords = command.filter(word=>!word.startsWith("-"));
  const matches = specs.filter(spec=>spec.path.every((value,index)=>commandWords[index]===value) || (commandWords.length<=spec.path.length&&commandWords.every((value,index)=>spec.path[index]===value)));
  if (!matches.length) throw new CliError(`Unknown command "${command.join(" ")}". Run zendesk --help.`);
  if (matches.length>1) return [`zendesk ${command.join(" ")}`,"","Commands:",...matches.map(s=>`  zendesk ${s.usage}\n    ${s.purpose}`)].join("\n");
  const s=matches[0]!;
  return [s.purpose,"","Usage:",`  zendesk ${s.usage}`,"","Options:",...(s.options.length?unique(s.options).map(x=>`  ${x}`):["  None."]),"","Output:","  Compact {data,meta} JSON by default; pretty preserves the schema; human uses tables or labeled fields.",...(s.pagination?["","Pagination:",`  ${s.pagination}`]:[]),"","Effects:",`  ${s.effects}`,"","Example:",`  ${s.example}`,"","Failures:","  Exit 2 input; 3 auth/config; 4 permission; 5 missing; 6 conflict; 7 transient; 8 partial completion; 9 confirmation."].join("\n");
}
export function validateCommand(command: readonly string[]): void {
  if (!command.length) return;
  if (["setup","profiles","config","auth","api","completions"].includes(command[0]!)) return;
  const group=command[0]!, action=command[1];
  if (!(group in actions) && group!=="locales") throw new CliError(`Unknown command "${command.join(" ")}". Run zendesk --help.`);
  if (group==="locales") { if(action!=="list"||command.length!==2) throw new CliError("Usage: zendesk locales list"); return; }
  if (!action || !actions[group]!.includes(action)) throw new CliError(`Unknown command "${command.join(" ")}". Run zendesk ${group} --help.`);
  if (action==="search") return;
  const needsId=["get","update","delete","publish","unpublish","archive"].includes(action);
  const expected=needsId?3:2;
  if(command.length!==expected) throw new CliError(`Usage: zendesk ${group} ${action}${needsId?" <id>":""}`);
}
export function completionScript(shell:string|undefined):string {
  const roots=unique(specs.map(s=>s.path[0]!)); const profiles=listProfiles(); const completionActions=Object.fromEntries(roots.map(root=>[root,unique(specs.filter(spec=>spec.path[0]===root).map(spec=>spec.path[1]).filter((value): value is string=>Boolean(value)))])); const opts=unique(specs.flatMap(s=>s.options.map(o=>o.split(" ")[0]!).filter(o=>o.startsWith("--"))));
  if(shell==="bash") return `_zendesk(){ local c=\${COMP_WORDS[COMP_CWORD]} r=\${COMP_WORDS[1]}; if ((COMP_CWORD==1));then COMPREPLY=( $(compgen -W "${roots.join(" ")}" -- "$c") );return;fi; case "$r" in ${Object.entries(completionActions).map(([g,a])=>`${g}) COMPREPLY=( $(compgen -W "${[...a,...opts,...profiles].join(" ")}" -- "$c") );;`).join(" ")} esac; }; complete -F _zendesk zendesk`;
  if(shell==="zsh") return `#compdef zendesk\n_arguments '1:command:(${roots.join(" ")})' '*:action or option:(${unique([...Object.values(completionActions).flat(),...opts,...profiles,"json","pretty","human","auto","always","never"]).join(" ")})'`;
  if(shell==="fish") return [...roots.map(r=>`complete -c zendesk -n '__fish_use_subcommand' -a '${r}'`),...Object.entries(completionActions).flatMap(([g,a])=>a.map(v=>`complete -c zendesk -n '__fish_seen_subcommand_from ${g}' -a '${v}'`)),...opts.map(o=>`complete -c zendesk -l '${o.slice(2)}'`),...["json","pretty","human","auto","always","never","bash","zsh","fish"].map(value=>`complete -c zendesk -a '${value}'`),...profiles.map(p=>`complete -c zendesk -n '__fish_seen_subcommand_from profiles' -a '${p}'`)].join("\n");
  throw new CliError("Usage: zendesk completions <bash|zsh|fish>");
}
function unique<T>(values:readonly T[]):T[]{return [...new Set(values)];}
function capital(value:string):string{return value[0]!.toUpperCase()+value.slice(1);}
