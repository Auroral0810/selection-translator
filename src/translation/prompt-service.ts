import type TranslationPlugin from "../main";
import {
	BuiltTranslationPrompt,
	TranslationPromptPreset,
	TranslationPromptUseCase,
	USER_TRANSLATION_PROMPT_PRESETS,
	buildPromptFromPreset,
	buildTranslationPrompt,
	getPromptPresetForUseCase,
} from "./prompts";
import type {TranslateRequest, TranslationPromptContext} from "./types";

export interface PromptService {
	build(request: TranslateRequest): BuiltTranslationPrompt;
	buildForUseCase(request: TranslateRequest, useCase: TranslationPromptUseCase): BuiltTranslationPrompt;
	listPresets(): TranslationPromptPreset[];
	preview(input: string, context?: TranslationPromptContext): BuiltTranslationPrompt;
}

export class DefaultPromptService implements PromptService {
	constructor(private readonly plugin: TranslationPlugin) {}

	build(request: TranslateRequest): BuiltTranslationPrompt {
		return buildTranslationPrompt(request.settings, request);
	}

	buildForUseCase(request: TranslateRequest, useCase: TranslationPromptUseCase): BuiltTranslationPrompt {
		return buildPromptFromPreset(getPromptPresetForUseCase(useCase), request);
	}

	listPresets(): TranslationPromptPreset[] {
		return USER_TRANSLATION_PROMPT_PRESETS;
	}

	preview(input: string, context: TranslationPromptContext = {}): BuiltTranslationPrompt {
		return this.build({
			text: input,
			sourceLanguage: this.plugin.settings.sourceLanguage,
			targetLanguage: this.plugin.settings.targetLanguage,
			settings: this.plugin.settings,
			promptContext: context,
		});
	}
}
