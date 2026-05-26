import {Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";

export async function openTranslatedFileOnRight(plugin: TranslationPlugin, startMessage: string, doneMessage: string): Promise<void> {
	const file = plugin.app.workspace.getActiveFile();

	if (!file || file.extension !== "md") {
		new Notice(t(plugin, "notice.openMarkdown"));
		return;
	}

	const sourceFile = plugin.documentTranslationService.getSourceFileForPath(file.path) ?? file;
	const isActive = plugin.documentTranslationService.isActive(sourceFile.path);
	new Notice(isActive ? t(plugin, "notice.closingSideBySide") : startMessage);

	try {
		const result = await plugin.documentTranslationService.toggleSideBySide(sourceFile);
		new Notice(result === "opened" ? doneMessage : t(plugin, "notice.sideBySideClosed"));
	} catch (error) {
		console.error("Failed to create translated file", error);
		new Notice(error instanceof Error ? error.message : t(plugin, "notice.createTranslatedFileFailed"));
	}
}
