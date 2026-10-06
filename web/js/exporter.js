/** Shared text/Markdown serialisation for draw results and history. */

import { t } from "./i18n.js";
import { downloadText, formatTime } from "./util.js";

/** Plain text list, handy for pasting into a chat window. */
export function winnersToText(record) {
	if (record.groups?.length) {
		return record.groups
			.map(
				(group) =>
					`【${group.roomId}】\n` +
					group.winners.map((winner, index) => `${index + 1}. ${winner.name} (uid ${winner.uid})`).join("\n"),
			)
			.join("\n\n");
	}
	return record.winners
		.map((winner, index) => {
			const rooms = winner.rooms?.length ? ` · ${winner.rooms.join("、")}` : "";
			return `${index + 1}. ${winner.name} (uid ${winner.uid})${rooms}`;
		})
		.join("\n");
}

/** Markdown report for one draw. */
export function recordToMarkdown(record) {
	const time = formatTime(record.at, "zh-CN");
	const keywords = record.keywords || t("sets.all");
	const rooms = (record.roomIds || []).join("、") || record.roomTitle || "—";
	const lines = [
		`# GACHAGO ${t("winners.title")}`,
		"",
		`- ${t("room.title")}: ${rooms}`,
		`- ${t("draw.keywords")}: ${keywords}`,
		`- ${t("draw.poolSize")}: ${record.size}`,
		`- ${t("draw.count")}: ${record.winners.length}`,
		`- ${t("history.title")}: ${time}`,
	];

	const table = (winners) => [
		"",
		"| # | uid | name |",
		"| --- | --- | --- |",
		...winners.map((winner, index) => `| ${index + 1} | ${winner.uid} | ${escapeCell(winner.name)} |`),
	];

	if (record.groups?.length) {
		// Per-room draw: one section per room, so the report mirrors the UI.
		for (const group of record.groups) {
			lines.push("", `## ${group.roomId} · ${t("draw.poolSize")} ${group.size}`, ...table(group.winners));
		}
	} else {
		lines.push(...table(record.winners));
	}
	return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
	return String(value ?? "").replace(/\|/g, "\\|");
}

export function recordFileName(record) {
	const stamp = new Date(record.at).toISOString().slice(0, 16).replace(/[:T]/g, "-");
	const room = record.roomIds?.length === 1 ? record.roomIds[0] : `${record.roomIds?.length || 0}rooms`;
	return `gachago-${room}-${stamp}.md`;
}

export function downloadRecord(record) {
	downloadText(recordFileName(record), recordToMarkdown(record), "text/markdown;charset=utf-8");
}
