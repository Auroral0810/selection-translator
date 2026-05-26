import {TFile, Vault} from "obsidian";

export function getFileByPath(vault: Vault, path: string): TFile | null {
	const file = vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}
