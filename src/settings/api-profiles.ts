import {Setting} from "obsidian";
import {getDefaultProviderConfig, PROVIDER_KINDS, PROVIDER_LABELS} from "../translation/provider-config";
import type {ProviderModelInfo, TranslationProviderConfig, TranslationProviderId, TranslationProviderKind} from "../translation/types";
import {AI_PROVIDER_CHOICES, CUSTOM_MODEL_VALUE, MACHINE_PROVIDER_CHOICES, formatModelOption, getModelSelectValue} from "./provider-config-utils";
import type {TranslationSettingTab} from "./tab";

const modelCache = new Map<TranslationProviderId, ProviderModelInfo[]>();
const customModelProviders = new Set<TranslationProviderId>();

const READONLY_BASE_URL_PROVIDERS = new Set<TranslationProviderId>([
	"openai",
	"deepseek",
	"openrouter",
	"gemini",
	"anthropic",
	"google-cloud-translate",
	"azure-translator",
	"aws-translate",
]);

export function displayApiProfileSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	tab.heading(el, tab.t("settings.api.heading"));
	renderCurrentProvider(tab, el);
	renderProviderPickerSection(tab, el, tab.t("settings.api.ai.heading"), tab.t("settings.api.ai.desc"), "llm", AI_PROVIDER_CHOICES);
	renderProviderPickerSection(tab, el, tab.t("settings.api.machine.heading"), tab.t("settings.api.machine.desc"), "pure-translation", MACHINE_PROVIDER_CHOICES);
	renderRequestSettings(tab, el);
}

function renderCurrentProvider(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.currentProvider;
	new Setting(el)
		.setName(tab.t("settings.api.currentProvider.name"))
		.setDesc(`${PROVIDER_LABELS[provider]} / ${getKindLabel(tab, PROVIDER_KINDS[provider])}`)
		.addButton(button => button
			.setButtonText(tab.t("settings.api.checkConfig"))
			.onClick(() => checkCurrentProviderConfig(tab)))
		.addButton(button => button
			.setButtonText(tab.t("settings.api.testTranslation"))
			.setCta()
			.onClick(() => testTranslation(tab)));
}

function renderProviderPickerSection(
	tab: TranslationSettingTab,
	el: HTMLElement,
	title: string,
	desc: string,
	kind: TranslationProviderKind,
	choices: Array<{id: TranslationProviderId; label: string}>,
): void {
	const provider = tab.plugin.settings.currentProvider;
	const activeKind = PROVIDER_KINDS[provider];
	tab.subheading(el, title);

	new Setting(el)
		.setName(tab.t("settings.api.service.name"))
		.setDesc(desc)
		.addDropdown(dropdown => {
			dropdown.addOption("", tab.t("settings.api.pickService", {service: title}));
			for (const option of choices) {
				dropdown.addOption(option.id, option.label);
			}
			dropdown.setValue(activeKind === kind ? provider : "");
			dropdown.onChange(async value => {
				if (!value) {
					return;
				}
				await selectProvider(tab, value as TranslationProviderId);
			});
		});

	if (activeKind === kind) {
		renderProviderFields(tab, el);
	}
}

