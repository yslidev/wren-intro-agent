#!/usr/bin/env node
// Linq setup helper. Reads LINQ_API_TOKEN from the environment or .env.
//
//   node scripts/linq.mjs numbers                      list the lines on your account (pick LINQ_FROM_NUMBER)
//   node scripts/linq.mjs subscribe https://HOST       point Linq's webhooks at your deployed Wren; prints the signing secret ONCE
//   node scripts/linq.mjs subscriptions                list existing webhook subscriptions
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const token = process.env.LINQ_API_TOKEN;
const base = process.env.LINQ_BASE_URL || "https://api.linqapp.com/api/partner";
if (!token) {
  console.error("Set LINQ_API_TOKEN (in your shell or .env) first. It's in your Linq dashboard.");
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === "numbers") {
  console.log(JSON.stringify(await call("GET", "/v3/phone_numbers"), null, 2));
} else if (cmd === "subscriptions") {
  console.log(JSON.stringify(await call("GET", "/v3/webhook-subscriptions"), null, 2));
} else if (cmd === "subscribe") {
  if (!arg || !arg.startsWith("https://")) {
    console.error("Usage: node scripts/linq.mjs subscribe https://your-wren.onrender.com");
    process.exit(1);
  }
  const target = `${arg.replace(/\/+$/, "")}/webhooks/linq?version=2026-02-03`;
  const sub = await call("POST", "/v3/webhook-subscriptions", {
    target_url: target,
    subscribed_events: ["message.received"],
    ...(process.env.LINQ_FROM_NUMBER ? { phone_numbers: [process.env.LINQ_FROM_NUMBER] } : {}),
  });
  console.log(`Subscribed ${target}`);
  const secret = sub.signing_secret ?? sub.data?.signing_secret;
  if (secret) console.log(`\nSet this as LINQ_WEBHOOK_SECRET on Render now. Linq will not show it again:\n\n  ${secret}\n`);
  else console.log(JSON.stringify(sub, null, 2));
} else {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 6).join("\n").replace(/^\/\/ ?/gm, ""));
}
