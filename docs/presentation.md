# Wren: what we built and what we changed

A running list for the work-trial presentation. Newest changes at the top of each section.

**Links:** [live demo](https://yushan.li/wren-intro-agent/) · [repo](https://github.com/yslidev/wren-intro-agent) · real iMessage: text **+1 415-603-5536** from a registered number

---

## Features built

### The core experience
- **An iMessage agent that works like a boutique recruiting agency.** One text thread, no app, no job board.
- **Intake on both sides, anthropologist-style.** Wren reads the resume or JD first, then asks for stories, not adjectives: proudest work, what drains you, why you'd leave, what failed in this role before, the honest pitch and catch. The question banks are editable ([`intake.ts`](../src/brain/intake.ts), [`docs/intake.md`](intake.md)).
- **Either side can start.**
  - A candidate texts in: name → hiring or looking? → who vouched for them → resume → four story questions → a blurb they approve.
  - A hiring manager texts in: company → JD → four role questions → a role card they approve → Wren finds a candidate.
- **Double opt-in, asked privately.** Nobody is introduced until both say yes. Candidates stay anonymous to the hiring side until they opt in.
- **The moment of connection is a group chat.** It combines Ditto's ritual with the shape of a friend's intro text:
  1. "setting up your chat..."
  2. A named group: "Riley & Dee 🤝"
  3. An "it's official 🎉" card: when, where, and pay already settled
  4. One warm line on each person, with their vouch
  5. "what day works best?"
- **Wren knows when to stay quiet in the group.** Every message is classified as respond, react or ignore. Wren stays out of the two people's conversation, locks in the time once it's agreed, answers a "thanks" with a ❤️ tapback, then steps out.
- **Follow-up afterwards.** Wren asks each side privately how it went. Declines are never forwarded; Wren asks why, so the next match is better.

### Matching
- **Explainable rules.** Role-family filter, pay floor, work setup, at least two overlapping skills, then a score. Every point comes with a sentence, and those sentences become "why you two".
- **Works in both directions:** finding a role for a candidate, or a candidate for a role.
- **One match at a time, with a minimum bar.** Being selective is what keeps people saying yes.

### Personality
- **Wren's voice:** a matchmaker friend who knows too many founders. Ditto-flavored charm, professional enough to forward to your manager. Copy has variants, and the same style guide goes into Claude's system prompt ([`voice.ts`](../src/brain/voice.ts)).
- **Persona engine.** Fictional recruiters and founders reply in six texting voices: crisp, warm, hype, dry, lowercase, thoughtful. Each has a pickiness level, so they can say yes, no, or "tell me more" ([`personas.ts`](../src/brain/personas.ts)).

### A synthetic world (all fictional, all labeled)
- **42 companies across 13 sectors.**
- **54 hiring contacts:** 28 founders and 26 recruiters (9 at agencies).
- **96 candidates, each with a vouch.**
- **Six hand-written hero personas,** for example Dee, a warm Head of Talent and former teacher who signs off with "onward!", and Hollis, an agency recruiter who uses exclamation points like they're free.
- **Generated reproducibly** by `npm run gen:world`. Phone numbers use the 555-01XX range reserved for fiction.

### Real infrastructure
- **Four interchangeable iMessage connections:**
  - Simulator
  - **Photon Spectrum** (cloud iMessage; live on +1 415-603-5536)
  - Linq (real group chats, signed message notifications)
  - Photon imessage-kit (runs on your own Mac)
- **Claude Haiku 5.5** (`claude-haiku-5-5`) writes the texts when an API key is set: fast, light, and prompted for emotional intelligence. The rule-based version runs without a key.
- **Safety:**
  - Fictional people are never texted over a real network.
  - STOP and the other carrier opt-out words are respected.
  - The admin and read endpoints are locked down whenever real phone numbers are involved.
  - Secrets live only in `.env`, and tests never read it.
- **Deploy:**
  - GitHub Pages for the demo site.
  - A one-click Render deploy for the server, plus a Dockerfile.
  - CI on every push.

### The demo web app
- **Three one-click demos, each driving the real agent code in the browser:**
  - **Candidate demo:** Alex is introduced to Sam.
  - **Recruiter demo:** a stranger texts in cold and lands with Dee, who answers in her own voice.
  - **Hiring demo:** a hiring manager sends a JD, and Wren finds Priya.
- **iPhone-style phones,** a searchable cast of about 160 people, a progress tracker for either side, and an "Inside Wren's head" log of every match score, group-chat call and persona reply.
- **"How it works" and "Decisions" sections** answering the spec: wedge, unit of signal, who initiates, transparency, cold start, what we're not building, and why the moment of connection beats LinkedIn.

---

## Changes we made (and why)

- **The deck explains the product thinking.** It maps the work-trial brief to slides, states the stance (hiring is a human-connection problem), the insight (the best intros come from friends), five design principles, a walkthrough of what each feature does and why, the anti-features, how it was built with AI (prompting, pushback, tools), and what comes next.
- **Presentation deck + leaner web app.** Added an HTML deck at /presentation with a detailed architecture diagram and one-line feature lists, and removed secondary labels and long descriptions from the demo.
- **Wren adapts awkward questions (found testing Haiku live).** Asked "what would make you leave where you are now?" right after someone said they were laid off. Claude now keeps each question's meaning but rewords it to fit the person (e.g. "what would make a next role feel right?"), and acknowledges the feeling first.
- **Switched to a smaller, faster model with emotional intelligence.** Moved from Opus 5.5 to Haiku 5.5 for speed and cost. Added an EQ section to Wren's prompt (read the feeling first, name it once, match the person's pace, deliver a no with care). Rules mode also acknowledges layoffs, stress, busy weeks and excitement before moving on.
- **`.env` has a place for the Claude key** (`ANTHROPIC_API_KEY=`), which was missing.
- **Wren reads intake answers properly (from live testing).** Greetings ("Yo") are no longer taken as names, a late "my name is…" updates the name, a sentence like "I’m open to sth new" is no longer taken as the voucher, and "nobody" is an accepted answer. With an API key, Claude reads these answers; without one, stricter rules do. Match reasons now say "you" when Wren talks to the candidate.
- **Grammar pass on Wren's lines.** Fixed "Hi! I'm Wren 🐦 an AI matchmaker" (missing comma), the doubled "Nice to meet you", and similar run-ons.
- **Smart punctuation from iPhones is understood (live bug).** The first real test on the live line read "I’m Yushan" as the name "I’m", because iPhones send curly apostrophes. Every incoming text is now normalized to plain punctuation, and a test covers it.
- **The candidate's name is hidden until they say yes (privacy fix).** When the hiring side went first, Wren was sending the candidate's name before the candidate agreed. The hiring side now sees the work, and gets the name only after the yes.
- **The group intro is redesigned around the moment of connection.** It moved from three plain lines to the Ditto ritual combined with the shape of a real friend intro.
- **The interview grew from 3 to 4 questions,** adding "what makes you lose track of time / what drains you" (the good-at versus good-for signal). Questions were rewritten as story prompts.
- **A resume step and a hiring-or-looking step** were added to the candidate flow.
- **The employer path was added.** The spec requires that a reviewer can experience the product as a recruiter.
- **Matching got stricter.** It now requires the same role family and at least two shared skills. Before, an engineer could be matched to a PM role on one shared skill.
- **Fictional people are never texted (safety fix).** On the live line, the demo cast could have been texted at fake numbers. Everyone from the seed and world files is now marked fictional.
- **Wren asks a new contact's name.** It used to call strangers "there".
- **Copy polish:**
  - Vouch quotes rewritten as noun phrases ("calls Priya the engineer who…").
  - "a/an iOS" fixed, and "seed-stage" instead of "Seed".
  - The candidate line in the intro reads "Riley recently shipped…".
- **Web app polish:** only new bubbles animate (the old version flickered), the header no longer wraps, and the tracker no longer runs one step behind.
- **Pivots along the way:**
  1. A web prototype with "5 signals and a guaranteed reply".
  2. An iMessage matchmaker inspired by Ditto.
  3. Today's agency-style intake plus a group-chat intro.
- **Infrastructure moves:** started on the simulator, then added Linq and Render, then Photon Spectrum (live on a real number).
