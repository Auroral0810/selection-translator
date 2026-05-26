import type {TranslationPluginSettings} from "../settings";

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TARGET_LANGUAGE_PATTERNS: Record<string, RegExp> = {
	"zh-CN": /[\p{Script=Han}]/u,
	"zh-TW": /[\p{Script=Han}]/u,
	ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
	ko: /[\p{Script=Hangul}]/u,
};

type WordSegment = {
	isWordLike?: boolean;
};

type SegmenterConstructor = new (
	locale: string,
	options: {granularity: "word"}
) => {
	segment(text: string): Iterable<WordSegment>;
};

export interface TranslationFilterOptions {
	minCharacters?: number;
	minWords?: number;
}

export function shouldTranslateText(text: string, settings: TranslationPluginSettings, options: TranslationFilterOptions = {}): boolean {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return false;
	}

	const minCharacters = options.minCharacters ?? settings.immersiveMinCharacters;
	const minWords = options.minWords ?? settings.immersiveMinWords;

	if (minCharacters > 0 && normalized.length < minCharacters) {
		return false;
	}

	if (minWords > 0 && countWords(normalized, settings.sourceLanguage) < minWords) {
		return false;
	}

	if (settings.immersiveSkipTargetLanguage && looksLikeTargetLanguage(normalized, settings.targetLanguage)) {
		return false;
	}

	return true;
}

export function countWords(text: string, language: string): number {
	if (CJK_PATTERN.test(text)) {
		return Array.from(text).filter(char => /\p{Letter}/u.test(char)).length;
	}

	try {
		const locale = language === "auto" ? "en" : language;
		const Segmenter = (Intl as unknown as {Segmenter?: SegmenterConstructor}).Segmenter;
		if (!Segmenter) {
			return text.split(/\s+/).filter(Boolean).length;
		}
		const segmenter = new Segmenter(locale, {granularity: "word"});
		return Array.from(segmenter.segment(text)).filter(segment => segment.isWordLike).length;
	} catch {
		return text.split(/\s+/).filter(Boolean).length;
	}
}

function looksLikeTargetLanguage(text: string, targetLanguage: string): boolean {
	const pattern = TARGET_LANGUAGE_PATTERNS[targetLanguage];
	if (!pattern) {
		return false;
	}

	return pattern.test(text);
}
