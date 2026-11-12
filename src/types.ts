export type Role = "candidate" | "founder";

export interface Vouch {
  name: string;
  relation: string;
  quote: string;
}

export interface CandidateProfile {
  title: string;
  years: number;
  skills: string[];
  floorK?: number;
  setups?: string[];
  stages?: string[];
  proudest?: string;
  whyLeave?: string;
  energy?: string;
  /** Pasted resume or LinkedIn text (trimmed). The artifact, not the signal. */
  resume?: string;
}

export interface FounderProfile {
  company: string;
  stage: string;
  sector: string;
  roleTitle: string;
  bandK: [number, number];
  equity: string;
  setup: string;
  mustHaves: string[];
  problem: string;
  slots: string[];
  /** From the role intake: what success looks like at 90 days, what went wrong before, the honest pitch and catch. */
  success?: string;
  antiPattern?: string;
  pitch?: string;
  jd?: string;
}

export type Voice = "crisp" | "warm" | "hype" | "dry" | "lowercase" | "thoughtful";

/** How a simulated hiring contact texts back. */
export interface Persona {
  kind: "founder" | "recruiter" | "agency_recruiter";
  title: string;
  voice: Voice;
  bio: string;
  /** 0 = says yes to anything decent, 1 = only the strongest matches. */
  pickiness: number;
}

/** Where a person is in their 1:1 thread with Wren. ("naming" = Wren asked a new contact for their name.) */
export type Stage =
  | "new" | "naming" | "side" | "resume" | "interviewing" | "blurb_review"   // candidate intake
  | "company" | "jd" | "role_interview" | "role_review"                       // hiring intake
  | "ready";

export interface Person {
  id: string;
  handle: string;
  name: string;
  first: string;
  role: Role;
  vouch?: Vouch;
  candidate?: CandidateProfile;
  founder?: FounderProfile;
  stage: Stage;
  asked: number;
  blurb?: string;
  hideComp?: boolean;
  /** Texted STOP (or another carrier opt-out keyword). Wren sends nothing until they text again. */
  optedOut?: boolean;
  /** Made up (seed or world data). Never texted over a real network; on real transports the persona engine plays them. */
  fictional?: boolean;
  /** Always played by the persona engine, even in the simulator (the generated world). */
  simulated?: boolean;
  persona?: Persona;
  notes: string[];
}

export type IntroStatus =
  | "asked_candidate"
  | "asked_founder"
  | "declined_candidate"
  | "declined_founder"
  | "connected"
  | "scheduled"
  | "followed_up";

export interface Intro {
  id: string;
  candidateId: string;
  founderId: string;
  status: IntroStatus;
  reasons: string[];
  score: number;
  /** Who Wren asked first. Candidate-first by default; "founder" when a hiring manager asked Wren to find someone. */
  initiatedBy?: "candidate" | "founder";
  chatId?: string;
  slot?: string;
  pitch?: { toCandidate: string[]; toFounder: string[]; groupIntro: string[] };
  /** Who Wren is waiting on for a free-text answer (a decline reason, post-call feedback). */
  awaiting?: string[];
  feedback: Record<string, string>;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  from: string; // handle
  text: string;
  at: string;
  reaction?: string; // a tapback Wren put on this message
}

export interface Chat {
  id: string;
  handles: string[]; // humans, not including the agent
  isGroup: boolean;
  displayName?: string;
  introId?: string;
  messages: ChatMessage[];
}

export interface InboundEvent {
  chatId: string;
  isGroup: boolean;
  from: string;
  text: string;
  messageId?: string;
  participants?: string[];
}

export interface LogEntry {
  at: string;
  kind: "inbound" | "outbound" | "decision" | "llm" | "error";
  text: string;
}
