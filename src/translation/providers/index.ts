import {TranslationProviderAdapter, TranslationProviderId} from "../types";
import {createAnthropicAdapter} from "./anthropic";
import {createGeminiAdapter} from "./gemini";
import {createOllamaAdapter} from "./ollama";
import {createOpenAIChatAdapter} from "./openai-chat";
import {createAwsTranslateAdapter, createAzureTranslatorAdapter, createBaiduAdapter, createDeepLAdapter, createDeepLXAdapter, createGoogleCloudTranslateAdapter, createYoudaoAdapter} from "./pure-translation";

export const ADAPTER_REGISTRY: Record<TranslationProviderId, TranslationProviderAdapter> = {
	openai: createOpenAIChatAdapter("openai", "OpenAI"),
	"openai-compatible": createOpenAIChatAdapter("openai-compatible", "OpenAI compatible"),
	deepseek: createOpenAIChatAdapter("deepseek", "DeepSeek"),
	openrouter: createOpenAIChatAdapter("openrouter", "OpenRouter"),
	ollama: createOllamaAdapter(),
	gemini: createGeminiAdapter(),
	anthropic: createAnthropicAdapter(),
	"google-cloud-translate": createGoogleCloudTranslateAdapter(),
	"azure-translator": createAzureTranslatorAdapter(),
	"aws-translate": createAwsTranslateAdapter(),
	deeplx: createDeepLXAdapter(),
	deepl: createDeepLAdapter(),
	baidu: createBaiduAdapter(),
	youdao: createYoudaoAdapter(),
};

export function getAdapter(providerId: TranslationProviderId): TranslationProviderAdapter {
	return ADAPTER_REGISTRY[providerId];
}
