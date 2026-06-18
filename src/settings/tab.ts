import {App, PluginSettingTab, Setting} from "obsidian";
import {getLocaleOptions, t} from "../i18n";
import TranslationPlugin from "../main";
import {displayApiProfileSettings} from "./api-profiles";
import {displayAboutSettings, displayBasicSettings} from "./basic";
import {displayCacheSettings} from "./cache";
import {displayDashboardSettings} from "./dashboard";
import {SETTINGS_TABS} from "./defaults";
import {displayImageTranslationSettings} from "./image";
import {displayPromptTemplateSettings} from "./prompt-templates";
import {displayResultSettings} from "./result";
import {displayTtsSettings} from "./tts";
import type {BooleanKey, NumberKey, StringKey} from "./types";

type SettingsTabKey = typeof SETTINGS_TABS[number]["key"];

export class TranslationSettingTab extends PluginSettingTab {
	private activeTab: SettingsTabKey = "basic";

	constructor(app: App, public readonly plugin: TranslationPlugin) {
		super(app, plugin);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.addClass("selection-translator-settings");

		const tabBar = containerEl.createDiv({cls: "selection-translator-settings-tabs"});
		for (const tab of SETTINGS_TABS) {
			const button = tabBar.createEl("button", {type: "button", text: this.t(tab.labelKey)});
			button.toggleClass("is-active", this.activeTab === tab.key);
			button.addEventListener("click", () => {
				this.activeTab = tab.key;
				this.display();
			});
		}

		const body = containerEl.createDiv({cls: "selection-translator-settings-tab-content"});
		if (this.activeTab === "api") displayApiProfileSettings(this, body);
		else if (this.activeTab === "dashboard") displayDashboardSettings(this, body);
		else if (this.activeTab === "prompt") displayPromptTemplateSettings(this, body);
		else if (this.activeTab === "tts") displayTtsSettings(this, body);
		else if (this.activeTab === "image") displayImageTranslationSettings(this, body);
		else if (this.activeTab === "result") displayResultSettings(this, body);
		else if (this.activeTab === "advanced") this.displayAdvanced(body);
		else if (this.activeTab === "about") displayAboutSettings(this, body);
		else displayBasicSettings(this, body);
	}

	private displayAdvanced(el: HTMLElement): void {
		this.heading(el, this.t("settings.advanced.heading"));
		displayCacheSettings(this, el);

		this.subheading(el, this.t("settings.advanced.immersiveFilter.heading"));
		this.number(el, this.t("settings.advanced.minCharacters.name"), this.t("settings.advanced.minCharacters.desc"), "immersiveMinCharacters", 0, 1000);
		this.number(el, this.t("settings.advanced.minWords.name"), this.t("settings.advanced.minWords.desc"), "immersiveMinWords", 0, 200);
		this.toggle(el, this.t("settings.advanced.skipTarget.name"), this.t("settings.advanced.skipTarget.desc"), "immersiveSkipTargetLanguage");
		this.textarea(el, this.t("settings.advanced.customCss.name"), this.t("settings.advanced.customCss.desc"), "immersiveCustomCss");

		this.subheading(el, this.t("settings.advanced.privacy.heading"));
		this.toggle(el, this.t("settings.advanced.hideKeys.name"), this.t("settings.advanced.hideKeys.desc"), "hideApiKeys");
	}

	t(key: string, vars: Record<string, string | number> = {}): string {
		return t(this.plugin, key, vars);
	}

	heading(el: HTMLElement, title: string): void {
		new Setting(el).setName(title).setHeading().settingEl.addClass("selection-translator-settings-heading");
	}

	subheading(el: HTMLElement, title: string): void {
		new Setting(el).setName(title).setHeading().settingEl.addClass("selection-translator-settings-subheading");
	}

	static(el: HTMLElement, name: string, value: string): void {
		new Setting(el).setName(name).setDesc(value || "-");
	}