function renderProviderFields(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.currentProvider;
	const draft = {...tab.plugin.settings.currentProviderConfig};

	if (provider === "deeplx") {
		configText(tab, el, draft, "Base URL", "DeepLX instance URL, for example https://api.deeplx.org or your self-hosted endpoint.", "baseUrl", "https://api.deeplx.org");
		configText(tab, el, draft, "API key / token", "Optional token if your DeepLX instance requires one.", "apiKey", "", true);
		renderSaveConfig(tab, el, draft);
		return;
	}

	if (provider === "google-cloud-translate") {
		renderReadonlyBaseUrl(el, draft);
		configText(tab, el, draft, "API key", "Google Cloud Translation Basic v2 API key.", "apiKey", "AIza...", true);
		renderSaveConfig(tab, el, draft);
		return;
	}

	if (provider === "azure-translator") {
		renderReadonlyBaseUrl(el, draft);
		configText(tab, el, draft, "API key", "Azure Translator resource key.", "apiKey", "", true);
		configText(tab, el, draft, "Region", "Azure Translator resource region, for example eastus.", "region", "eastus");
		renderSaveConfig(tab, el, draft);
		return;
	}

	if (provider === "aws-translate") {
		renderReadonlyBaseUrl(el, draft);
		configText(tab, el, draft, "Access key ID", "AWS IAM access key ID.", "accessKeyId", "AKIA...", true);
		configText(tab, el, draft, "Secret access key", "AWS IAM secret access key.", "appSecret", "", true);
		configText(tab, el, draft, "Region", "AWS Translate region, for example us-east-1.", "region", "us-east-1");
		renderSaveConfig(tab, el, draft);
		return;
	}

	if (provider === "baidu" || provider === "youdao") {
		configText(tab, el, draft, provider === "baidu" ? "App ID" : "App key", "Application ID or key from the provider console.", "appId", "", true);
		configText(tab, el, draft, "App secret", "Application secret from the provider console.", "appSecret", "", true);
		renderSaveConfig(tab, el, draft);
		return;
	}

	configText(tab, el, draft, "API key", provider === "ollama" ? "Local Ollama usually does not require an API key." : "API key from the provider console.", "apiKey", "Enter API key", true);
	if (PROVIDER_KINDS[provider] === "llm") {
		if (READONLY_BASE_URL_PROVIDERS.has(provider)) {
			renderReadonlyBaseUrl(el, draft);
		} else {
			configText(tab, el, draft, "Base URL", "API root URL. OpenAI compatible providers must use their own endpoint.", "baseUrl", provider === "openai-compatible" ? "https://your-provider.example/v1" : "https://...");
		}
		renderModelSetting(tab, el, draft);
		configNumber(tab, el, draft, "Max output tokens", "Maximum translation output tokens for LLM providers. Use 0 to keep the provider default.", "maxOutputTokens", "0");
	}
	if (provider === "deepl") {
		configText(tab, el, draft, "API type", "Use free or pro.", "apiType", "free");
	}
	renderSaveConfig(tab, el, draft);
}

function renderReadonlyBaseUrl(el: HTMLElement, config: TranslationProviderConfig): void {
	new Setting(el)
		.setName("Base URL")
		.setDesc(config.baseUrl || "-")
		.addText(text => {
			text.setValue(config.baseUrl || "");
			text.setDisabled(true);
		});
}

function renderModelSetting(tab: TranslationSettingTab, el: HTMLElement, draft: TranslationProviderConfig): void {
	const provider = tab.plugin.settings.currentProvider;
	const cachedModels = modelCache.get(provider) ?? [];
	const hasModels = cachedModels.length > 0;
	const force = customModelProviders.has(provider);
	const customMode = !hasModels || getModelSelectValue(draft, cachedModels, force) === CUSTOM_MODEL_VALUE;

	const setting = new Setting(el)
		.setName("Model")
		.setDesc(hasModels ? tab.t("settings.api.model.descWithCache", {count: cachedModels.length}) : tab.t("settings.api.model.descEmpty"));

	if (hasModels) {
		setting.addDropdown(dropdown => {
			if (!draft.model) {
				dropdown.addOption("", tab.t("settings.api.model.pick"));
			}
			for (const model of cachedModels) {
				dropdown.addOption(model.id, formatModelOption(model));
			}
			dropdown.addOption(CUSTOM_MODEL_VALUE, tab.t("settings.api.model.custom"));
			dropdown.setValue(customMode ? CUSTOM_MODEL_VALUE : draft.model);
			dropdown.onChange(value => {
				if (value === CUSTOM_MODEL_VALUE) {
					customModelProviders.add(provider);
					tab.display();
					return;
				}
				draft.model = value;
				if (customMode) {
					customModelProviders.delete(provider);
					void saveCurrentConfig(tab, draft).then(() => tab.display());
				}
			});
		});
	}

	if (customMode) {
		renderCustomModelInput(setting, draft);
	}

	setting.addButton(button => {
		button.setTooltip(tab.t("settings.api.model.refresh")).setIcon("refresh-cw");
		button.onClick(async () => {
			await saveCurrentConfig(tab, draft);
			await fetchModels(tab, button, provider);
		});
	});
}

function renderSaveConfig(tab: TranslationSettingTab, el: HTMLElement, draft: TranslationProviderConfig): void {
	new Setting(el)
		.setName(tab.t("settings.api.saveConfig.name"))
		.setDesc(tab.t("settings.api.saveConfig.desc"))
		.addButton(button => button
			.setButtonText(tab.t("settings.api.saveConfig.name"))
			.setCta()
			.onClick(async () => {
				await saveCurrentConfig(tab, draft);
				if (shouldAutoFetchModels(tab.plugin.settings.currentProvider, draft)) {
					await fetchModels(tab, button, tab.plugin.settings.currentProvider);
				} else {
					tab.plugin.taskLogManager.complete(tab.plugin.taskLogManager.startTask(tab.t("settings.api.saveConfig.name")), tab.t("settings.api.configSaved"));
				}
				tab.display();
			}));
}

function renderRequestSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	tab.subheading(el, tab.t("settings.api.request.heading"));
	tab.number(el, tab.t("settings.api.timeout.name"), tab.t("settings.api.timeout.desc"), "requestTimeout", 1000, 120000, 1000);
	tab.number(el, tab.t("settings.api.retries.name"), tab.t("settings.api.retries.desc"), "maxRetries", 0, 5);
	tab.number(el, tab.t("settings.api.queueRate.name"), tab.t("settings.api.queueRate.desc"), "immersiveQueueRate", 1, 10);
	tab.number(el, tab.t("settings.api.queueCapacity.name"), tab.t("settings.api.queueCapacity.desc"), "immersiveQueueCapacity", 1, 10);
}

async function selectProvider(tab: TranslationSettingTab, provider: TranslationProviderId): Promise<void> {
	tab.plugin.settings.currentProvider = provider;
	tab.plugin.settings.currentProviderConfig = getDefaultProviderConfig(provider);
	customModelProviders.delete(provider);
	await tab.plugin.saveSettings();
	tab.display();
}

async function saveCurrentConfig(tab: TranslationSettingTab, draft: TranslationProviderConfig): Promise<void> {
	const provider = tab.plugin.settings.currentProvider;
	tab.plugin.settings.currentProviderConfig = {
		...getDefaultProviderConfig(provider),
		...draft,
	};
	await tab.plugin.saveSettings();
}

async function fetchModels(tab: TranslationSettingTab, button: {setDisabled(value: boolean): unknown}, provider: TranslationProviderId): Promise<void> {
	const taskId = startSettingsTask(tab, tab.t("task.fetchModels", {provider: PROVIDER_LABELS[provider]}));
	button.setDisabled(true);
	try {
		tab.plugin.taskLogManager.append(taskId, `${tab.t("task.provider", {provider: PROVIDER_LABELS[provider]})}\n`);
		tab.plugin.taskLogManager.append(taskId, `${tab.t("task.baseUrl", {baseUrl: tab.plugin.settings.currentProviderConfig.baseUrl || "-"})}\n`);
		const models = await tab.plugin.translateService.listModels();
		modelCache.set(provider, models);
		tab.plugin.taskLogManager.append(taskId, `${tab.t("task.modelsFetched", {count: models.length})}\n`);
		tab.plugin.taskLogManager.complete(taskId, tab.t("task.modelsFetched", {count: models.length}));
		tab.display();
	} catch (error) {
		console.error("Failed to list provider models", error);
		const message = error instanceof Error ? shortenError(tab, error.message) : tab.t("settings.api.errorGeneric");
		tab.plugin.taskLogManager.append(taskId, `${tab.t("task.fetchFailed", {message})}\n`);
		tab.plugin.taskLogManager.fail(taskId, tab.t("settings.api.fetchModelsFailure"));
		button.setDisabled(false);
	}
}

function shouldAutoFetchModels(provider: TranslationProviderId, config: TranslationProviderConfig): boolean {
	if (PROVIDER_KINDS[provider] !== "llm") {
		return false;
	}
	if (provider === "ollama") {
		return Boolean(config.baseUrl);
	}
	return Boolean(config.apiKey && config.baseUrl);
}

async function checkCurrentProviderConfig(tab: TranslationSettingTab): Promise<void> {
	const provider = tab.plugin.settings.currentProvider;
	const taskId = startSettingsTask(tab, `${tab.t("settings.api.checkConfig")}: ${PROVIDER_LABELS[provider]}`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.provider", {provider: PROVIDER_LABELS[provider]})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.serviceType", {type: getKindLabel(tab, PROVIDER_KINDS[provider])})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.baseUrl", {baseUrl: tab.plugin.settings.currentProviderConfig.baseUrl || "-"})}\n`);
	try {
		await tab.plugin.translateService.testProvider();
		tab.plugin.taskLogManager.append(taskId, `${tab.t("settings.api.configCheckSuccess")}\n`);
		tab.plugin.taskLogManager.complete(taskId, tab.t("settings.api.configCheckSuccess"));
	} catch (error) {
		const message = error instanceof Error ? shortenError(tab, error.message) : tab.t("settings.api.configCheckFailure");
		tab.plugin.taskLogManager.append(taskId, `${tab.t("settings.api.configCheckFailure")}: ${message}\n`);
		tab.plugin.taskLogManager.fail(taskId, tab.t("settings.api.configCheckFailure"));
	}
}

