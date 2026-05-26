import {PROVIDER_KINDS, PROVIDER_LABELS} from "../translation/provider-config";
import {getLanguageLabel, getSourceLanguageOptions, getTargetLanguageOptions} from "./defaults";
import type {TranslationSettingTab} from "./tab";

export function displayBasicSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	const locale = tab.plugin.settings.pluginLanguage;
	const targetLanguages = getTargetLanguageOptions(tab.plugin.settings.currentProvider, locale);
	ensureSupportedTargetLanguage(tab, targetLanguages);

	tab.heading(el, tab.t("settings.basic.heading"));
	tab.localeDropdown(el);
	tab.dropdown(el, tab.t("settings.basic.sourceLanguage.name"), tab.t("settings.basic.sourceLanguage.desc"), "sourceLanguage", getSourceLanguageOptions(locale));
	tab.dropdown(el, tab.t("settings.basic.targetLanguage.name"), getTargetLanguageDesc(tab), "targetLanguage", targetLanguages);
}

export function displayAboutSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	const settings = tab.plugin.settings;

	tab.heading(el, tab.t("settings.about.heading"));
	tab.static(el, tab.t("settings.about.version"), tab.plugin.manifest.version);
	tab.static(el, tab.t("settings.about.currentProvider"), PROVIDER_LABELS[settings.currentProvider]);
	tab.static(el, tab.t("settings.about.currentTargetLanguage"), getLanguageLabel(settings.targetLanguage, settings.pluginLanguage));

	tab.subheading(el, tab.t("settings.about.privacy.heading"));
	tab.static(el, tab.t("settings.about.privacy.noTelemetry.name"), tab.t("settings.about.privacy.noTelemetry.desc"));
	tab.static(el, tab.t("settings.about.privacy.externalRequests.name"), tab.t("settings.about.privacy.externalRequests.desc"));
	tab.static(el, tab.t("settings.about.privacy.apiKeys.name"), tab.t("settings.about.privacy.apiKeys.desc"));
	tab.static(el, tab.t("settings.about.privacy.cache.name"), tab.t("settings.about.privacy.cache.desc"));

	tab.subheading(el, tab.t("settings.about.services.heading"));
	tab.static(el, tab.t("settings.about.services.translation"), PROVIDER_LABELS[settings.currentProvider]);
	tab.static(el, tab.t("settings.about.services.tts"), settings.ttsEnabled ? `${settings.ttsProvider} / ${tab.t("settings.about.services.configured")}` : tab.t("common.disabled"));
	tab.static(el, tab.t("settings.about.services.image"), settings.enableImageTools && settings.imageApiKey ? tab.t("settings.about.services.configured") : tab.t("settings.about.services.notConfigured"));
}

function getTargetLanguageDesc(tab: TranslationSettingTab): string {
	if (PROVIDER_KINDS[tab.plugin.settings.currentProvider] === "pure-translation") {
		return tab.t("settings.basic.targetLanguage.machineDesc");
	}
	return tab.t("settings.basic.targetLanguage.aiDesc");
}

function ensureSupportedTargetLanguage(tab: TranslationSettingTab, options: Record<string, string>): void {
	if (tab.plugin.settings.targetLanguage in options) {
		return;
	}

	const fallback = Object.keys(options)[0];
	if (fallback) {
		tab.plugin.settings.targetLanguage = fallback;
		void tab.plugin.saveSettings();
	}
}
