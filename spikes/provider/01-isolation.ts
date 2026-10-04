// P0.1: do the isolation flags keep subscription auth working, what do they cost in startup
// latency, and how much hidden context does each variant inject?
// Run: bun spikes/provider/01-isolation.ts
import { callClaude, summary } from "./lib";

const variants: Record<string, { extraArgs: string[]; env?: "inherit" | "scrub" }> = {
  baseline: { extraArgs: [] },
  settingSourcesEmpty: { extraArgs: ["--setting-sources", ""] },
  safeMode: { extraArgs: ["--safe-mode"] },
  restricted: { extraArgs: ["--restricted"] },
  safeMode_settingSources: { extraArgs: ["--safe-mode", "--setting-sources", ""] },
  safeMode_scrubbedEnv: { extraArgs: ["--safe-mode"], env: "scrub" },
};

const out: Record<string, any> = {};
for (const [name, v] of Object.entries(variants)) {
  const r = await callClaude({
    system: "You are a terse assistant.",
    content: "Reply with exactly: pong",
    outputFormat: "stream-json",
    extraArgs: v.extraArgs,
    env: v.env,
  });
  const init = r.events.find((e) => e.type === "system" && e.subtype === "init");
  out[name] = {
    ...summary(r),
    apiKeySource: init?.apiKeySource,
    model: init?.model,
    tools: init?.tools,
    mcpServers: init?.mcp_servers,
    slashCommands: init?.slash_commands?.length,
    skills: init?.skills?.length,
    plugins: init?.plugins,
    memoryPaths: init?.memory_paths,
    initKeys: init ? Object.keys(init) : null,
  };
  console.log(name, JSON.stringify(out[name]));
}
await Bun.write(`${import.meta.dir}/out/01-isolation.json`, JSON.stringify(out, null, 2));
