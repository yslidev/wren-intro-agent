import { existsSync, readFileSync } from "node:fs";

// Minimal .env loader so the repo runs with zero extra deps.
// Tests never read local secrets.
if (process.env.NODE_ENV !== "test" && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = (k: string, d = "") => process.env[k]?.trim() || d;

export const config = {
  transport: env("TRANSPORT", "sim") as "sim" | "linq" | "photon" | "spectrum",
  spectrum: {
    projectId: env("PROJECT_ID"),
    projectSecret: env("PROJECT_SECRET"),
    agentNumber: env("SPECTRUM_AGENT_NUMBER"),
  },
  port: Number(env("PORT", "8787")),
  adminToken: env("ADMIN_TOKEN"),
  model: env("WREN_MODEL", "claude-opus-5-5"),
  llmEnabled: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")) && env("LLM", "auto") !== "off",
  linq: {
    token: env("LINQ_API_TOKEN"),
    from: env("LINQ_FROM_NUMBER"),
    webhookSecret: env("LINQ_WEBHOOK_SECRET"),
    groupIcon: env("LINQ_GROUP_ICON_URL"),
    baseUrl: env("LINQ_BASE_URL", "https://api.linqapp.com/api/partner"),
  },
  simAgentHandle: "+15550100000",
  matchDelayMs: Number(env("MATCH_DELAY_MS", "4000")),
  followupDelayMs: Number(env("FOLLOWUP_DELAY_MS", "15000")),
  dataDir: env("DATA_DIR", "data/runtime"),
  /** Load data/world.json (~150 fictional companies, recruiters and candidates). On by default, off in tests. */
  world: env("WORLD", process.env.NODE_ENV === "test" ? "off" : "on") === "on",
  /** How long a simulated recruiter or founder "takes" to text back. */
  personaDelayMs: Number(env("PERSONA_DELAY_MS", "6000")),
};
