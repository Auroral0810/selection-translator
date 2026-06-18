import {Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {formatTranslationError} from "../translation/errors";

export async function openTranslatedFileOnRight(plugin: TranslationPlugin): Promise<void> {
	const file = plugin.app.workspace.getActiveFile();

	if (!file || file.extension !== "md") {
		new Notice(t(plugin, "notice.openMarkdown"));
		return;
	}

	const sourceFile = plugin.documentTranslationService.getSourceFileForPath(file.path) ?? file;
	const targetLanguage = plugin.documentTranslationService.getTargetLanguageForPath(file.path) ?? plugin.settings.targetLanguage;
	const isCurrent = await plugin.documentTranslationService.isTranslationCurrent(sourceFile, targetLanguage);

	let loadingNotice: Notice | null = null;
	if (!isCurrent) {
		loadingNotice = new Notice(
			t(plugin, "document.translatingFile"),
			0
		);
	}

	try {
		// Always open/focus the translated file on the right. openSideBySide skips
		// re-translating when the translation is already current, so this is cheap
		// for the reuse case and guarantees the user actually sees the result.
		await plugin.documentTranslationService.openSideBySide(sourceFile, targetLanguage);

		if (loadingNotice) {
			loadingNotice.hide();
		}

		new Notice(`✅ ${t(plugin, isCurrent ? "document.reusedTranslation" : "document.openedOnRight")}`, 3000);
	} catch (error) {
		if (loadingNotice) {
			loadingNotice.hide();
		}
		console.error("Failed to create translated file", error);
		new Notice(formatTranslationError(error), 8000);
	}
}
