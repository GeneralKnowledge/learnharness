/**
 * Programme contracts — a whole multi-course programme such as a degree
 * (programme wave, owner 2026-10-25: "imagine we wanted to change to a
 * completely different degree in the future").
 *
 * The engine is subject-agnostic: a programme is stages (named by the
 * author — "Year 1", "Level 4", "Foundation") holding modules, and a module
 * is an existing course plus its place in THIS programme: credits, whether
 * it is optional, and which other modules it requires. Nothing here names a
 * subject; swapping a CS degree for a history one is a different file in
 * data/programmes/, not a code change.
 *
 * A course can sit in several programmes, so prerequisites live on the
 * programme's module entry, never on the course. The pure rules (outline
 * parsing, structure checks) are core/programme.ts; the fs adapter is
 * src/store/programmes.ts.
 */

import type { CourseSummary } from "./course.ts";

export const CURRENT_PROGRAMME_VERSION = 1;

/** One module of a programme: a course, placed. */
export interface ProgrammeModule {
	courseId: string;
	/** Credit weight, in whatever unit the programme uses. */
	credits?: number;
	/** An elective — readers may skip it. */
	optional?: boolean;
	/** Course ids of the modules to finish first (same programme). */
	requires?: string[];
}

/** One stage of a programme (a year, level, term, phase…), in order. */
export interface ProgrammeStage {
	id: string;
	title: string;
	description?: string;
	modules: ProgrammeModule[];
}

/** One stored programme: data/programmes/<id>.json. */
export interface ProgrammeRecord {
	id: string;
	title: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
	version?: number;
	stages: ProgrammeStage[];
}

/** The list view's shape. */
export interface ProgrammeSummary {
	id: string;
	title: string;
	description?: string;
	updatedAt: string;
	stages: number;
	modules: number;
}

/** A structure problem the author should fix. Readers never see these: a
 *  missing module is skipped, a broken prerequisite is ignored. */
export type ProgrammeIssue =
	| { kind: "missing-course"; courseId: string }
	| { kind: "duplicate-module"; courseId: string }
	| { kind: "unknown-prerequisite"; courseId: string; requires: string }
	| { kind: "prerequisite-later"; courseId: string; requires: string }
	| { kind: "prerequisite-cycle"; courseIds: string[] };

/**
 * A whole programme written as one file (POST /api/programmes): stages of
 * modules by TITLE. A module without a courseId becomes a new, empty course
 * to fill later; `requires` names other modules of the outline by their
 * `key` or exact title, or an existing course id.
 */
export interface ProgrammeOutline {
	title: string;
	description?: string;
	stages: Array<{
		title: string;
		description?: string;
		modules: Array<{
			title: string;
			description?: string;
			/** Use this existing course instead of creating one. */
			courseId?: string;
			/** A short handle other modules' `requires` can use. */
			key?: string;
			credits?: number;
			optional?: boolean;
			requires?: string[];
		}>;
	}>;
}

/** One module as the programme page shows it. `course` is null when the
 *  course was deleted outside the programme. */
export interface ProgrammeModuleView {
	courseId: string;
	course: CourseSummary | null;
	credits?: number;
	optional: boolean;
	requires: Array<{ courseId: string; title: string }>;
}

/** A programme joined with its courses (src/server/programmes.ts
 *  programmeView) — the programme page's one read. */
export interface ProgrammeView {
	programme: ProgrammeRecord;
	stages: Array<{ id: string; title: string; description?: string; credits: number; modules: ProgrammeModuleView[] }>;
	totalCredits: number;
	issues: ProgrammeIssue[];
	/** Every course in the library — the structure editor's picker. */
	courses: CourseSummary[];
}
