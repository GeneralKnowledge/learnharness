/**
 * ProgrammeStore — the fs JSON adapter (one file per programme in
 * data/programmes/). Implements core/ports.ts ProgrammeStore; the shapes
 * live in core/contracts/programme.ts. Same idioms as src/store/courses.ts.
 * Wired in the composition root (src/server/stores.ts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { ProgrammeStore } from "../core/ports.ts";
import type { ProgrammeRecord, ProgrammeSummary } from "../core/contracts.ts";
import { CURRENT_PROGRAMME_VERSION } from "../core/contracts.ts";
import { programmeSummary } from "../core/programme.ts";

function programmeFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid programme id: ${id}`);
	return path.join(PATHS.programmes, `${id}.json`);
}

function writeProgramme(record: ProgrammeRecord): void {
	fs.mkdirSync(PATHS.programmes, { recursive: true });
	fs.writeFileSync(programmeFile(record.id), JSON.stringify({ ...record, version: CURRENT_PROGRAMME_VERSION }, null, "\t"), "utf-8");
}

function createProgramme(input: Pick<ProgrammeRecord, "title" | "description" | "stages">): ProgrammeRecord {
	const now = new Date().toISOString();
	const description = input.description?.trim();
	const record: ProgrammeRecord = {
		id: `programme_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: input.title.trim() || "Untitled programme",
		...(description ? { description } : {}),
		createdAt: now,
		updatedAt: now,
		stages: input.stages,
	};
	writeProgramme(record);
	return { ...record, version: CURRENT_PROGRAMME_VERSION };
}

function getProgramme(id: string): ProgrammeRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(programmeFile(id), "utf-8"));
	} catch {
		return null;
	}
	const record = parsed as Partial<ProgrammeRecord>;
	if (typeof record.id !== "string" || !Array.isArray(record.stages)) return null;
	if (typeof record.version === "number" && record.version > CURRENT_PROGRAMME_VERSION) {
		console.error(`[programme ${id}] record stamped with schema version ${record.version} > ${CURRENT_PROGRAMME_VERSION} — refusing to read it`);
		return null;
	}
	return record as ProgrammeRecord;
}

function listProgrammes(): ProgrammeSummary[] {
	try {
		fs.mkdirSync(PATHS.programmes, { recursive: true });
		return fs
			.readdirSync(PATHS.programmes)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getProgramme(f.slice(0, -5)))
			.filter((r): r is ProgrammeRecord => r !== null)
			.map(programmeSummary)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function deleteProgramme(id: string): boolean {
	try {
		fs.unlinkSync(programmeFile(id));
		return true;
	} catch {
		return false;
	}
}

export const programmeStore: ProgrammeStore = {
	createProgramme,
	getProgramme,
	listProgrammes,
	saveProgramme: writeProgramme,
	deleteProgramme,
};
