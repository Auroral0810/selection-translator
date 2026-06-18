import TranslationPlugin from "../main";
import {openTranslatedFileOnRight} from "./open-translated-file";

export async function openSideBySideTranslation(plugin: TranslationPlugin): Promise<void> {
	await openTranslatedFileOnRight(plugin);
}
