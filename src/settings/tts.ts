import {Notice, Setting} from "obsidian";
import {getDefaultTtsConfig, type TtsConfig, type TtsProviderId, type TtsVoiceInfo} from "../tts/tts-service";
import type {TranslationSettingTab} from "./tab";

const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
	"web-speech": "Web Speech",
	"openai-tts": "OpenAI TTS",
	"azure-speech": "Azure Speech",
};

const voiceCache = new Map<TtsProviderId, TtsVoiceInfo[]>();

let showAdvancedTtsSettings = false;

export function displayTtsSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	tab.heading(el, "TTS");
	tab.toggle(el, tab.t("common.enabled"), "Enable speech playback through the TTS service. The first version only tests speech on this page.", "ttsEnabled");
	renderProvider(tab, el);
	renderBasicProviderConfig(tab, el);
	renderTest(tab, el);
	renderAdvancedToggle(tab, el);

	if (showAdvancedTtsSettings) {
		renderAdvancedSettings(tab, el);
	}
}

function renderProvider(tab: TranslationSettingTab, el: HTMLElement): void {
	new Setting(el)
		.setName(tab.t("settings.tts.provider.name"))
		.setDesc(tab.t("settings.tts.provider.desc"))
		.addDropdown(dropdown => {
			for (const [id, label] of Object.entries(TTS_PROVIDER_LABELS)) {
				dropdown.addOption(id, label);
			}
			dropdown.setValue(tab.plugin.settings.ttsProvider);
			dropdown.onChange(async value => {
				const provider = value as TtsProviderId;
				tab.plugin.ttsService.stop();
				tab.plugin.settings.ttsProvider = provider;
				tab.plugin.settings.ttsConfig = getDefaultTtsConfig(provider);
				tab.plugin.settings.ttsVoice = tab.plugin.settings.ttsConfig.voice;
				await tab.plugin.saveSettings();
				tab.display();
			});
		});
}

function renderBasicProviderConfig(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.ttsProvider;

	if (provider === "web-speech") {
		return;
	}

	if (provider === "openai-tts") {
		configText(tab, el, "API key", "Leave empty to reuse the current OpenAI/OpenAI compatible provider API key.", "apiKey", "Enter API key", true);
		return;
	}

	configText(tab, el, "API key", "Azure Speech resource key.", "apiKey", "", true);
	configText(tab, el, "Region", "Azure Speech resource region, for example eastus.", "region", "eastus");
}

function renderTest(tab: TranslationSettingTab, el: HTMLElement): void {
	let testText = tab.t("settings.tts.testDefaultText");
	new Setting(el)
		.setName(tab.t("settings.tts.testText.name"))
		.setDesc(tab.t("settings.tts.testText.desc"))
		.addTextArea(textarea => textarea
			.setValue(testText)
			.onChange(value => {
				testText = value;
			}));

	new Setting(el)
		.setName(tab.t("settings.tts.test.name"))
		.setDesc(tab.t("settings.tts.test.desc"))
		.addButton(button => button
			.setButtonText(tab.t("settings.tts.test.name"))
			.setCta()
			.onClick(async () => {
				button.setDisabled(true);
				const taskId = tab.plugin.taskLogManager.startTask("TTS test");
				try {
					await tab.plugin.ttsService.test(testText);
					tab.plugin.taskLogManager.complete(taskId, "TTS test completed.");
				} catch (error) {
					console.error("Failed to test TTS", error);
					tab.plugin.taskLogManager.fail(taskId, error instanceof Error ? error.message : "TTS test failed.");
				} finally {
					button.setDisabled(false);
				}
			}))
		.addButton(button => button
			.setButtonText(tab.t("common.stop"))
			.onClick(() => {
				tab.plugin.ttsService.stop();
				new Notice(tab.t("settings.tts.stopped"));
			}));
}

function renderAdvancedToggle(tab: TranslationSettingTab, el: HTMLElement): void {
	new Setting(el)
		.setName(tab.t("settings.tts.advanced.name"))
		.setDesc(tab.t("settings.tts.advanced.desc"))
		.addButton(button => button
			.setButtonText(showAdvancedTtsSettings ? tab.t("common.hide") : tab.t("common.show"))
			.onClick(() => {
				showAdvancedTtsSettings = !showAdvancedTtsSettings;
				tab.display();
			}));
}

function renderAdvancedSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.ttsProvider;

	tab.subheading(el, tab.t("settings.tts.advanced.name"));

	if (provider === "openai-tts") {
		configText(tab, el, "Base URL", "OpenAI API root URL.", "baseUrl", "https://api.openai.com/v1");
		configText(tab, el, "Model", "OpenAI TTS model.", "model", "gpt-4o-mini-tts");
		configText(tab, el, "Voice", "OpenAI voice, for example alloy, nova, or verse.", "voice", "alloy");
	} else if (provider === "azure-speech") {
		configText(tab, el, "Voice", "Azure voice short name, for example zh-CN-XiaoxiaoNeural.", "voice", "zh-CN-XiaoxiaoNeural");
	}

	renderVoice(tab, el);
	renderPlayback(tab, el);
}

