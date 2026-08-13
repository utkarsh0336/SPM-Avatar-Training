/**
 * Hex values for the wizard's skin-tone/hair-color tokens, duplicated from
 * packages/shared/src/tutor/avatar-config.ts's SKIN_TONE_HEX/HAIR_COLOR_HEX
 * rather than imported. Deliberate, same reasoning avatar-config.ts itself
 * documents for duplicating literal unions instead of a live cross-package
 * import: @avatrain/shared's module graph pulls in heavy Node-only server
 * dependencies (echogarden, msedge-tts, @xenova/transformers, @node-rs/argon2)
 * that must never end up in a browser bundle — this package (and eventually
 * apps/widget's embed bundle) is browser-DOM-only, same reasoning
 * avatar-provider-factory.ts already gives for why AvatarProvider itself
 * isn't declared in packages/shared. avatar-config.test.ts's own drift-guard
 * convention applies here too — see vrm-color-map.test.ts.
 */
export const SKIN_TONE_HEX: Record<string, string> = {
  TONE_1: "#F7DFC4",
  TONE_2: "#EFC9A2",
  TONE_3: "#DCA477",
  TONE_4: "#BE8148",
  TONE_5: "#9C6432",
  TONE_6: "#7A4A24",
};

export const HAIR_COLOR_HEX: Record<string, string> = {
  BLACK: "#2B2724",
  AUBURN: "#7A4020",
  COPPER: "#A5622F",
  BLONDE: "#D4A83C",
  PLATINUM: "#EDE0C8",
  RED: "#C43B2C",
  PURPLE: "#7B3FA0",
  BLUE: "#3B7FC4",
};