	toggle(el: HTMLElement, name: string, desc: string, key: BooleanKey): void {
		const setting = new Setting(el).setName(name);
		if (desc) {
			setting.setDesc(desc);
		}
		setting.addToggle(toggle => toggle
			.setValue(this.plugin.settings[key])
			.onChange(async value => {
				this.plugin.settings[key] = value as never;
				await this.plugin.saveSettings();
			}));
	}

	text<K extends StringKey>(el: HTMLElement, name: string, desc: string, key: K, placeholder: string, secret = false): void {
		new Setting(el).setName(name).setDesc(desc).addText(textInput => {
			textInput.setPlaceholder(placeholder)
				.setValue(this.plugin.settings[key])
				.onChange(async value => {
					this.plugin.settings[key] = value as never;
					await this.plugin.saveSettings();
				});
			if (secret || (this.plugin.settings.hideApiKeys && name.toLowerCase().includes("key"))) {
				textInput.inputEl.type = "password";
			}
		});
	}

	textarea<K extends StringKey>(el: HTMLElement, name: string, desc: string, key: K): void {
		new Setting(el).setName(name).setDesc(desc).addTextArea(textArea => textArea
			.setValue(this.plugin.settings[key])
			.onChange(async value => {
				this.plugin.settings[key] = value as never;
				await this.plugin.saveSettings();
			}));
	}

	number(el: HTMLElement, name: string, desc: string, key: NumberKey, min: number, max: number, step = 1): void {
		new Setting(el).setName(name).setDesc(desc).addText(textInput => {
			textInput.inputEl.type = "number";
			textInput.inputEl.min = String(min);
			textInput.inputEl.max = String(max);
			textInput.inputEl.step = String(step);
			textInput.inputEl.inputMode = "numeric";
			textInput.inputEl.addClass("selection-translator-number-input");
			textInput.setValue(String(this.plugin.settings[key])).onChange(async value => {
				const trimmedValue = value.trim();
				const numberValue = Number(trimmedValue);
				if (!trimmedValue || !Number.isFinite(numberValue)) {
					textInput.inputEl.addClass("is-invalid");
					return;
				}

				textInput.inputEl.removeClass("is-invalid");
				const clampedValue = Math.min(max, Math.max(min, Math.round(numberValue)));
				if (String(clampedValue) !== value) {
					textInput.setValue(String(clampedValue));
				}
				if (this.plugin.settings[key] === clampedValue) {
					return;
				}
				this.plugin.settings[key] = clampedValue;
				await this.plugin.saveSettings();
			});
			textInput.inputEl.addEventListener("blur", () => {
				const numberValue = Number(textInput.inputEl.value.trim());
				if (!Number.isFinite(numberValue)) {
					return;
				}
				const clampedValue = Math.min(max, Math.max(min, Math.round(numberValue)));
				textInput.setValue(String(clampedValue));
				textInput.inputEl.removeClass("is-invalid");
			});
		});
	}

	dropdown<K extends StringKey>(el: HTMLElement, name: string, desc: string, key: K, options: Record<string, string>, rerender = false): void {
		new Setting(el).setName(name).setDesc(desc).addDropdown(dropdown => {
			for (const [value, label] of Object.entries(options)) {
				dropdown.addOption(value, label);
			}
			dropdown.setValue(this.plugin.settings[key] as string).onChange(async value => {
				this.plugin.settings[key] = value as never;
				await this.plugin.saveSettings();
				if (rerender) {
					this.display();
				}
			});
		});
	}

	localeDropdown(el: HTMLElement): void {
		this.dropdown(
			el,
			this.t("settings.basic.interfaceLanguage.name"),
			this.t("settings.basic.interfaceLanguage.desc"),
			"pluginLanguage",
			getLocaleOptions(this.plugin),
			true,
		);
	}

	button(el: HTMLElement, name: string, desc: string, label: string, callback: (button: HTMLButtonElement) => void | Promise<void>): void {
		new Setting(el).setName(name).setDesc(desc).addButton(button => button.setButtonText(label).onClick(() => callback(button.buttonEl)));
	}
}
