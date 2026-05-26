import {Setting} from "obsidian";
import {DEFAULT_TRANSLATION_PROMPT_ID} from "../translation/prompts";
import type {TranslationPromptPreset} from "../translation/prompts";
import type {TranslationSettingTab} from "./tab";

export function displayPromptTemplateSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	normalizePromptSelection(tab);

	tab.heading(el, "Prompt");

	new Setting(el)
		.setName(tab.t("settings.prompt.name"))
		.setDesc(tab.t("settings.prompt.desc"))
		.addDropdown(dropdown => {
			dropdown.addOption(DEFAULT_TRANSLATION_PROMPT_ID, tab.t("settings.prompt.default"));
			for (const preset of tab.plugin.promptService.listPresets()) {
				dropdown.addOption(preset.id, preset.name);
			}
			dropdown.setValue(tab.plugin.settings.translationPromptId ?? DEFAULT_TRANSLATION_PROMPT_ID);
			dropdown.onChange(async value => {
				tab.plugin.settings.translationPromptId = value === DEFAULT_TRANSLATION_PROMPT_ID ? null : value;
				await tab.plugin.saveSettings();
				tab.display();
			});
		});

	const selectedPreset = getSelectedPreset(tab);
	new Setting(el)
		.setName(selectedPreset?.name ?? tab.t("settings.prompt.default"))
		.setDesc(selectedPreset?.description ?? tab.t("settings.prompt.defaultDesc"));
}

function getSelectedPreset(tab: TranslationSettingTab): TranslationPromptPreset | null {
	const promptId = tab.plugin.settings.translationPromptId;
	if (!promptId) {
		return null;
	}
	return tab.plugin.promptService.listPresets().find(preset => preset.id === promptId) ?? null;
}

function normalizePromptSelection(tab: TranslationSettingTab): void {
	const promptId = tab.plugin.settings.translationPromptId;
	if (!promptId) {
		return;
	}

	const isBuiltInPreset = tab.plugin.promptService.listPresets().some(preset => preset.id === promptId);
	if (!isBuiltInPreset) {
		tab.plugin.settings.translationPromptId = null;
		void tab.plugin.saveSettings();
	}
}
