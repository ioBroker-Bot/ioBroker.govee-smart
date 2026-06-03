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
 * Plain-string label in system language — for `common.states` VALUES and
 * user-facing messages (wizard / mqttAuth responses). Optional positional
 * args fill `%s` placeholders via adapter-core's I18n.translate.
 *
 * @param key I18n key
 * @param args Positional values substituted into `%s` placeholders, in order
 */
export function resolveLabel(key: I18nKey, ...args: (string | number)[]): string {
  return I18n.translate(key, ...args);
}
