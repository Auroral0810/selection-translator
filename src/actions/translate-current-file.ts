import TranslationPlugin from "../main";
import {openTranslatedFileOnRight} from "./open-translated-file";

export async function translateCurrentFile(plugin: TranslationPlugin): Promise<void> {
	await openTranslatedFileOnRight(plugin, "Translating current file...", "Translated file opened on the right.");
}
