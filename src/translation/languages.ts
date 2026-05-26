export function normalizeLanguageForProvider(language: string, provider: string): string {
	if (language === "auto") {
		return provider === "deepl" ? "" : "auto";
	}

	const maps: Record<string, Record<string, string>> = {
		deepl: {
			"zh-CN": "ZH-HANS",
			"zh-TW": "ZH-HANT",
			en: "EN-US",
			ja: "JA",
			ko: "KO",
			fr: "FR",
			de: "DE",
			es: "ES",
			pt: "PT-PT",
			it: "IT",
			ru: "RU",
			nl: "NL",
			pl: "PL",
			sv: "SV",
		},
		baidu: {
			"zh-CN": "zh",
			"zh-TW": "cht",
			en: "en",
			ja: "jp",
			ko: "kor",
			fr: "fra",
			de: "de",
			es: "spa",
			pt: "pt",
			it: "it",
			ru: "ru",
			ar: "ara",
			th: "th",
			vi: "vie",
		},
		youdao: {
			"zh-CN": "zh-CHS",
			"zh-TW": "zh-CHT",
			en: "en",
			ja: "ja",
			ko: "ko",
			fr: "fr",
			de: "de",
			es: "es",
			pt: "pt",
			it: "it",
			ru: "ru",
			ar: "ar",
			hi: "hi",
			vi: "vi",
			id: "id",
		},
		deeplx: {
			"zh-CN": "ZH",
			"zh-TW": "ZH-HANT",
			en: "EN",
			ja: "JA",
			ko: "KO",
			fr: "FR",
			de: "DE",
			es: "ES",
			pt: "PT",
			it: "IT",
			ru: "RU",
			nl: "NL",
			pl: "PL",
			sv: "SV",
		},
		"google-cloud-translate": {
			"zh-CN": "zh-CN",
			"zh-TW": "zh-TW",
		},
		"azure-translator": {
			"zh-CN": "zh-Hans",
			"zh-TW": "zh-Hant",
		},
		"aws-translate": {
			"zh-CN": "zh",
			"zh-TW": "zh-TW",
		},
	};

	return maps[provider]?.[language] ?? language;
}
