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

### Linq + Render (cloud lines, real group chats)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yslidev/wren-intro-agent)

1. **Deploy.** Click the button and sign in to Render with GitHub. The blueprint creates a free web service and generates an `ADMIN_TOKEN`. Leave the Linq fields empty for now; the service boots in simulator mode until they're set. Check it at `https://<your-service>.onrender.com/healthz`.
2. **Get a Linq line.** Start the free 7-day sandbox at [linqapp.com/lp/try-linq](https://linqapp.com/lp/try-linq). Copy your API token from the dashboard, then find your line's number:
   ```bash
   LINQ_API_TOKEN=... node scripts/linq.mjs numbers
   ```
3. **Point Linq at Render.** This prints the webhook signing secret once:
   ```bash
   LINQ_API_TOKEN=... LINQ_FROM_NUMBER=+1... node scripts/linq.mjs subscribe https://<your-service>.onrender.com
   ```
4. **Switch to Linq.** In Render > Environment, set `LINQ_API_TOKEN`, `LINQ_FROM_NUMBER` and `LINQ_WEBHOOK_SECRET`, plus `ANTHROPIC_API_KEY` if you want Claude writing the texts. Render redeploys, and `/healthz` should then say `"transport":"linq"`.
5. **Add real people who agreed to be texted** (yourself as the candidate, a founder friend as the other side), then have Wren text first:
   ```bash
   H=https://<your-service>.onrender.com; T=<ADMIN_TOKEN from Render>
   curl -X POST $H/api/people -H "x-admin-token: $T" -H "content-type: application/json" -d '{
     "role":"candidate","name":"Your Name","handle":"+1YOURNUMBER",
     "vouch":{"name":"A friend","relation":"worked with you at X","quote":"someone who ships"},
     "candidate":{"title":"PM","years":5,"skills":["payments","growth"]}}'
   curl -X POST $H/api/people -H "x-admin-token: $T" -H "content-type: application/json" -d '{
     "role":"founder","name":"Founder Friend","handle":"+1THEIRNUMBER",
     "founder":{"company":"Acme","stage":"seed","sector":"fintech","roleTitle":"First PM","bandK":[170,200],"equity":"1%",
       "setup":"remote","mustHaves":["payments","growth"],"problem":"activation is flat","slots":["Thu 10:00 AM PT","Fri 2:00 PM PT"]}}'
   curl -X POST $H/api/kickoff/<candidate id from the first response> -H "x-admin-token: $T"
   ```
   Reply to Wren from your phone. Once you approve your blurb, it proposes the founder, texts them, and starts the group chat when you've both said yes.

How Linq's rules are handled:
- **No links in a new chat's first message.** Wren's opener never contains one.
- **Every intro group gets a name**, so two intros between the same people stay separate threads.
- **Webhooks are verified** with Standard Webhooks HMAC and deduplicated by `event_id`.
- **STOP and the other carrier keywords** silence Wren until the person texts again.
- **With real numbers, every read and admin endpoint requires `ADMIN_TOKEN`.**

Caveats:
- **Render's free tier sleeps after 15 idle minutes,** so the first text after a quiet spell can take about a minute.
- **State is lost on every restart and deploy,** because the disk is temporary. Add a Render disk at `/app/data/runtime`, or Postgres, before relying on it.
- **Linq's sandbox may limit or simulate messaging.** Real outbound iMessage needs a live Linq plan.

### Photon (free, on your own Mac)
```bash
npm i @photon-ai/imessage-kit better-sqlite3
TRANSPORT=photon npm start
```
Give your terminal Full Disk Access first. The local kit can text people and post into existing groups, but it can't create a group, so on Photon Wren sends a **relay intro**: each person gets the intro and the other's number by DM.

## Deploy

- **GitHub Pages** (static demo): `.github/workflows/pages.yml` runs `npm run build:web` and publishes `site/` on every push to `main`.
- **Render** (the webhook server): `render.yaml` is the one-click blueprint behind the button above.
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
Founder-side onboarding over text, real calendar booking, a database, per-intro consent logging, and an admin UI for adding people and vouches.

## License
MIT
