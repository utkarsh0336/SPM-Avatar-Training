// Milestone 1 (static UI shell) fixture data — see .claude/specs/video-chat-session.md
// Implementation Plan, step 1. No API/DB/realtime involvement; replaced by real
// `GET /v1/training-sessions` data in Milestone 2.

export type TranscriptRole = "AVATAR" | "USER";

export interface MockTranscriptMessage {
  id: string;
  role: TranscriptRole;
  text: string;
}

export interface MockTrainingSession {
  id: string;
  title: string;
  /** Decorative session-list metadata — who set up this training scenario. */
  listOwnerName: string;
  listCategory: string;
  relativeTime: string;
  pinned: boolean;
  /** Shown in the video header/topic pill and caption bar for this session. */
  topic: string;
  /** Which of the org's avatars to render/speak as — null means "let useConversationSession.ts pick the caller's default (ACTIVE-first) avatar", the pre-multi-persona behavior. Picked in NewSessionModal.tsx when an org has more than one avatar. */
  avatarId: string | null;
  captionText: string;
  transcript: MockTranscriptMessage[];
  /** True while the avatar is still composing/speaking its next turn. */
  pendingTurn: boolean;
}

export const INITIAL_MOCK_SESSIONS: MockTrainingSession[] = [
  {
    id: "sales-pitch-practice",
    title: "Sales Pitch Practice",
    listOwnerName: "Marcus",
    listCategory: "Sales Coach",
    relativeTime: "Yesterday",
    pinned: true,
    topic: "HR & Leave Policy",
    avatarId: null,
    captionText:
      "Let me walk you through the core concepts we'll cover in today's session on HR & Leave Policy…",
    transcript: [
      {
        id: "m1",
        role: "AVATAR",
        text: "Hello! I'm My Avatar. Today we'll explore HR & Leave Policy — let's start with the fundamentals.",
      },
      { id: "m2", role: "USER", text: "Sounds great! Can you start with an overview?" },
      {
        id: "m3",
        role: "AVATAR",
        text: "Of course! HR & Leave Policy covers several key areas. First, let me set the context with a quick overview of what we'll learn today.",
      },
      { id: "m4", role: "USER", text: "Perfect, I'm ready." },
      {
        id: "m5",
        role: "AVATAR",
        text: "Great! Let's dive into the first concept. Pay attention — there'll be a quick quiz at the end!",
      },
    ],
    pendingTurn: true,
  },
  {
    id: "crm-v4-feature-demo",
    title: "CRM v4.2 Feature Demo",
    listOwnerName: "Ananya",
    listCategory: "Product",
    relativeTime: "1h ago",
    pinned: true,
    topic: "Product Training",
    avatarId: null,
    captionText: "Let's take a look at what's new in the v4.2 release…",
    transcript: [
      { id: "m1", role: "AVATAR", text: "Hi! Ready to walk through the CRM v4.2 feature demo?" },
      { id: "m2", role: "USER", text: "Yes, let's go." },
    ],
    pendingTurn: false,
  },
  {
    id: "compliance-training",
    title: "Compliance Training",
    listOwnerName: "Shreya",
    listCategory: "Compliance",
    relativeTime: "2 days ago",
    pinned: false,
    topic: "Compliance & Legal",
    avatarId: null,
    captionText: "Today we'll review the key compliance obligations for your role…",
    transcript: [
      { id: "m1", role: "AVATAR", text: "Welcome back to Compliance Training." },
      { id: "m2", role: "USER", text: "Thanks, let's continue where we left off." },
    ],
    pendingTurn: false,
  },
  {
    id: "support-escalation-roleplay",
    title: "Support Escalation Roleplay",
    listOwnerName: "David",
    listCategory: "Support",
    relativeTime: "4 days ago",
    pinned: false,
    topic: "Customer Support",
    avatarId: null,
    captionText: "I'll play a frustrated customer — try to de-escalate the situation…",
    transcript: [
      { id: "m1", role: "AVATAR", text: "This is the third time I've called about this issue!" },
      { id: "m2", role: "USER", text: "I understand your frustration — let's get this resolved." },
    ],
    pendingTurn: false,
  },
  {
    id: "onboarding-walkthrough",
    title: "Onboarding Walkthrough",
    listOwnerName: "Priya",
    listCategory: "HR Expert",
    relativeTime: "1 week ago",
    pinned: false,
    topic: "HR & Leave Policy",
    avatarId: null,
    captionText: "Let's walk through everything you need to know for your first week…",
    transcript: [
      { id: "m1", role: "AVATAR", text: "Welcome aboard! Let's get you set up." },
      { id: "m2", role: "USER", text: "Thanks, excited to get started." },
    ],
    pendingTurn: false,
  },
];
