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
	const isActive = plugin.documentTranslationService.isActive(sourceFile.path);

	let loadingNotice: Notice | null = null;
	if (!isActive) {
		loadingNotice = new Notice(
			t(plugin, "document.translatingFile"),
			0
		);
	}

	try {
		if (isActive) {
			await plugin.documentTranslationService.refresh(sourceFile);
		} else {
			await plugin.documentTranslationService.openSideBySide(sourceFile);
		}

		if (loadingNotice) {
			loadingNotice.hide();
		}

		if (!isActive) {
			new Notice(`✅ ${t(plugin, "document.openedOnRight")}`, 3000);
		}
	} catch (error) {
		if (loadingNotice) {
			loadingNotice.hide();
		}
		console.error("Failed to create translated file", error);
		new Notice(formatTranslationError(error), 8000);
	}
}