async function testTranslation(tab: TranslationSettingTab): Promise<void> {
	const provider = tab.plugin.settings.currentProvider;
	const taskId = startSettingsTask(tab, `${tab.t("settings.api.testTranslation")}: ${PROVIDER_LABELS[provider]}`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.provider", {provider: PROVIDER_LABELS[provider]})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.serviceType", {type: getKindLabel(tab, PROVIDER_KINDS[provider])})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.model", {model: tab.plugin.settings.currentProviderConfig.model || "-"})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.targetLanguage", {language: tab.plugin.settings.targetLanguage})}\n`);
	tab.plugin.taskLogManager.append(taskId, `${tab.t("task.sourceText", {text: "Hello, world."})}\n`);
	try {
		const result = await tab.plugin.translateService.translateWithCache({
			text: "Hello, world.",
			sourceLanguage: "en",
			targetLanguage: tab.plugin.settings.targetLanguage,
			settings: tab.plugin.settings,
		}, {
			bypassCache: true,
			cacheScope: "settings-test",
		});
		tab.plugin.taskLogManager.append(taskId, `${tab.t("task.translation", {text: result.text})}\n`);
		tab.plugin.taskLogManager.complete(taskId, tab.t("settings.api.testSuccess"));
	} catch (error) {
		const message = error instanceof Error ? shortenError(tab, error.message) : tab.t("settings.api.testFailure");
		tab.plugin.taskLogManager.append(taskId, `${tab.t("settings.api.testFailure")}: ${message}\n`);
		tab.plugin.taskLogManager.fail(taskId, tab.t("settings.api.testFailure"));
	}
}

function configText<K extends keyof TranslationProviderConfig>(
	tab: TranslationSettingTab,
	el: HTMLElement,
	draft: TranslationProviderConfig,
	name: string,
	desc: string,
	key: K,
	placeholder: string,
	secret = false
): void {
	new Setting(el).setName(name).setDesc(desc).addText(text => {
		text.setPlaceholder(placeholder)
			.setValue(String(draft[key] ?? ""))
			.onChange(value => {
				// Only assign string values to string fields, not to numeric fields
				if (typeof draft[key] === 'string' || draft[key] === undefined || draft[key] === null) {
					draft[key] = value as TranslationProviderConfig[K];
				}
			});
		if (secret || (tab.plugin.settings.hideApiKeys && isSecretField(name))) {
			text.inputEl.type = "password";
		}
	});
}

function configNumber(
	tab: TranslationSettingTab,
	el: HTMLElement,
	draft: TranslationProviderConfig,
	name: string,
	desc: string,
	key: keyof Pick<TranslationProviderConfig, "maxOutputTokens">,
	placeholder: string
): void {
	new Setting(el).setName(name).setDesc(desc).addText(text => {
		text.setPlaceholder(placeholder)
			.setValue(String(draft[key] ?? ""))
			.onChange(value => {
				const trimmed = value.trim();
				if (trimmed === "") {
					draft[key] = 0;
					return;
				}
				const parsed = Number(trimmed);
				// Use parsed value directly if valid, otherwise keep current or default to 0
				draft[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : (draft[key] ?? 0);
			});
	});
}

function renderCustomModelInput(setting: Setting, draft: TranslationProviderConfig): void {
	setting.addText(text => {
		text.setPlaceholder("Enter model ID")
			.setValue(draft.model)
			.onChange(value => {
				draft.model = value;
			});
	});
}

function getKindLabel(tab: TranslationSettingTab, kind: TranslationProviderKind): string {
	return kind === "llm" ? tab.t("kind.llm") : tab.t("kind.pure");
}

function isSecretField(name: string): boolean {
	const normalized = name.toLowerCase();
	return normalized.includes("key") || normalized.includes("secret") || normalized.includes("token");
}

function startSettingsTask(tab: TranslationSettingTab, title: string): string {
	return tab.plugin.taskLogManager.startTask(title);
}

function shortenError(tab: TranslationSettingTab, message: string): string {
	const normalized = message.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return tab.t("settings.api.errorGeneric");
	}
	return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}
