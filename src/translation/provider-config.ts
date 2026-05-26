import type {TranslationPluginSettings} from "../settings";
import type {TranslationProviderConfig, TranslationProviderId, TranslationProviderKind} from "./types";

export const PROVIDER_LABELS: Record<TranslationProviderId, string> = {
	openai: "OpenAI",
	"openai-compatible": "OpenAI compatible",
	deepseek: "DeepSeek",
	openrouter: "OpenRouter",
	gemini: "Gemini",
	anthropic: "Claude",
	ollama: "Ollama",
	"google-cloud-translate": "Google Cloud Translation",
	"azure-translator": "Azure Translator",
	"aws-translate": "AWS Translate",
	deeplx: "DeepLX",
	deepl: "DeepL",
	baidu: "Baidu",
	youdao: "Youdao",
};

export const PROVIDER_KINDS: Record<TranslationProviderId, TranslationProviderKind> = {
	openai: "llm",
	"openai-compatible": "llm",
	deepseek: "llm",
	openrouter: "llm",
	gemini: "llm",
	anthropic: "llm",
	ollama: "llm",
	"google-cloud-translate": "pure-translation",
	"azure-translator": "pure-translation",
	"aws-translate": "pure-translation",
	deeplx: "pure-translation",
	deepl: "pure-translation",
	baidu: "pure-translation",
	youdao: "pure-translation",
};

export function getDefaultProviderConfig(provider: TranslationProviderId): TranslationProviderConfig {
	if (provider === "openai") {
		return createConfig({baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", temperature: 0.2});
	}
	if (provider === "deepseek") {
		return createConfig({baseUrl: "https://api.deepseek.com", model: "deepseek-chat", temperature: 0.2});
	}
	if (provider === "openrouter") {
		return createConfig({baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini", temperature: 0.2});
	}
	if (provider === "openai-compatible") {
		return createConfig({temperature: 0.2});
	}
	if (provider === "gemini") {
		return createConfig({baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash", temperature: 0.2});
	}
	if (provider === "anthropic") {
		return createConfig({baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest", temperature: 0.2});
	}
	if (provider === "ollama") {
		return createConfig({baseUrl: "http://localhost:11434", model: "qwen2.5:7b", temperature: 0.2});
	}
	if (provider === "google-cloud-translate") {
		return createConfig({baseUrl: "https://translation.googleapis.com/language/translate/v2"});
	}
	if (provider === "azure-translator") {
		return createConfig({baseUrl: "https://api.cognitive.microsofttranslator.com", region: "eastus"});
	}
	if (provider === "aws-translate") {
		return createConfig({baseUrl: "https://translate.{region}.amazonaws.com", region: "us-east-1"});
	}
	if (provider === "deeplx") {
		return createConfig({baseUrl: "https://api.deeplx.org"});
	}
	if (provider === "deepl") {
		return createConfig({apiType: "free"});
	}
	if (provider === "baidu" || provider === "youdao") {
		return createConfig();
	}
	return createConfig();
}

export function getCurrentProviderConfig(settings: TranslationPluginSettings): TranslationProviderConfig {
	return {
		...getDefaultProviderConfig(settings.currentProvider),
		...settings.currentProviderConfig,
	};
}

function createConfig(patch: Partial<TranslationProviderConfig> = {}): TranslationProviderConfig {
	return {
		apiKey: "",
		baseUrl: "",
		model: "",
		temperature: 0,
		appId: "",
		appSecret: "",
		apiType: "",
		region: "",
		accessKeyId: "",
		...patch,
	};
}
