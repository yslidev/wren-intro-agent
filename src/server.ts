import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { config } from "./config.js";

const { app, agent, transport, brain } = buildApp();

await transport.start((e) => agent.handle(e));

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Wren is up on http://localhost:${info.port}  transport=${transport.name}  brain=${brain.enabled ? config.model : "rules (no ANTHROPIC_API_KEY)"}`);
  if (transport.name === "sim") console.log(`Open http://localhost:${info.port}/sim`);
  if (transport.name === "linq") console.log(`Point a Linq webhook subscription at https://<your-host>/webhooks/linq?version=2026-02-03`);
});
