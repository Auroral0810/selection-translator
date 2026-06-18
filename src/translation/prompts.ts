import type {TranslationPluginSettings} from "../settings";
import type {TranslateRequest} from "./types";

export const DEFAULT_TRANSLATION_PROMPT_ID = "__default__";
export const BATCH_TRANSLATION_SEPARATOR = "%%";

export const DEFAULT_TRANSLATION_SYSTEM_PROMPT = `You are a professional {{targetLanguage}} native translator.

## Translation rules
1. Output only the translated content. Do not add explanations, notes, or prefixes.
2. Preserve the original Markdown structure, paragraph count, line breaks, inline formatting, links, and HTML tags where possible.
3. Keep code, commands, proper nouns, file paths, URLs, and plugin syntax unchanged unless translation is clearly required.
4. Use the provided note context only to resolve meaning and terminology. Do not summarize or rewrite the source.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`;

export const DEFAULT_TRANSLATION_USER_PROMPT = `Translate to {{targetLanguage}}:

{{input}}`;

export const DEFAULT_BATCH_TRANSLATION_PROMPT = `## Multi-block translation rules
1. If the input contains ${BATCH_TRANSLATION_SEPARATOR}, keep exactly the same separator in the output.
2. Translate each block independently while using the shared context.
3. Do not merge, reorder, add, or remove blocks.
4. Preserve one blank line before and after each separator.`;

export interface BuiltTranslationPrompt {
	systemPrompt: string;
	userPrompt: string;
	promptId: string;
}

export interface TranslationPromptPreset {
	id: string;
	name: string;
	description: string;
	systemPrompt: string;
	userPrompt: string;
}

export type TranslationPromptUseCase = "immersive" | "translated-file";

