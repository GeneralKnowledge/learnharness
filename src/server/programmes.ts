import {
	parseProgrammeOutline,
	parseProgrammeStages,
	planProgrammeOutline,
	programmeIssues,
} from "../core/programme.ts";
import type { ProgrammeModuleView, ProgrammeRecord, ProgrammeView } from "../core/contracts.ts";
import { addPlannedLessons } from "../core/course.ts";
import { newLessonId } from "./courses.ts";
import { stores } from "./stores.ts";

/**
 * Server-side programme entries (programme wave, owner 2026-10-25) for
 * app/api/programmes* and the /programmes reader pages. A programme only
 * ARRANGES courses: creating one from an outline makes empty courses for the
 * modules that don't exist yet (with their planned lessons), and deleting
 * one never deletes a course.
 */

export const { getProgramme, listProgrammes } = stores.programmeStore;

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

export type ProgrammeOutcome = { ok: true; programme: ProgrammeRecord; createdCourses: number } | { ok: false; error: string };

/** Create a whole programme from one outline file. Nothing is written
 *  unless the whole outline checks out. */
export function createProgrammeFromOutline(raw: unknown): ProgrammeOutcome {
	const parsed = parseProgrammeOutline(raw);
	if (!parsed.ok) return parsed;
	const existingCourseIds = new Set(stores.courseStore.listCourses().map((c) => c.id));
	const planned = planProgrammeOutline(parsed.value, {
		existingCourseIds,
		newCourseId: () => newId("course"),
		newStageId: () => newId("stage"),
	});
	if (!planned.ok) return planned;
	const now = new Date().toISOString();
	for (const course of planned.value.newCourses) {
		stores.courseStore.saveCourse({ ...course, createdAt: now, updatedAt: now, lessons: [] });
	}
	for (const plan of planned.value.lessons) {
		const course = stores.courseStore.getCourse(plan.courseId);
		if (!course) continue;
		const items = plan.lessons.map((l) => ({ ...l, id: newLessonId() }));
		stores.courseStore.saveCourse(addPlannedLessons(course, items, now));
	}
	const programme = stores.programmeStore.createProgramme({
		title: parsed.value.title,
		description: parsed.value.description,
		audience: parsed.value.audience,
		stages: planned.value.stages,
	});
	return { ok: true, programme, createdCourses: planned.value.newCourses.length };
}

/** Rename, describe, or replace the stages. Null when the id is unknown. */
export function updateProgramme(
	id: string,
	patch: { title?: string; description?: string; audience?: string; stages?: unknown },
): { ok: true; programme: ProgrammeRecord } | { ok: false; error: string } | null {
	const programme = stores.programmeStore.getProgramme(id);
	if (!programme) return null;
	let stages = programme.stages;
	if (patch.stages !== undefined) {
		const parsed = parseProgrammeStages(patch.stages, () => newId("stage"));
		if (!parsed.ok) return parsed;
		stages = parsed.value;
	}
	const title = patch.title?.trim();
	const description = patch.description?.trim();
	const audience = patch.audience?.trim();
	const next: ProgrammeRecord = {
		...programme,
		...(title ? { title } : {}),
		...(description !== undefined ? { description } : {}),
		...(audience !== undefined ? { audience } : {}),
		stages,
		updatedAt: new Date().toISOString(),
	};
	if (next.description === "") delete next.description;
	if (next.audience === "") delete next.audience;
	stores.programmeStore.saveProgramme(next);
	return { ok: true, programme: next };
}

export function deleteProgramme(id: string): boolean {
	return stores.programmeStore.deleteProgramme(id);
}

/** A programme joined with its courses, for the reader page. */
export function programmeView(id: string): ProgrammeView | null {
	const programme = stores.programmeStore.getProgramme(id);
	if (!programme) return null;
	const courses = stores.courseStore.listCourses();
	const byId = new Map(courses.map((c) => [c.id, c]));
	const stages = programme.stages.map((stage) => {
		const modules = stage.modules.map(
			(m): ProgrammeModuleView => ({
				courseId: m.courseId,
				course: byId.get(m.courseId) ?? null,
				...(m.credits !== undefined ? { credits: m.credits } : {}),
				optional: m.optional === true,
				requires: (m.requires ?? [])
					.filter((r) => byId.has(r))
					.map((r) => ({ courseId: r, title: byId.get(r)!.title })),
			}),
		);
		return {
			id: stage.id,
			title: stage.title,
			...(stage.description ? { description: stage.description } : {}),
			credits: modules.reduce((n, m) => n + (m.credits ?? 0), 0),
			modules,
		};
	});
	return {
		programme,
		stages,
		totalCredits: stages.reduce((n, s) => n + s.credits, 0),
		issues: programmeIssues(programme, new Set(byId.keys())),
		courses,
	};
}
