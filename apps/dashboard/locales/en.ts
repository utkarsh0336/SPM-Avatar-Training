// English dictionary — the canonical key set. hi.ts must export exactly the
// same keys (enforced by locale-parity.test.ts); a key present here but
// missing there is how a Hindi string silently regresses to English.
//
// Values may contain `{paramName}` placeholders, interpolated by
// lib/locale/dictionaries.ts's translate() — e.g. `{orgName}`.
//
// Deliberately not `as const`: that would infer each leaf as its exact
// English string literal type, which would then reject hi.ts's Hindi
// values as type errors. Leaves are just `string` here.
export const en: {
  sessionsSidebar: Record<
    | "workspaceFallback"
    | "personaName"
    | "personaSubtitle"
    | "personaDismissAriaLabel"
    | "groupAiAvatarHub"
    | "navNewChat"
    | "navVoiceAi"
    | "navSavedConversations"
    | "navKnowledgeBase"
    | "navAvatars"
    | "groupMain"
    | "navDashboard"
    | "navAnalytics"
    | "groupAccount"
    | "navNotifications"
    | "navHelpCenter"
    | "navProfile"
    | "userRole"
    | "settingsAriaLabel"
    | "logoutAriaLabel",
    string
  >;
  onboardingSidebar: Record<
    | "workspaceFallback"
    | "personaName"
    | "personaSubtitle"
    | "personaDismissAriaLabel"
    | "groupAiAvatarHub"
    | "navNewChat"
    | "navVoiceAi"
    | "navSavedConversations"
    | "groupMain"
    | "navDashboard"
    | "groupAccount"
    | "navNotifications"
    | "navHelpCenter"
    | "navProfile"
    | "userRole"
    | "settingsAriaLabel",
    string
  >;
  wizardNav: Record<"back" | "continue", string>;
  settingsPage: Record<
    | "eyebrow"
    | "title"
    | "subtitle"
    | "embedLabel"
    | "embedSubtitle"
    | "manageEmbeds"
    | "membersLabel"
    | "membersSubtitle"
    | "manageMembers",
    string
  >;
  brandingForm: Record<
    | "orgNameLabel"
    | "logoUrlLabel"
    | "primaryColorLabel"
    | "primaryColorPickerAriaLabel"
    | "secondaryColorLabel"
    | "secondaryColorPickerAriaLabel"
    | "saveError"
    | "saving"
    | "saveChanges",
    string
  >;
  membersPanel: Record<
    | "inviteSomeone"
    | "roleMember"
    | "rolePartner"
    | "inviting"
    | "invite"
    | "inviteError"
    | "genericError"
    | "inviteUrlPrefix",
    string
  >;
  localeSwitcher: Record<"ariaLabel" | "en" | "hi", string>;
} = {
  sessionsSidebar: {
    workspaceFallback: "Avatrain",
    personaName: "AI Nancy",
    personaSubtitle: "ENTERPRISE PLATFORM",
    personaDismissAriaLabel: "Dismiss",
    groupAiAvatarHub: "AI AVATAR HUB",
    navNewChat: "New CHAT",
    navVoiceAi: "Voice AI",
    navSavedConversations: "Saved Conversations",
    navKnowledgeBase: "Knowledge Base",
    navAvatars: "Avatars",
    groupMain: "MAIN",
    navDashboard: "Dashboard",
    navAnalytics: "Analytics",
    groupAccount: "ACCOUNT",
    navNotifications: "Notifications",
    navHelpCenter: "Help Center",
    navProfile: "Profile",
    userRole: "Sales Team",
    settingsAriaLabel: "Settings",
    logoutAriaLabel: "Log out",
  },
  onboardingSidebar: {
    workspaceFallback: "Avatrain",
    personaName: "AI Nancy",
    personaSubtitle: "ENTERPRISE PLATFORM",
    personaDismissAriaLabel: "Dismiss",
    groupAiAvatarHub: "AI AVATAR HUB",
    navNewChat: "New Chat",
    navVoiceAi: "Voice AI",
    navSavedConversations: "Saved Conversations",
    groupMain: "MAIN",
    navDashboard: "Dashboard",
    groupAccount: "ACCOUNT",
    navNotifications: "Notifications",
    navHelpCenter: "Help Center",
    navProfile: "Profile",
    userRole: "Sales Team",
    settingsAriaLabel: "Settings",
  },
  wizardNav: {
    back: "Back",
    continue: "Continue",
  },
  settingsPage: {
    eyebrow: "SETTINGS",
    title: "Organization Branding",
    subtitle: "Customize how {orgName} looks across the AI Avatar workspace.",
    embedLabel: "EMBED ON A WEBSITE",
    embedSubtitle:
      "Put {orgName}’s AI avatar on any site — create a publishable key, pin a persona, and allowlist the origins that may load it.",
    manageEmbeds: "Manage Embeds",
    membersLabel: "MEMBERS",
    membersSubtitle:
      "Invite teammates as a Member, or an external partner/distributor as a read-only Partner scoped to your partner-enablement curricula.",
    manageMembers: "Manage Members",
  },
  brandingForm: {
    orgNameLabel: "Organization name",
    logoUrlLabel: "Logo URL",
    primaryColorLabel: "Primary color",
    primaryColorPickerAriaLabel: "Primary color picker",
    secondaryColorLabel: "Secondary color",
    secondaryColorPickerAriaLabel: "Secondary color picker",
    saveError: "Couldn't save your changes. Please try again.",
    saving: "Saving…",
    saveChanges: "Save changes",
  },
  membersPanel: {
    inviteSomeone: "Invite someone",
    roleMember: "Member",
    rolePartner: "Partner",
    inviting: "Inviting…",
    invite: "Invite",
    inviteError: "Could not send this invite.",
    genericError: "Could not reach the server.",
    inviteUrlPrefix: "Invite link (no email delivery yet — share this directly):",
  },
  localeSwitcher: {
    ariaLabel: "Switch language",
    en: "English",
    hi: "हिन्दी",
  },
};

export type Dictionary = typeof en;
