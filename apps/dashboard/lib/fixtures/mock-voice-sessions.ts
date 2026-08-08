// Milestone-1-style fixture (mirrors mock-training-sessions.ts): the pinned/
// recent voice-session history list lives in memory for the tab's lifetime,
// seeded from this fixture. Each entry denormalizes expertName/expertRole
// rather than joining against voice-experts.ts at render time, matching the
// existing MockTrainingSession convention (listOwnerName/listCategory).
import type { Language } from "@avatrain/shared/tutor";

export interface MockVoiceSession {
  id: string;
  title: string;
  expertId: string;
  expertName: string;
  expertRole: string;
  language: Language;
  relativeTime: string;
  pinned: boolean;
}

export const INITIAL_MOCK_VOICE_SESSIONS: MockVoiceSession[] = [
  {
    id: "maternity-leave-policy",
    title: "Maternity Leave Policy",
    expertId: "priya",
    expertName: "Priya",
    expertRole: "HR Expert",
    language: "English",
    relativeTime: "2h ago",
    pinned: true,
  },
  {
    id: "sales-objection-handling",
    title: "Sales Objection Handling",
    expertId: "marcus",
    expertName: "Marcus",
    expertRole: "Sales Coach",
    language: "English",
    relativeTime: "Yesterday",
    pinned: true,
  },
  {
    id: "gdpr-compliance-qa",
    title: "GDPR Compliance Q&A",
    expertId: "shreya",
    expertName: "Shreya",
    expertRole: "Compliance",
    language: "English",
    relativeTime: "2 days ago",
    pinned: false,
  },
  {
    id: "product-demo-walkthrough",
    title: "Product Demo Walkthrough",
    expertId: "ananya",
    expertName: "Ananya",
    expertRole: "Product",
    language: "English",
    relativeTime: "3 days ago",
    pinned: false,
  },
  {
    id: "sla-escalation-process",
    title: "SLA Escalation Process",
    expertId: "david",
    expertName: "David",
    expertRole: "Support",
    language: "English",
    relativeTime: "1 week ago",
    pinned: false,
  },
];