export const TRANSLATION_PROMPT_PRESETS: TranslationPromptPreset[] = [
	{
		id: "general",
		name: "通用翻译",
		description: "适合日常笔记和普通段落，优先自然、准确并保留 Markdown。",
		systemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
	{
		id: "technical",
		name: "技术文档",
		description: "保留代码、命令、API、术语和 Markdown 结构，适合开发文档。",
		systemPrompt: `You are a professional technical translator translating into {{targetLanguage}}.

## Translation rules
1. Output only the translated content.
2. Preserve Markdown structure, headings, lists, tables, links, inline code, code blocks, HTML tags, and line breaks.
3. Keep code, commands, identifiers, API names, package names, file paths, URLs, config keys, and product names unchanged unless a standard translation is obvious.
4. Translate technical explanations accurately and consistently. Prefer common engineering terminology over literal wording.
5. Use the note context only to resolve terms and references. Do not summarize or add commentary.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
	{
		id: "academic",
		name: "学术论文",
		description: "更正式、严谨，适合论文、研究笔记和长篇资料。",
		systemPrompt: `You are a professional academic translator translating into {{targetLanguage}}.

## Translation rules
1. Output only the translated content.
2. Use a formal, precise, and academically appropriate style.
3. Preserve citations, formulas, variables, figure/table references, Markdown, links, and paragraph structure.
4. Keep proper nouns, author names, technical terms, and abbreviations consistent.
5. Do not simplify, summarize, expand, or add interpretation beyond the source.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
	{
		id: "polished-notes",
		name: "笔记润色翻译",
		description: "译文更顺滑自然，但不扩写、不总结，适合个人知识库。",
		systemPrompt: `You are a native {{targetLanguage}} translator for personal knowledge notes.

## Translation rules
1. Output only the translated content.
2. Translate faithfully, but make the result read naturally in {{targetLanguage}}.
3. Keep the original meaning, paragraph count, Markdown structure, links, and inline formatting.
4. Do not add examples, summaries, explanations, or new claims.
5. Keep code, commands, URLs, file paths, and proper nouns unchanged unless translation is clearly required.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
	{
		id: "bilingual-reading",
		name: "双语阅读",
		description: "短句清晰，利于逐段对照阅读，适合沉浸式翻译。",
		systemPrompt: `You are a concise translator for bilingual reading into {{targetLanguage}}.

## Translation rules
1. Output only the translated content.
2. Keep sentences clear and easy to compare with the source.
3. Preserve paragraph count, Markdown structure, lists, links, and line breaks.
4. Prefer direct, readable wording over ornate phrasing.
5. Keep code, commands, URLs, file paths, and proper nouns unchanged unless translation is clearly required.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
	{
		id: "strict-markdown",
		name: "严格 Markdown 保真",
		description: "优先不破坏表格、列表、callout 和链接，适合复杂 Markdown。",
		systemPrompt: `You are a structure-preserving translator translating into {{targetLanguage}}.

## Translation rules
1. Output only the translated content.
2. Translate human-readable prose only. Do not translate or rewrite markup, syntax, tags, attributes, code, commands, formulas, variables, placeholders, escape sequences, links, images, or plugin syntax.
3. Preserve Markdown, HTML, XML, JSX, LaTeX, template syntax, task lists, blockquotes, callouts, footnotes, tables, code fences, inline formatting, indentation, blank lines, separators, and line breaks.
4. Do not translate tag names such as <table>, <tr>, <td>, <th>, <div>, <span>, <br>, <img>, and <a>. Do not change attributes or attribute values such as rowspan, colspan, class, style, href, src, id, alt, title, and data-*.
5. Preserve the same HTML nesting order, Markdown table rows and cells, HTML table rows and cells, list markers, checkboxes, delimiters, and surrounding punctuation.
6. Keep common English technical terms, abbreviations, model names, product names, dataset names, metric names, and units unchanged when they are normally used in English, such as token, API, URL, HTML, Markdown, RAG, LLM, GPU, Qwen3-4B, GPT-4.1-mini, and Mem-α.

## Note context
File title: {{fileTitle}}
Current heading: {{heading}}
Heading summary: {{headingSummary}}
File summary: {{fileSummary}}`,
		userPrompt: DEFAULT_TRANSLATION_USER_PROMPT,
	},
];

const INTERNAL_PROMPT_PRESET_IDS = new Set(["bilingual-reading", "strict-markdown"]);

export const USER_TRANSLATION_PROMPT_PRESETS: TranslationPromptPreset[] = TRANSLATION_PROMPT_PRESETS
	.filter(preset => !INTERNAL_PROMPT_PRESET_IDS.has(preset.id));

export function buildTranslationPrompt(settings: TranslationPluginSettings, request: TranslateRequest): BuiltTranslationPrompt {
	const preset = getActivePromptPreset(settings);
	return buildPromptFromPreset(preset, request);
}

export function buildPromptFromPreset(preset: TranslationPromptPreset | null, request: TranslateRequest): BuiltTranslationPrompt {
	const systemTemplate = preset?.systemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT;
	const userTemplate = preset?.userPrompt || DEFAULT_TRANSLATION_USER_PROMPT;
	const tokens = getPromptTokens(request);
	const systemPrompt = replacePromptTokens(systemTemplate, tokens);

	return {
		systemPrompt: request.text.includes(BATCH_TRANSLATION_SEPARATOR)
			? `${systemPrompt}\n\n${DEFAULT_BATCH_TRANSLATION_PROMPT}`
			: systemPrompt,
		userPrompt: replacePromptTokens(userTemplate, tokens),
		promptId: preset?.id ?? DEFAULT_TRANSLATION_PROMPT_ID,
	};
}

export function getActivePromptPreset(settings: TranslationPluginSettings): TranslationPromptPreset | null {
	if (!settings.translationPromptId) {
		return null;
	}
	return USER_TRANSLATION_PROMPT_PRESETS.find(preset => preset.id === settings.translationPromptId) ?? null;
}

export function getPromptPresetForUseCase(useCase: TranslationPromptUseCase): TranslationPromptPreset | null {
	const presetId = useCase === "immersive" ? "bilingual-reading" : "strict-markdown";
	return TRANSLATION_PROMPT_PRESETS.find(preset => preset.id === presetId) ?? null;
}

export function replacePromptTokens(template: string, tokens: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(tokens)) {
		result = result.split(`{{${key}}}`).join(value);
	}
	return result;
}

function getPromptTokens(request: TranslateRequest): Record<string, string> {
	return {
		targetLanguage: request.targetLanguage || "",
		sourceLanguage: request.sourceLanguage || "",
		input: request.text || "",
		fileTitle: request.promptContext?.fileTitle ?? "",
		heading: request.promptContext?.heading ?? "",
		headingSummary: request.promptContext?.headingSummary ?? "",
		fileSummary: request.promptContext?.fileSummary ?? "",
	};
}
