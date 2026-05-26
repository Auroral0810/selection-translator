import type {ProviderModelInfo, TranslationProviderId, TranslationProviderConfig} from "../translation/types";

export const AI_PROVIDER_CHOICES: Array<{id: TranslationProviderId; label: string}> = [
	{id: "openai", label: "OpenAI"},
	{id: "openai-compatible", label: "OpenAI compatible"},
	{id: "deepseek", label: "DeepSeek"},
	{id: "openrouter", label: "OpenRouter"},
	{id: "gemini", label: "Gemini"},
	{id: "anthropic", label: "Claude"},
	{id: "ollama", label: "Ollama"},
];

export const MACHINE_PROVIDER_CHOICES: Array<{id: TranslationProviderId; label: string}> = [
	{id: "google-cloud-translate", label: "Google Cloud Translation"},
	{id: "azure-translator", label: "Azure Translator"},
	{id: "aws-translate", label: "AWS Translate"},
	{id: "deepl", label: "DeepL"},
	{id: "deeplx", label: "DeepLX"},
	{id: "baidu", label: "Baidu"},
	{id: "youdao", label: "Youdao"},
];

export const CUSTOM_MODEL_VALUE = "__custom__";

export function formatModelOption(model: ProviderModelInfo): string {
	if (model.name && model.name !== model.id) {
		return `${model.id} / ${model.name}`;
	}
	if (model.description) {
		return `${model.id} / ${model.description}`;
	}
	return model.id;
}

export function getModelSelectValue(config: TranslationProviderConfig, models: ProviderModelInfo[], forceCustomModel: boolean): string {
	if (forceCustomModel) {
		return CUSTOM_MODEL_VALUE;
	}
	if (!config.model) {
		return "";
	}
	return models.some(model => model.id === config.model) ? config.model : CUSTOM_MODEL_VALUE;
}
