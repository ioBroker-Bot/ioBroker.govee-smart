import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

export type I18nKey = keyof typeof translations;

/**
 * Translation object for `common.name`.
 *
 * @param key I18n key
 */
export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

/**
 * Translation object for `common.desc`.
 *
 * @param key I18n key
 */
export function tDesc(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

/**
 * Plain-string label in system language — for `common.states` VALUES.
 *
 * @param key I18n key
 */
export function resolveLabel(key: I18nKey): string {
  return I18n.translate(key);
}
