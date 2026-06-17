import {Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {formatTranslationError} from "../translation/errors";

export async function openTranslatedFileOnRight(plugin: TranslationPlugin, startMessage: string, doneMessage: string): Promise<void> {
	const file = plugin.app.workspace.getActiveFile();

	if (!file || file.extension !== "md") {
		new Notice(t(plugin, "notice.openMarkdown"));
		return;
	}

	const sourceFile = plugin.documentTranslationService.getSourceFileForPath(file.path) ?? file;
	const isActive = plugin.documentTranslationService.isActive(sourceFile.path);

	// For opening (not closing), show persistent loading notice
	let loadingNotice: Notice | null = null;
	if (!isActive) {
		loadingNotice = new Notice(
			t(plugin, "document.translatingFile"),
			0 // Don't auto-hide
		);
	} else {
		new Notice(t(plugin, "notice.closingSideBySide"));
	}

	try {
		const result = await plugin.documentTranslationService.toggleSideBySide(sourceFile);

		// Hide loading notice after completion
		if (loadingNotice) {
			loadingNotice.hide();
		}

		if (result === "opened") {
			new Notice(`✅ ${t(plugin, "document.openedOnRight")}`, 3000);
		} else {
			new Notice(t(plugin, "notice.sideBySideClosed"));
		}
	} catch (error) {
		// Hide loading notice on error
		if (loadingNotice) {
			loadingNotice.hide();
		}
		console.error("Failed to create translated file", error);
		new Notice(formatTranslationError(error), 8000);
	}
}
