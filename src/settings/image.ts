import {Notice, Setting} from "obsidian";
import type {TranslationSettingTab} from "./tab";

const IMAGE_MODELS = {
	"gpt-image-1.5": "gpt-image-1.5",
	"gpt-image-2": "gpt-image-2",
};

const OUTPUT_FORMATS = {
	png: "PNG",
	jpeg: "JPEG",
	webp: "WebP",
};

interface ImageSettingsDraft {
	imageApiKey: string;
	imageBaseUrl: string;
	imageModel: string;
	imageOutputFormat: string;
	imageTranslationPrompt: string;
}

export function displayImageTranslationSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	const draft: ImageSettingsDraft = {
		imageApiKey: tab.plugin.settings.imageApiKey ?? "",
		imageBaseUrl: tab.plugin.settings.imageBaseUrl || "https://api.openai.com/v1",
		imageModel: normalizeImageModel(tab.plugin.settings.imageModel),
		imageOutputFormat: normalizeOutputFormat(tab.plugin.settings.imageOutputFormat),
		imageTranslationPrompt: tab.plugin.settings.imageTranslationPrompt,
	};

	tab.heading(el, tab.t("settings.tabs.image"));

	new Setting(el)
		.setName(tab.t("settings.image.enable.name"))
		.setDesc(tab.t("settings.image.enable.desc"))
		.addToggle(toggle => toggle
			.setValue(tab.plugin.settings.enableImageTools)
			.onChange(async value => {
				tab.plugin.settings.enableImageTools = value;
				await tab.plugin.saveSettings();
			}));

	new Setting(el)
		.setName("API key")
		.setDesc(tab.t("settings.image.apiKey.desc"))
		.addText(text => {
			text.setPlaceholder("Enter API key")
				.setValue(draft.imageApiKey)
				.onChange(value => {
					draft.imageApiKey = value.trim();
				});
			if (tab.plugin.settings.hideApiKeys) {
				text.inputEl.type = "password";
			}
		});

	new Setting(el)
		.setName("Base URL")
		.setDesc(tab.t("settings.image.baseUrl.desc"))
		.addText(text => text
			.setPlaceholder("https://api.openai.com/v1")
			.setValue(draft.imageBaseUrl)
			.onChange(value => {
				draft.imageBaseUrl = value.trim();
			}));

	new Setting(el)
		.setName(tab.t("settings.image.model.name"))
		.setDesc(tab.t("settings.image.model.desc"))
		.addDropdown(dropdown => {
			for (const [value, label] of Object.entries(IMAGE_MODELS)) {
				dropdown.addOption(value, label);
			}
			dropdown.setValue(draft.imageModel);
			dropdown.onChange(value => {
				draft.imageModel = normalizeImageModel(value);
			});
		});

	new Setting(el)
		.setName(tab.t("settings.image.format.name"))
		.setDesc(tab.t("settings.image.format.desc"))
		.addDropdown(dropdown => {
			for (const [value, label] of Object.entries(OUTPUT_FORMATS)) {
				dropdown.addOption(value, label);
			}
			dropdown.setValue(draft.imageOutputFormat);
			dropdown.onChange(value => {
				draft.imageOutputFormat = normalizeOutputFormat(value);
			});
		});

	new Setting(el)
		.setName(tab.t("settings.image.prompt.name"))
		.setDesc(tab.t("settings.image.prompt.desc"))
		.addTextArea(text => {
			text.setValue(draft.imageTranslationPrompt)
				.onChange(value => {
					draft.imageTranslationPrompt = value;
				});
			text.inputEl.rows = 5;
		});

	new Setting(el)
		.setName(tab.t("settings.api.saveConfig.name"))
		.setDesc(tab.t("settings.image.save.desc"))
		.addButton(button => button
			.setButtonText(tab.t("settings.api.saveConfig.name"))
			.setCta()
			.onClick(async () => {
				tab.plugin.settings.imageApiKey = draft.imageApiKey;
				tab.plugin.settings.imageBaseUrl = draft.imageBaseUrl || "https://api.openai.com/v1";
				tab.plugin.settings.imageModel = normalizeImageModel(draft.imageModel);
				tab.plugin.settings.imageOutputFormat = normalizeOutputFormat(draft.imageOutputFormat);
				tab.plugin.settings.imageTranslationPrompt = draft.imageTranslationPrompt.trim() || tab.plugin.settings.imageTranslationPrompt;
				await tab.plugin.saveSettings();
				new Notice(tab.t("settings.image.saved"), 5000);
				tab.display();
			}));
}

export function normalizeImageModel(value: string): string {
	return value === "gpt-image-2" ? "gpt-image-2" : "gpt-image-1.5";
}

export function normalizeOutputFormat(value: string): string {
	const normalized = value.trim().toLowerCase();
	return normalized === "jpeg" || normalized === "webp" ? normalized : "png";
}
