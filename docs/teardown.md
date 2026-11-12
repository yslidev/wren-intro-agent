# Reverse-engineering iMessage matchmaking agents (Ditto) for hiring

Notes on how Ditto-style agents work, collected from public sources. Each behavior is mapped to how Wren does the same thing for job intros. None of this comes from inside Ditto; where a point is inference, it says so.

## What Ditto is, publicly

- An AI matchmaker for college students that lives in iMessage. There's no app to swipe in: you text your preferences, and once a week (Wednesday) Ditto texts you one curated match and plans the date. It raised $9.2M. ([IT Brief](https://itbrief.news/story/ditto-raises-usd-9-2m-for-ai-imessage-dating-push), [Medium](https://medium.com/reflections-and-realities/ditto-built-an-ai-that-just-sends-you-on-dates-afb119bc5252))
- Its roadmap, as profiled: dates, then friends, then **job intros**. ([yespress](https://yespress.io/ditto))
- It grew through group chats: it launched at UC San Diego and spread through sorority group threads. ([yespress](https://yespress.io/ditto))
- Linq, an iMessage API provider, uses Ditto as its example of an agent working in group chats. Linq reports 12,000+ dates and 70% of users getting a first date within two days. ([Linq blog](https://linqapp.com/blog/building-ai-agents-that-work-in-group-chats))

## The group-chat intro pattern

From Linq's write-up of how matchmaking agents use group threads:

1. **Create a group** with both matched people and the agent's number.
2. **Brand it**: a custom group name and icon (for Ditto, a date card).
3. **Warm up** the conversation: the agent introduces each person to the other.
4. **Propose logistics**: a time and a place.
5. **Step back.** Once the humans are talking, the agent goes quiet.

Wren follows the same steps. `Agent.connect()` creates the group (`POST /v3/chats` with both handles), names it "Alex + Sam (Marigold)" with `PUT /v3/chats/{id}`, and sends three texts: "Sam, meet Alex…", "Alex, meet Sam…", and "Already settled: pay, setup, Sam's open times. I'll let you two take it from here."

## The gate: deciding whether to speak before deciding what to say

A 1:1 agent answers everything. In a group, most messages are humans talking to each other. Linq's recommended architecture separates these two decisions:

- A **cheap, fast classifier** labels each group message `respond`, `react` or `ignore`. It responds when the agent is named (including misspellings, "bot", "AI"), when someone asks it something, or when someone continues a thread it started. It reacts to a short thanks or a laugh. It ignores human-to-human chat.
- Only a `respond` reaches the main reply prompt, which gets the history with each line labeled by sender.
- To make the agent quieter or chattier, tune the gate, not the main prompt.

Wren's version is `Brain.gate()`, with a rule-based fallback in `text.ts`. Wren also has one rule specific to hiring: if a message **confirms a time** ("Thursday 10 works"), it overrides the gate. Wren then posts "Locked in… Stepping out now" and schedules a follow-up. The tests check that Wren stays silent while Sam proposes times and speaks once Alex confirms one.

## Platform constraints that shape the product

From Linq's API reference:

- **No links in the first message of a new chat** (error `1005`). The opener has to be plain text, so Wren's opener is the intro itself. Links can go in later messages.
- Chats are keyed on `from` plus the exact set of recipients. A second intro between the same two people reuses the same group **unless the group has a display name**. Naming every intro group keeps intros separate.
- Groups need 3 or more participants. Leaving is one-way, and recreating a group with the same people makes a new chat.
- Typing indicators, delivery receipts and read receipts don't work in groups, so don't build on them.
- Webhooks are signed with Standard Webhooks HMAC (`webhook-id.webhook-timestamp.body`). Content is kept for about 24 hours, so store what you need when the webhook arrives.

Photon's free, self-hosted `imessage-kit` runs on your own Mac and reads `chat.db`. It can send DMs and post into existing groups, but it can't create a group. On Photon, Wren falls back to a **relay intro**: each side gets the intro and the other person's number in a DM.

## Why this fits hiring

The best hires often come from a friend saying "you two should meet." That works because the middle person:

1. **Vets both sides** and puts their own name on the intro.
2. **Asks first.** Neither side gets a cold message: double opt-in.
3. **Settles the awkward parts** (pay, timing) before the call.
4. **Gets out of the way**, then checks in afterward.

Job boards removed the middle person so they could scale. Wren puts one back as an agent, with the same behaviors as code:

| Friend behavior | Wren |
|---|---|
| "Maya says you're great" | Every candidate enters with a **vouch** (name, relationship, quote) |
| Asks a few real questions | Three-question interview instead of an application |
| "Here's how I'd describe you, ok?" | Candidate approves the exact **blurb** before any founder sees it |
| Only intros when it's clearly good | Rule-based match with a minimum score; one match at a time |
| Asks both people first | Candidate says yes, then the founder; nobody's details are shared before their yes |
| Starts the group text | iMessage group with both people, named, with pay and setup already settled |
| Doesn't hover | The gate keeps Wren quiet; it speaks to confirm the time, then steps out |
| "How'd it go?" | Follow-up DM to each side; the answers shape the next match |

## Inferred, not confirmed

- Whether Ditto's agent replies to free-form group messages after the intro, or only posts scripted logistics. Linq's post implies the former ("warm up", "suggest a time and place").
- How Ditto handles a decline. Wren asks for the reason privately and never passes it to the other side.