function renderVoice(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.ttsProvider;
	const voices = voiceCache.get(provider) ?? [];
	const setting = new Setting(el)
		.setName(tab.t("settings.tts.voice.name"))
		.setDesc(voices.length > 0 ? tab.t("settings.tts.voice.descLoaded", {count: voices.length}) : tab.t("settings.tts.voice.descEmpty"));

	if (voices.length > 0) {
		setting.addDropdown(dropdown => {
			dropdown.addOption("", tab.t("settings.tts.voice.default"));
			for (const voice of voices) {
				dropdown.addOption(voice.id, formatVoice(voice));
			}
			dropdown.setValue(tab.plugin.settings.ttsVoice);
			dropdown.onChange(async value => {
				tab.plugin.settings.ttsVoice = value;
				tab.plugin.settings.ttsConfig = {
					...tab.plugin.settings.ttsConfig,
					voice: value,
				};
				await tab.plugin.saveSettings();
			});
		});
	}

	setting.addButton(button => button
		.setTooltip(tab.t("common.refresh"))
		.setIcon("refresh-cw")
		.onClick(async () => {
			button.setDisabled(true);
			const taskId = tab.plugin.taskLogManager.startTask(`Fetch TTS voices: ${TTS_PROVIDER_LABELS[provider]}`);
			try {
				const nextVoices = await tab.plugin.ttsService.listVoices();
				voiceCache.set(provider, nextVoices);
				tab.plugin.taskLogManager.complete(taskId, `Fetched ${nextVoices.length} voices.`);
				tab.display();
			} catch (error) {
				console.error("Failed to list TTS voices", error);
				tab.plugin.taskLogManager.fail(taskId, error instanceof Error ? error.message : "Unable to fetch TTS voices.");
				button.setDisabled(false);
			}
		}));
}

function renderPlayback(tab: TranslationSettingTab, el: HTMLElement): void {
	new Setting(el)
		.setName(tab.t("settings.tts.rate.name"))
		.setDesc(tab.t("settings.tts.rate.desc"))
		.addSlider(slider => slider
			.setLimits(0.5, 2, 0.1)
			.setValue(tab.plugin.settings.ttsRate)
			.setDynamicTooltip()
			.onChange(async value => {
				tab.plugin.settings.ttsRate = value;
				await tab.plugin.saveSettings();
			}));

	new Setting(el)
		.setName(tab.t("settings.tts.pitch.name"))
		.setDesc(tab.t("settings.tts.pitch.desc"))
		.addSlider(slider => slider
			.setLimits(0, 2, 0.1)
			.setValue(tab.plugin.settings.ttsPitch)
			.setDynamicTooltip()
			.onChange(async value => {
				tab.plugin.settings.ttsPitch = value;
				await tab.plugin.saveSettings();
			}));

	new Setting(el)
		.setName(tab.t("settings.tts.volume.name"))
		.setDesc(tab.t("settings.tts.volume.desc"))
		.addSlider(slider => slider
			.setLimits(0, 1, 0.05)
			.setValue(tab.plugin.settings.ttsVolume)
			.setDynamicTooltip()
			.onChange(async value => {
				tab.plugin.settings.ttsVolume = value;
				await tab.plugin.saveSettings();
			}));
}

function configText<K extends keyof TtsConfig>(
	tab: TranslationSettingTab,
	el: HTMLElement,
	name: string,
	desc: string,
	key: K,
	placeholder: string,
	secret = false
): void {
	new Setting(el)
		.setName(name)
		.setDesc(desc)
		.addText(text => {
			text.setPlaceholder(placeholder)
				.setValue(String(tab.plugin.settings.ttsConfig[key] ?? ""))
				.onChange(async value => {
					tab.plugin.settings.ttsConfig = {
						...tab.plugin.settings.ttsConfig,
						[key]: value,
					};
					if (key === "voice") {
						tab.plugin.settings.ttsVoice = value;
					}
					await tab.plugin.saveSettings();
				});
			if (secret || (tab.plugin.settings.hideApiKeys && isSecretField(name))) {
				text.inputEl.type = "password";
			}
		});
}

function formatVoice(voice: TtsVoiceInfo): string {
	if (voice.language) {
		return `${voice.name} / ${voice.language}`;
	}
	return voice.name;
}

function isSecretField(name: string): boolean {
	const normalized = name.toLowerCase();
	return normalized.includes("key") || normalized.includes("secret") || normalized.includes("token");
}
