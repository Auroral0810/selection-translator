import type {TranslationPluginSettings} from "../settings";
import type {BuiltTranslationPrompt} from "./prompts";

export type TranslationProviderKind = "pure-translation" | "llm";
export type TranslationProviderId = "openai" | "openai-compatible" | "deepseek" | "openrouter" | "gemini" | "anthropic" | "ollama" | "google-cloud-translate" | "azure-translator" | "aws-translate" | "deeplx" | "deepl" | "baidu" | "youdao";

export interface TranslationProviderConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	appId: string;
	appSecret: string;
	apiType: string;
	region: string;
	accessKeyId: string;
}

export interface TranslationPromptProfile {
	id: string;
	name: string;
	systemPrompt: string;
	userPrompt: string;
}

export interface TranslationPromptContext {
	fileTitle?: string;
	heading?: string;
	headingSummary?: string;
	fileSummary?: string;
}

export interface TranslateRequest {
	text: string;
	sourceLanguage: string;
	targetLanguage: string;
	settings: TranslationPluginSettings;
	providerConfig?: TranslationProviderConfig;
	promptContext?: TranslationPromptContext;
	builtPrompt?: BuiltTranslationPrompt;
}

export interface TranslateResult {
	text: string;
	provider: TranslationProviderId;
	sourceLanguage?: string;
	targetLanguage: string;
	raw?: unknown;
}

export interface ProviderModelInfo {
	id: string;
	name?: string;
	description?: string;
}

export interface TranslationProviderAdapter {
	id: TranslationProviderId;
	label: string;
	kind: TranslationProviderKind;
	translate(request: TranslateRequest): Promise<TranslateResult>;
	testConnection(config: TranslationProviderConfig, settings: TranslationPluginSettings): void | Promise<void>;
	listModels?(config: TranslationProviderConfig, settings: TranslationPluginSettings): Promise<ProviderModelInfo[]>;
}
