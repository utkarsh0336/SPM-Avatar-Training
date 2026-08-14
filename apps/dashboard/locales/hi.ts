import type { Dictionary } from "./en";

// Hindi dictionary. Must export exactly the same key set as en.ts — see
// locale-parity.test.ts. localeSwitcher.en/hi are deliberately identical to
// en.ts's values: a language switcher's own option labels are conventionally
// shown in each language's own script regardless of which dictionary is
// active, not translated.
export const hi: Dictionary = {
  sessionsSidebar: {
    workspaceFallback: "Avatrain",
    personaName: "AI Nancy",
    personaSubtitle: "एंटरप्राइज़ प्लेटफ़ॉर्म",
    personaDismissAriaLabel: "बंद करें",
    groupAiAvatarHub: "एआई अवतार हब",
    navNewChat: "नई चैट",
    navVoiceAi: "वॉइस एआई",
    navSavedConversations: "सहेजी गई बातचीत",
    navKnowledgeBase: "नॉलेज बेस",
    navAvatars: "अवतार",
    groupMain: "मुख्य",
    navDashboard: "डैशबोर्ड",
    groupAccount: "खाता",
    navNotifications: "सूचनाएं",
    navHelpCenter: "सहायता केंद्र",
    navProfile: "प्रोफ़ाइल",
    userRole: "सेल्स टीम",
    settingsAriaLabel: "सेटिंग्स",
    logoutAriaLabel: "लॉग आउट करें",
  },
  onboardingSidebar: {
    workspaceFallback: "Avatrain",
    personaName: "AI Nancy",
    personaSubtitle: "एंटरप्राइज़ प्लेटफ़ॉर्म",
    personaDismissAriaLabel: "बंद करें",
    groupAiAvatarHub: "एआई अवतार हब",
    navNewChat: "नई चैट",
    navVoiceAi: "वॉइस एआई",
    navSavedConversations: "सहेजी गई बातचीत",
    groupMain: "मुख्य",
    navDashboard: "डैशबोर्ड",
    groupAccount: "खाता",
    navNotifications: "सूचनाएं",
    navHelpCenter: "सहायता केंद्र",
    navProfile: "प्रोफ़ाइल",
    userRole: "सेल्स टीम",
    settingsAriaLabel: "सेटिंग्स",
  },
  wizardNav: {
    back: "वापस",
    continue: "जारी रखें",
  },
  settingsPage: {
    eyebrow: "सेटिंग्स",
    title: "संगठन ब्रांडिंग",
    subtitle: "{orgName} पूरे एआई अवतार वर्कस्पेस में कैसा दिखे, इसे अनुकूलित करें।",
    embedLabel: "वेबसाइट पर एम्बेड करें",
    embedSubtitle:
      "{orgName} के एआई अवतार को किसी भी साइट पर जोड़ें — एक पब्लिशेबल की बनाएं, एक पर्सोना पिन करें, और उन ऑरिजिन को अनुमति दें जो इसे लोड कर सकें।",
    manageEmbeds: "एम्बेड प्रबंधित करें",
    membersLabel: "सदस्य",
    membersSubtitle:
      "टीम के साथियों को सदस्य के रूप में आमंत्रित करें, या किसी बाहरी पार्टनर/डिस्ट्रीब्यूटर को केवल-पठन पार्टनर के रूप में, जो आपके पार्टनर-एनेबलमेंट पाठ्यक्रमों तक सीमित हो।",
    manageMembers: "सदस्य प्रबंधित करें",
  },
  brandingForm: {
    orgNameLabel: "संगठन का नाम",
    logoUrlLabel: "लोगो यूआरएल",
    primaryColorLabel: "प्राथमिक रंग",
    primaryColorPickerAriaLabel: "प्राथमिक रंग चयनकर्ता",
    secondaryColorLabel: "द्वितीयक रंग",
    secondaryColorPickerAriaLabel: "द्वितीयक रंग चयनकर्ता",
    saveError: "आपके बदलाव सहेजे नहीं जा सके। कृपया फिर से प्रयास करें।",
    saving: "सहेजा जा रहा है…",
    saveChanges: "बदलाव सहेजें",
  },
  membersPanel: {
    inviteSomeone: "किसी को आमंत्रित करें",
    roleMember: "सदस्य",
    rolePartner: "पार्टनर",
    inviting: "आमंत्रित किया जा रहा है…",
    invite: "आमंत्रित करें",
    inviteError: "यह आमंत्रण नहीं भेजा जा सका।",
    genericError: "सर्वर से संपर्क नहीं हो सका।",
    inviteUrlPrefix: "आमंत्रण लिंक (अभी ईमेल डिलीवरी उपलब्ध नहीं है — इसे सीधे साझा करें):",
  },
  localeSwitcher: {
    ariaLabel: "भाषा बदलें",
    en: "English",
    hi: "हिन्दी",
  },
};
