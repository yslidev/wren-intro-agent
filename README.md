# Wren: an iMessage agent that makes warm job intros

Wren texts candidates and founders the way a well-connected friend would. It starts from a vouch, asks three questions instead of an application, and suggests one match at a time. It only makes an intro when both people say yes. Then it **starts an iMessage group chat** with both of them, settles pay and timing, and steps out.

The design copies Ditto, an AI matchmaker that runs over iMessage, and applies it to hiring. [`docs/teardown.md`](docs/teardown.md) has the teardown: what Ditto-style agents do in group chats, and how each behavior maps to code here.

**Live demo, no install:** https://yushan.li/wren-intro-agent/ (the full agent runs in your browser on synthetic data. Press **Play the Alex + Sam demo**.)

```
Alex ─┐  vouch from Maya           ┌─ Sam (founder, Marigold)
      │  3-question interview      │
      │  approves own blurb        │
      ▼                            │
   Wren: "I think you should meet Sam. Want an intro?"  ── Alex: yes
                                   ▼
   Wren → Sam: "Alex already said yes. Want the intro?"  ── Sam: yes
                                   ▼
   New group: "Alex + Sam (Marigold)"
     Wren: Sam, meet Alex… / Alex, meet Sam… / pay + times settled, I'll step back
     Sam ↔ Alex talk (Wren's gate: ignore)
     Alex: "Thursday 10 works"  → Wren: "Locked in. Stepping out."  (gate: respond)
     Sam: "@wren thanks!"       → ❤️ tapback                       (gate: react)
   Later, 1:1 to each: "How did it go?"
```

## What's in here

| Path | What it does |
|---|---|
| `src/brain/agent.ts` | The flow: vouch opener, interview, blurb approval, matching, double opt-in, group creation, the group-chat gate, follow-ups |
| `src/brain/llm.ts` | Claude calls (structured outputs) for interview replies, blurbs, pitches, the respond/react/ignore gate and group replies. Every call has a rule-based fallback, so the service runs without an API key |
| `src/brain/match.ts` | Explainable matching: hard filters on pay floor and work setup, then a score where every point has a reason sentence attached. Those sentences become "why you two" |
| `src/transports/` | `sim` (in-memory phones), `linq` (Linq Partner API v3, real iMessage group chats), `photon` (Photon `imessage-kit` on your own Mac) |
| `public/sim.html` | Web simulator: two phones side by side and the agent's decision log |
| `data/seed.json` | Synthetic, pseudonymous people (555-01xx numbers). No real data |
| `test/flow.test.ts` | End-to-end intro, founder decline, matching rules, Linq signature and webhook parsing |

## Run it

```bash
npm install
npm start            # http://localhost:8787/sim
npm test
```

With no `ANTHROPIC_API_KEY`, Wren runs on rules. With a key it uses `claude-opus-5-5` (override with `WREN_MODEL`), and server-side refusal fallbacks are turned on.

## Put it on real iMessage

### Linq (cloud lines, real group chats)
1. Get a Linq Partner API token and a line from Linq (Linq provisions them).
2. Deploy the server (see below), then set `TRANSPORT=linq`, `LINQ_API_TOKEN` and `LINQ_FROM_NUMBER`.
3. Subscribe a webhook. Linq returns the `signing_secret` only once; put it in `LINQ_WEBHOOK_SECRET`.

```bash
curl -X POST https://api.linqapp.com/api/partner/v3/webhook-subscriptions \
  -H "Authorization: Bearer $LINQ_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"target_url":"https://YOUR-HOST/webhooks/linq?version=2026-02-03","subscribed_events":["message.received"]}'
```

4. Start a thread: `curl -X POST https://YOUR-HOST/api/kickoff/c_alex -H "x-admin-token: $ADMIN_TOKEN"`. Swap the seed handles for real numbers of people who agreed to be texted.

Linq rules this code already follows: no links in a new chat's first message; every intro group is named, so two intros between the same people stay separate threads; webhooks are verified with Standard Webhooks HMAC and deduplicated by `event_id`.

### Photon (free, on your own Mac)
```bash
npm i @photon-ai/imessage-kit better-sqlite3
TRANSPORT=photon npm start
```
Give your terminal Full Disk Access first. The local kit can text people and post into existing groups, but it can't create a group, so on Photon Wren sends a **relay intro**: each person gets the intro and the other's number by DM.

## Deploy

- **GitHub Pages** (static demo): `.github/workflows/pages.yml` runs `npm run build:web` and publishes `site/` on every push to `main`.
- **Render** (the webhook server): `render.yaml` is a one-click blueprint. Create a Render service from this repo and fill in the env vars.
- **Anything with Docker**: `docker build -t wren . && docker run -p 8787:8787 --env-file .env wren`.

The store is a JSON file (`data/runtime/state.json`). That's fine for one instance; move it to Postgres before running more than one.

## Product decisions

- **The group chat is the product.** A cold InMail asks a busy person to trust a stranger. A group text from someone who vetted both sides is a warm intro, and both people already said yes.
- **Every candidate starts with a vouch.** Name, relationship and a quote, carried into every pitch, the way a friend would mention who sent them.
- **The candidate approves the exact blurb** before any founder sees it.
- **Hard filters before scores.** Pay and setup are settled before anyone meets, so the first call is about the work.
- **One match at a time, with a minimum score.** Being selective is what keeps founders saying yes to Wren.
- **Decide whether to speak, then what to say.** In a group, most messages are the two humans talking, and Wren ignores those. It speaks when someone names it or confirms a time, and it reacts to a thanks.
- **Declines stay private.** If the founder passes, the candidate hears "it's about their side, not you." Reasons are asked for one-on-one and never forwarded.

## Not built yet
Founder-side onboarding over text, real calendar booking, a database, per-intro consent logging, opt-out keywords (STOP), and an admin UI for adding vouches.

## License
MIT
