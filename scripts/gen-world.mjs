#!/usr/bin/env node
// Generates data/world.json: a large, deterministic, entirely fictional hiring world for Wren.
// Companies, founders, in-house and agency recruiters (each with a texting voice), and candidates
// with vouches. Phone numbers use the 555-01XX range reserved for fiction.
//
//   node scripts/gen-world.mjs            (same seed -> same file, so diffs stay readable)
import { writeFileSync } from "node:fs";

let s = 20261111;
const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const pickN = (a, n) => [...a].sort(() => rand() - 0.5).slice(0, n);
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ---------------------------------------------------------------- phone numbers (fiction range)
const AREAS = ["415", "628", "510", "212", "646", "312", "206", "512", "617", "303"];
const used = new Set();
function phone() {
  for (;;) {
    const n = `+1${pick(AREAS)}55501${String(between(0, 99)).padStart(2, "0")}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
}

// ---------------------------------------------------------------- names
const FIRST = ["Maya", "Theo", "Priyanka", "Diego", "Amara", "Kenji", "Lucia", "Omar", "Ines", "Felix", "Zara", "Malik", "Hana", "Rafael", "Noor", "Elliot", "Sade", "Arjun", "Clara", "Tomas", "Leilani", "Ravi", "Greta", "Kofi", "Mei", "Jonah", "Anouk", "Bilal", "Paloma", "Soren", "Yara", "Dev", "Imani", "Lev", "Rosa", "Kai", "Esme", "Nikhil", "Freya", "Mateo", "Aisha", "Hugo", "Lina", "Tariq", "Wren", "Ozzie", "Bea", "Jun", "Saoirse", "Emeka", "Tova", "Rumi", "Celeste", "Ibrahim", "Vera", "Quinn", "Marisol", "Anders", "Kiri", "Dalia"].filter((n) => n !== "Wren");
const LAST = ["Okafor", "Lindqvist", "Ramirez", "Nakamura", "Haddad", "Osei", "Brennan", "Castellanos", "Iyer", "Moreau", "Achebe", "Kowalski", "Tanaka", "Fischer", "Mensah", "Delgado", "Varga", "Sato", "Abara", "Holm", "Chaudhry", "Ferreira", "Novak", "Quintero", "Adeyemi", "Lund", "Pereira", "Kimura", "Bianchi", "Nwosu", "Albright", "Rahman", "Duarte", "Ishikawa", "Mbeki", "Sorensen", "Vasquez", "Thorne", "Ekwueme", "Laurent"];
const usedNames = new Set(["Alex Rivera", "Priya Raman", "Jordan Lee", "Nina Okafor", "Sam Whitaker", "Chris Bauer", "Ravi Shah", "Mei Tan"]);
function person() {
  for (;;) {
    const first = pick(FIRST), last = pick(LAST), name = `${first} ${last}`;
    if (!usedNames.has(name)) { usedNames.add(name); return { first, name }; }
  }
}

// ---------------------------------------------------------------- the world
const SECTORS = [
  { sector: "payments infrastructure", skills: ["payments", "fintech", "b2b", "risk"], problems: ["chargebacks are eating 3% of revenue", "merchant onboarding takes 11 days", "a third of failed payments are retries nobody owns", "finance closes the books by hand every month"] },
  { sector: "consumer fintech", skills: ["fintech", "consumer", "growth", "onboarding"], problems: ["only 38% of signups ever fund an account", "users love the app and still churn after payday", "KYC drop-off is brutal on mobile"] },
  { sector: "clinical workflow software", skills: ["healthcare", "workflow", "b2b", "compliance"], problems: ["nurses spend three hours a shift charting", "prior authorization takes nine days", "every hospital wants a custom integration"] },
  { sector: "developer tools", skills: ["devtools", "infra", "typescript", "dx"], problems: ["CI takes 40 minutes and everyone knows it", "nobody reads the docs, so support reads them aloud", "the CLI has 200 flags and four of them matter"] },
  { sector: "applied AI", skills: ["ml", "llm", "evals", "python"], problems: ["the agent works in demos and quietly degrades in production", "nobody can say whether the new model is actually better", "inference costs doubled last quarter"] },
  { sector: "climate and energy", skills: ["climate", "hardware", "data", "ops"], problems: ["battery fleet data arrives three days late", "installers schedule jobs over text", "utility interconnection paperwork takes months"] },
  { sector: "logistics", skills: ["logistics", "marketplace", "ops", "payments"], problems: ["carriers wait 30 days to get paid", "dispatchers live in six spreadsheets", "a quarter of trucks drive home empty"] },
  { sector: "consumer social", skills: ["consumer", "growth", "design", "mobile"], problems: ["day-7 retention is stuck at 18%", "the app works but nobody remembers it", "invites convert, but invited users don't stick"] },
  { sector: "education", skills: ["education", "consumer", "design", "growth"], problems: ["teachers spend five hours a week grading", "students finish week one and vanish", "districts buy it, but classrooms don't use it"] },
  { sector: "security", skills: ["security", "infra", "enterprise", "go"], problems: ["alerts outnumber engineers 400 to 1", "access reviews happen once a year and nobody trusts them", "every enterprise deal stalls in the security questionnaire"] },
  { sector: "commerce", skills: ["commerce", "growth", "payments", "data"], problems: ["returns cost more than shipping", "repeat purchase rate dropped after the redesign", "inventory is wrong in three systems at once"] },
  { sector: "future-of-work software", skills: ["workflow", "b2b", "enterprise", "data"], problems: ["onboarding a new hire touches nine tools", "managers can't see who's underwater until they quit", "the product sells well and rolls out badly"] },
  { sector: "creator economy", skills: ["creator", "consumer", "payments", "growth"], problems: ["creators get paid 45 days late", "brand deals still run on DMs and PDFs", "the top 1% of creators drive 80% of revenue"] },
];

const ROLES = [
  { title: "Founding Engineer", fn: ["typescript", "infra", "python", "product"], band: [170, 210], kind: "eng" },
  { title: "Senior Backend Engineer", fn: ["go", "python", "infra", "data"], band: [180, 220], kind: "eng" },
  { title: "Staff Frontend Engineer", fn: ["typescript", "react", "design", "dx"], band: [200, 245], kind: "eng" },
  { title: "ML Engineer", fn: ["ml", "llm", "evals", "python"], band: [190, 240], kind: "eng" },
  { title: "iOS Engineer", fn: ["mobile", "ios", "design", "consumer"], band: [175, 215], kind: "eng" },
  { title: "Founding Product Designer", fn: ["design", "prototyping", "brand", "research"], band: [160, 200], kind: "design" },
  { title: "Senior Product Manager", fn: ["product", "growth", "onboarding", "analytics"], band: [180, 220], kind: "pm" },
  { title: "First PM", fn: ["product", "onboarding", "analytics", "research"], band: [170, 205], kind: "pm" },
  { title: "Head of Growth", fn: ["growth", "analytics", "content", "onboarding"], band: [185, 230], kind: "gtm" },
  { title: "Founding Account Executive", fn: ["sales", "enterprise", "gtm", "b2b"], band: [130, 160], kind: "gtm" },
  { title: "Data Scientist", fn: ["data", "analytics", "python", "ml"], band: [170, 210], kind: "data" },
  { title: "Chief of Staff", fn: ["ops", "strategy", "finance", "recruiting"], band: [160, 200], kind: "ops" },
  { title: "Developer Advocate", fn: ["content", "community", "devtools", "typescript"], band: [150, 185], kind: "gtm" },
];

const STAGES = ["seed", "seed", "series a", "series a", "series b", "series c"];
const SETUPS = ["remote", "remote", "hybrid", "hybrid", "onsite"];
const SLOT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SLOT_TIMES = ["9:00 AM PT", "10:30 AM PT", "11:00 AM PT", "1:00 PM PT", "2:30 PM PT", "4:00 PM PT"];

const NAME_A = ["Bramble", "Tallow", "Copper", "Saltbox", "Quill", "Fernway", "Lantern", "Pebble", "Marlin", "Driftwood", "Kestrel", "Ember", "Juno", "Harbor", "Thistle", "Cobalt", "Orchard", "Sable", "Wicker", "Moss", "Larkspur", "Granite", "Tidepine", "Hollow", "Brightwork", "Paperkite", "Sundial", "Foxglove", "Atlas Fern", "Clover"];
const NAME_B = ["", " Labs", " Health", " Pay", " AI", " Works", " & Co", " Systems", " Cloud", ""];

// Recruiter + founder texting voices. The persona engine (src/brain/personas.ts) speaks in these.
const VOICES = ["crisp", "warm", "hype", "dry", "lowercase", "thoughtful"];
const RECRUITER_TITLES = ["Head of Talent", "Technical Recruiter", "Founding Recruiter", "Talent Partner", "Recruiting Lead"];
const AGENCIES = ["Brightline Search", "North Fork Talent", "Ledger & Lane Partners", "Fieldnote Recruiting"];
const FOUNDER_TITLES = ["Co-founder and CEO", "Co-founder and CTO", "Founder", "CEO"];

const PREV = ["Corvid", "Fennel", "Brisk", "Pebblebank", "Quillmark", "Ferngate", "Saltmarsh", "Driftline", "Ostrich Pay", "Kitebase", "Kindling Robotics", "Larchwood", "Mapleshift", "Glasshouse", "Northfold", "Rookery", "Sparrowhawk", "Bluefin Health", "Cinder", "Hatchway"];
const QUOTES = {
  eng: ["the engineer who ships on Friday and still sleeps on Saturday", "the person you want in the room when prod is on fire", "someone who deletes more code than they write, on purpose", "the reason our on-call rotation got boring", "the engineer every junior asks for in code review"],
  design: ["the designer who makes the boring flows feel like the fun ones", "someone who prototypes faster than we can schedule the meeting", "the person who made our onboarding feel like a gift"],
  pm: ["the PM who writes specs people actually read", "someone who can say no to a CEO kindly and correctly", "the person who turned our roadmap into a list of bets"],
  gtm: ["the closer who never sounds like a closer", "someone customers text on their birthday", "the person who built our pipeline from a spreadsheet and grit"],
  data: ["the analyst who finds the number everyone else missed", "someone who makes dashboards people open on purpose"],
  ops: ["the person who quietly kept the whole company on rails", "someone who turns chaos into a calendar"],
};
const RELATIONS = [
  (f, co) => `${f}'s manager at ${co}`,
  (f, co) => `worked with ${f} for ${between(2, 5)} years at ${co}`,
  (f, co) => `co-founded ${co} with ${f}`,
  (f, co) => `${f}'s tech lead at ${co}`,
  (f, co) => `hired ${f} at ${co}`,
];

// ---------------------------------------------------------------- hero personas (hand-written)
// A few richly written hiring contacts, so demos land on characters with real texture.
const HEROES = [
  { name: "Dee Okonkwo", title: "Head of Talent", voice: "warm", bio: "ex-middle-school teacher, signs off with 'onward!', has never ghosted a candidate", pickiness: 0.3 },
  { name: "Hollis Grant", title: "Agency recruiter at Brightline Search", voice: "hype", bio: "uses exclamation points like punctuation is free, genuinely great at closing", pickiness: 0.1 },
  { name: "Ingrid Solberg", title: "Co-founder and CTO", voice: "dry", bio: "ex-infra lead, reads every resume for evidence of shipped work, allergic to buzzwords", pickiness: 0.7 },
  { name: "Marcus Bell", title: "Founder", voice: "lowercase", bio: "second-time founder, texts in lowercase from the airport, decides in minutes", pickiness: 0.4 },
  { name: "Priscilla Ade", title: "Recruiting Lead", voice: "thoughtful", bio: "asks one more good question than you expect, keeps a candidate's notes for years", pickiness: 0.5 },
  { name: "Jun Watanabe", title: "Co-founder and CEO", voice: "crisp", bio: "ex-consultant turned founder, replies in under ten words, calendar is a fortress", pickiness: 0.6 },
];
for (const h of HEROES) usedNames.add(h.name);

// ---------------------------------------------------------------- build companies + hiring contacts
const people = [];
const companies = [];
const usedCo = new Set(["Marigold", "Atlas Route", "Loomwork", "Kiln", "Brightwater Health", "Corvid"]);
for (let i = 0; i < 42; i++) {
  const sec = SECTORS[i % SECTORS.length];
  let company;
  do { company = pick(NAME_A) + pick(NAME_B); } while (usedCo.has(company));
  usedCo.add(company);
  const stage = pick(STAGES);
  const role = pick(ROLES);
  const bump = { seed: -10, "series a": 0, "series b": 10, "series c": 20 }[stage];
  const bandK = [role.band[0] + bump, role.band[1] + bump];
  const mustHaves = [...pickN(role.fn, 2), ...pickN(sec.skills, 2)];
  const equity = stage === "seed" ? `${(rand() * 0.8 + 0.4).toFixed(1)}-${(rand() * 1 + 1.2).toFixed(1)}%` : stage === "series a" ? `0.${between(15, 30)}-0.${between(35, 60)}%` : `0.0${between(4, 6)}-0.${between(10, 15)}%`;
  const slots = pickN(SLOT_DAYS, 2).map((d) => `${d} ${pick(SLOT_TIMES)}`);
  companies.push({ company, stage, sector: sec.sector, roleTitle: role.title, bandK, equity, setup: pick(SETUPS), mustHaves, problem: pick(sec.problems), slots });
}

function hiringContact(co, idx) {
  const hero = idx < HEROES.length ? HEROES[idx] : undefined;
  const isRecruiter = hero ? !/founder|ceo|cto/i.test(hero.title) : rand() < 0.45;
  const who = hero ? { name: hero.name, first: hero.name.split(" ")[0] } : person();
  const agency = isRecruiter && rand() < 0.25 ? pick(AGENCIES) : undefined;
  const title = hero?.title ?? (isRecruiter ? (agency ? `Recruiter at ${agency}` : pick(RECRUITER_TITLES)) : pick(FOUNDER_TITLES));
  const voucher = person();
  return {
    id: `f_${slug(co.company)}_${slug(who.first)}`,
    handle: phone(),
    name: who.name,
    first: who.first,
    role: "founder",
    stage: "ready",
    simulated: true,
    persona: {
      kind: isRecruiter ? (agency ? "agency_recruiter" : "recruiter") : "founder",
      title,
      voice: hero?.voice ?? pick(VOICES),
      bio: hero?.bio ?? `${title} at ${co.company}; ${pick(["fast replies", "careful reader", "warm and direct", "asks sharp questions", "decides on gut and data"])}`,
      pickiness: hero?.pickiness ?? Math.round(rand() * 70) / 100,
    },
    vouch: { name: voucher.name, relation: `worked with ${who.first} at ${pick(PREV)}`, quote: pick(["the most organized hiring manager I've worked with", "someone who tells candidates the truth, fast", "a person who actually reads every application", "the kind of boss people follow to their next company"]) },
    founder: co,
  };
}
companies.forEach((co, i) => {
  people.push(hiringContact(co, i));
  if (rand() < 0.35) people.push(hiringContact(co, 99)); // some companies have both a founder and a recruiter
});

// ---------------------------------------------------------------- candidates
const PROUD = {
  eng: ["Rebuilt the billing pipeline and cut failed invoices by 70%", "Took p95 latency from 2.1s to 300ms on the core API", "Shipped offline mode used by 400k people a week", "Led the migration off a 9-year-old monolith with zero downtime"],
  design: ["Redesigned onboarding and lifted activation from 31% to 49%", "Built the design system 40 engineers now use", "Ran 60 user interviews and killed a feature everyone loved, correctly"],
  pm: ["Launched usage-based pricing that grew expansion revenue 2x", "Cut time-to-first-value from 6 days to 1", "Turned a 9-month roadmap into three bets that all shipped"],
  gtm: ["Closed the company's first seven enterprise deals", "Built a community from 0 to 30k developers", "Grew self-serve signups 3x in two quarters"],
  data: ["Found the churn signal that saved a $2M account", "Built the forecasting model finance actually trusts"],
  ops: ["Ran the Series B process and two office moves in one year", "Rebuilt hiring ops; time-to-offer dropped from 41 to 19 days"],
};
const WHY = ["Wants a smaller team and a whole problem to own", "Wants to be early again, before the process hardens", "Looking for a founder who moves fast and explains why", "Ready for more scope, ideally leading a small team", "Wants work that touches real customers every week", "Looking for a mission they'd explain to their grandmother proudly"];
for (let i = 0; i < 96; i++) {
  const role = pick(ROLES);
  const sec = pick(SECTORS);
  const who = person();
  const prev = pick(PREV);
  const years = between(2, 11);
  const voucher = person();
  people.push({
    id: `c_${slug(who.first)}_${slug(who.name.split(" ")[1])}`,
    handle: phone(),
    name: who.name,
    first: who.first,
    role: "candidate",
    stage: "ready",
    simulated: true,
    vouch: { name: voucher.name, relation: pick(RELATIONS)(who.first, prev), quote: pick(QUOTES[role.kind]) },
    candidate: {
      title: `${role.title.replace(/^(Founding|First|Head of|Staff|Senior) /, "")} at ${prev}`,
      years,
      skills: [...new Set([...pickN(role.fn, 3), ...pickN(sec.skills, 2)])],
      floorK: Math.round((role.band[0] - 10 + years * 3) / 5) * 5,
      setups: pickN(["remote", "hybrid", "onsite"], between(1, 2)),
      stages: pickN(["seed", "series a", "series b", "series c"], between(2, 3)),
      proudest: pick(PROUD[role.kind]),
      whyLeave: pick(WHY),
    },
  });
}

const world = {
  _note: "Generated by scripts/gen-world.mjs. Entirely fictional: no real people, companies or phone numbers (555-01XX is reserved for fiction). Hiring contacts and world candidates are `simulated`, so Wren's persona engine answers for them.",
  stats: { companies: companies.length, hiringContacts: people.filter((p) => p.role === "founder").length, recruiters: people.filter((p) => p.persona && p.persona.kind !== "founder").length, candidates: people.filter((p) => p.role === "candidate").length },
  people,
};
writeFileSync("data/world.json", JSON.stringify(world, null, 1) + "\n");
console.log("wrote data/world.json", world.stats);
