# Intake: interviewing like an anthropologist

Wren works like a boutique recruiter. Before matching anyone, it gets to know both sides. The goal is to learn what someone is **good at** (their track record) and what they're **good for** (the problems where they'll thrive). A resume and a JD only cover the first.

The questions live in [`src/brain/intake.ts`](../src/brain/intake.ts) and are meant to be edited. Each one names the field it fills and what we're listening for.

## Principles
1. **Take the artifact first.** Read the resume or JD before asking anything, so nobody repeats what's already written down.
2. **Ask for stories, not adjectives.** "Walk me through the last time…" beats "are you a self-starter?"
3. **Ask about failure and friction on purpose.** What drained them, and what went wrong in this role before. That's where the fit signal is.
4. **Mirror the two sides.** What a candidate needs to hear about a role is what we ask the employer, and the reverse.
5. **Practical constraints last,** once there's some trust. Pay and setup are hard filters, and Wren never negotiates them.

## Candidate side (after the resume)
| Field | Question | Listening for |
|---|---|---|
| `proudest` | Walk me through the work you're proudest of from the last couple of years. What was broken before you touched it? | A concrete before and after, their real role versus the team's, scale, how they talk about others |
| `energy` | What kind of problem makes you lose track of time? And what kind quietly drains you? | "Good at" versus "good for" |
| `whyLeave` | What would actually make you leave where you are now? | The real push, which predicts what will make them stay |
| `practical` | Lowest base salary you'd take, and remote, hybrid or in office? | Hard filters |

## Hiring side (after the JD)
| Field | Question | Listening for |
|---|---|---|
| `success` | Picture this person 90 days in, and it went great. What did they ship or change? | The real outcome, which usually isn't the JD's list of requirements |
| `antiPattern` | Has someone done this job before and it didn't work out? What was missing? | The must-have they learned the hard way |
| `pitch` | What's the honest pitch, and the honest catch? | What to tell candidates up front. Candor is what makes the intro trustworthy |
| `practical` | Base range, equity, and remote, hybrid or in office? | Shared with the candidate before anyone meets |

## Open questions to design together
- **Follow-up probes.** Should Wren ask one "tell me more about…" follow-up when an answer is vague? With Claude enabled, the voice guide already nudges toward it.
- **Reverse references.** Should the candidate get one question answered by someone who worked for the hiring manager?
- **Voice calls.** Should intake move to a 10-minute call for niche roles (Photon Spectrum supports calls), with text as the default?
- **Which signals the matcher should weigh.** For example, `energy` is collected but not scored yet.
