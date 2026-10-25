/**
 * Programmes — the pure rules behind a multi-course programme (programme
 * wave, owner 2026-10-25). See contracts/programme.ts for the shape.
 *
 * - parseProgrammeOutline: an author's whole-programme file → a checked
 *   outline (or one plain error);
 * - planProgrammeOutline: an outline → the stages to store and the empty
 *   courses to create for modules that don't exist yet (ids injected, so it
 *   stays pure);
 * - parseProgrammeStages: the structure editor's body → stages;
 * - programmeIssues: what is wrong with a stored structure (missing
 *   courses, prerequisites that are unknown, come later, or loop).
 *
 * Nothing here knows a subject. Browser-safe.
 */

import type {
	OutlineLesson,
	ProgrammeIssue,
	ProgrammeModule,
	ProgrammeOutline,
	ProgrammeRecord,
	ProgrammeStage,
	ProgrammeSummary,
} from "./contracts/programme.ts";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function optionalCredits(v: unknown, where: string): Parsed<number | undefined> {
	if (v === undefined || v === null) return { ok: true, value: undefined };
	if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, error: `${where}: credits must be a number of 0 or more` };
	return { ok: true, value: v };
}

function stringList(v: unknown, where: string, field: string): Parsed<string[]> {
	if (v === undefined || v === null) return { ok: true, value: [] };
	if (!Array.isArray(v) || v.some((s) => typeof s !== "string" || s.trim() === "")) {
		return { ok: false, error: `${where}: ${field} must be a list of non-empty strings` };
	}
	return { ok: true, value: [...new Set(v.map((s: string) => s.trim()))] };
}

function outlineLessons(v: unknown, where: string): Parsed<OutlineLesson[]> {
	if (v === undefined || v === null) return { ok: true, value: [] };
	if (!Array.isArray(v)) return { ok: false, error: `${where}: lessons must be a list` };
	const lessons: OutlineLesson[] = [];
	for (const [li, raw] of v.entries()) {
		const at = `${where}, lesson ${li + 1}`;
		const item = typeof raw === "string" ? { title: raw } : raw;
		if (!isObj(item) || !str(item.title)) return { ok: false, error: `${at} needs a title` };
		for (const field of ["brief", "section"] as const) {
			if (item[field] !== undefined && typeof item[field] !== "string") return { ok: false, error: `${at}: ${field} must be text` };
		}
		const brief = str(item.brief);
		const section = str(item.section);
		lessons.push({ title: str(item.title), ...(brief ? { brief } : {}), ...(section ? { section } : {}) });
	}
	return { ok: true, value: lessons };
}

/** Check an author's outline file. Unknown fields are ignored. */
export function parseProgrammeOutline(raw: unknown): Parsed<ProgrammeOutline> {
	if (!isObj(raw)) return { ok: false, error: "The outline must be a JSON object" };
	const title = str(raw.title);
	if (!title) return { ok: false, error: "The outline needs a title" };
	if (!Array.isArray(raw.stages) || raw.stages.length === 0) return { ok: false, error: "The outline needs at least one stage" };
	const stages: ProgrammeOutline["stages"] = [];
	for (const [si, rawStage] of raw.stages.entries()) {
		const where = `Stage ${si + 1}`;
		if (!isObj(rawStage)) return { ok: false, error: `${where} must be an object` };
		const stageTitle = str(rawStage.title);
		if (!stageTitle) return { ok: false, error: `${where} needs a title` };
		if (!Array.isArray(rawStage.modules)) return { ok: false, error: `${where} needs a modules list` };
		const modules: ProgrammeOutline["stages"][number]["modules"] = [];
		for (const [mi, rawModule] of rawStage.modules.entries()) {
			const at = `${where}, module ${mi + 1}`;
			if (!isObj(rawModule)) return { ok: false, error: `${at} must be an object` };
			const moduleTitle = str(rawModule.title);
			if (!moduleTitle) return { ok: false, error: `${at} needs a title` };
			const credits = optionalCredits(rawModule.credits, at);
			if (!credits.ok) return credits;
			const requires = stringList(rawModule.requires, at, "requires");
			if (!requires.ok) return requires;
			const lessons = outlineLessons(rawModule.lessons, at);
			if (!lessons.ok) return lessons;
			const description = str(rawModule.description);
			const courseId = str(rawModule.courseId);
			const key = str(rawModule.key);
			modules.push({
				title: moduleTitle,
				...(description ? { description } : {}),
				...(courseId ? { courseId } : {}),
				...(key ? { key } : {}),
				...(credits.value !== undefined ? { credits: credits.value } : {}),
				...(rawModule.optional === true ? { optional: true } : {}),
				...(requires.value.length > 0 ? { requires: requires.value } : {}),
				...(lessons.value.length > 0 ? { lessons: lessons.value } : {}),
			});
		}
		const description = str(rawStage.description);
		stages.push({ title: stageTitle, ...(description ? { description } : {}), modules });
	}
	const description = str(raw.description);
	const audience = str(raw.audience);
	return { ok: true, value: { title, ...(description ? { description } : {}), ...(audience ? { audience } : {}), stages } };
}

/**
 * Turn a checked outline into stored stages. Modules that name an existing
 * course use it; the rest get a new course id (the caller creates those
 * courses, titled and described as `newCourses` says, and plans each
 * course's `lessons`). `requires` resolves against outline keys, then
 * outline titles, then existing course ids.
 */
export function planProgrammeOutline(
	outline: ProgrammeOutline,
	opts: { existingCourseIds: ReadonlySet<string>; newCourseId: () => string; newStageId: () => string },
): Parsed<{
	stages: ProgrammeStage[];
	newCourses: Array<{ id: string; title: string; description?: string }>;
	lessons: Array<{ courseId: string; lessons: OutlineLesson[] }>;
}> {
	const newCourses: Array<{ id: string; title: string; description?: string }> = [];
	const byHandle = new Map<string, string>();
	const ambiguous = new Set<string>();
	const claim = (handle: string, courseId: string) => {
		const prior = byHandle.get(handle);
		if (prior !== undefined && prior !== courseId) ambiguous.add(handle);
		else byHandle.set(handle, courseId);
	};

	// First pass: give every module its course id and register its handles.
	const placed = outline.stages.map((stage) =>
		stage.modules.map((m) => {
			let courseId = m.courseId;
			if (courseId === undefined) {
				courseId = opts.newCourseId();
				newCourses.push({ id: courseId, title: m.title, ...(m.description ? { description: m.description } : {}) });
			}
			return { module: m, courseId };
		}),
	);
	for (const stage of placed) {
		for (const { module: m, courseId } of stage) {
			if (m.courseId !== undefined && !opts.existingCourseIds.has(m.courseId)) {
				return { ok: false, error: `“${m.title}” names course ${m.courseId}, which doesn't exist` };
			}
			if (m.key) {
				if (byHandle.has(m.key) && byHandle.get(m.key) !== courseId) return { ok: false, error: `Two modules use the key “${m.key}”` };
				byHandle.set(m.key, courseId);
			}
		}
	}
	for (const stage of placed) for (const { module: m, courseId } of stage) claim(m.title, courseId);

	// Second pass: resolve requires.
	const stages: ProgrammeStage[] = [];
	const lessons: Array<{ courseId: string; lessons: OutlineLesson[] }> = [];
	for (const [si, stage] of placed.entries()) {
		const modules: ProgrammeModule[] = [];
		for (const { module: m, courseId } of stage) {
			const requires: string[] = [];
			for (const ref of m.requires ?? []) {
				if (ambiguous.has(ref)) return { ok: false, error: `“${m.title}” requires “${ref}”, but more than one module has that title; give them keys` };
				const target = byHandle.get(ref) ?? (opts.existingCourseIds.has(ref) ? ref : undefined);
				if (target === undefined) return { ok: false, error: `“${m.title}” requires “${ref}”, which isn't a module in this outline` };
				if (target !== courseId && !requires.includes(target)) requires.push(target);
			}
			modules.push({
				courseId,
				...(m.credits !== undefined ? { credits: m.credits } : {}),
				...(m.optional ? { optional: true } : {}),
				...(requires.length > 0 ? { requires } : {}),
			});
			if (m.lessons?.length) lessons.push({ courseId, lessons: m.lessons });
		}
		const description = outline.stages[si]!.description;
		stages.push({ id: opts.newStageId(), title: outline.stages[si]!.title, ...(description ? { description } : {}), modules });
	}
	return { ok: true, value: { stages, newCourses, lessons } };
}

/** Check the structure editor's stages (PUT /api/programmes/<id>). Stage
 *  ids are kept when given, so the reader's links stay stable. */
export function parseProgrammeStages(raw: unknown, newStageId: () => string): Parsed<ProgrammeStage[]> {
	if (!Array.isArray(raw)) return { ok: false, error: "stages must be a list" };
	const stages: ProgrammeStage[] = [];
	const ids = new Set<string>();
	for (const [si, rawStage] of raw.entries()) {
		const where = `Stage ${si + 1}`;
		if (!isObj(rawStage)) return { ok: false, error: `${where} must be an object` };
		const title = str(rawStage.title);
		if (!title) return { ok: false, error: `${where} needs a title` };
		if (!Array.isArray(rawStage.modules)) return { ok: false, error: `${where} needs a modules list` };
		const modules: ProgrammeModule[] = [];
		for (const [mi, rawModule] of rawStage.modules.entries()) {
			const at = `${where}, module ${mi + 1}`;
			if (!isObj(rawModule)) return { ok: false, error: `${at} must be an object` };
			const courseId = str(rawModule.courseId);
			if (!courseId) return { ok: false, error: `${at} needs a courseId` };
			const credits = optionalCredits(rawModule.credits, at);
			if (!credits.ok) return credits;
			const requires = stringList(rawModule.requires, at, "requires");
			if (!requires.ok) return requires;
			const req = requires.value.filter((r) => r !== courseId);
			modules.push({
				courseId,
				...(credits.value !== undefined ? { credits: credits.value } : {}),
				...(rawModule.optional === true ? { optional: true } : {}),
				...(req.length > 0 ? { requires: req } : {}),
			});
		}
		let id = str(rawStage.id);
		if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) id = newStageId();
		ids.add(id);
		const description = str(rawStage.description);
		stages.push({ id, title, ...(description ? { description } : {}), modules });
	}
	return { ok: true, value: stages };
}

/** Every module in reading order, with the index of its stage. */
export function programmeModules(programme: ProgrammeRecord): Array<ProgrammeModule & { stage: number }> {
	return programme.stages.flatMap((stage, i) => stage.modules.map((m) => ({ ...m, stage: i })));
}

/** What the author should fix: modules whose course is gone, a course listed
 *  twice, prerequisites that are not in the programme, come in a later
 *  stage, or loop. Each loop is reported once. */
export function programmeIssues(programme: ProgrammeRecord, courseIds: ReadonlySet<string>): ProgrammeIssue[] {
	const issues: ProgrammeIssue[] = [];
	const modules = programmeModules(programme);
	const stageOf = new Map<string, number>();
	for (const m of modules) {
		if (stageOf.has(m.courseId)) issues.push({ kind: "duplicate-module", courseId: m.courseId });
		else stageOf.set(m.courseId, m.stage);
		if (!courseIds.has(m.courseId)) issues.push({ kind: "missing-course", courseId: m.courseId });
	}
	const edges = new Map<string, string[]>();
	for (const m of modules) {
		for (const req of m.requires ?? []) {
			const reqStage = stageOf.get(req);
			if (reqStage === undefined) issues.push({ kind: "unknown-prerequisite", courseId: m.courseId, requires: req });
			else {
				if (reqStage > m.stage) issues.push({ kind: "prerequisite-later", courseId: m.courseId, requires: req });
				edges.set(m.courseId, [...(edges.get(m.courseId) ?? []), req]);
			}
		}
	}
	// Cycles: a depth-first walk; a back edge closes a loop.
	const state = new Map<string, "open" | "done">();
	const path: string[] = [];
	const seen = new Set<string>();
	const visit = (node: string) => {
		state.set(node, "open");
		path.push(node);
		for (const next of edges.get(node) ?? []) {
			if (state.get(next) === "open") {
				const loop = path.slice(path.indexOf(next));
				const sig = [...loop].sort().join("|");
				if (!seen.has(sig)) {
					seen.add(sig);
					issues.push({ kind: "prerequisite-cycle", courseIds: loop });
				}
			} else if (!state.has(next)) visit(next);
		}
		path.pop();
		state.set(node, "done");
	};
	for (const m of modules) if (!state.has(m.courseId)) visit(m.courseId);
	return issues;
}

export function programmeSummary(programme: ProgrammeRecord): ProgrammeSummary {
	return {
		id: programme.id,
		title: programme.title,
		...(programme.description ? { description: programme.description } : {}),
		updatedAt: programme.updatedAt,
		stages: programme.stages.length,
		modules: programme.stages.reduce((n, s) => n + s.modules.length, 0),
	};
}

/** Drop a deleted course from every stage and every requires list. The
 *  programme is returned unchanged when it never used the course. */
export function removeProgrammeCourse(programme: ProgrammeRecord, courseId: string, now: string): ProgrammeRecord {
	const uses = programme.stages.some((s) => s.modules.some((m) => m.courseId === courseId || m.requires?.includes(courseId)));
	if (!uses) return programme;
	const stages = programme.stages.map((s) => ({
		...s,
		modules: s.modules
			.filter((m) => m.courseId !== courseId)
			.map((m) => {
				if (!m.requires?.includes(courseId)) return m;
				const requires = m.requires.filter((r) => r !== courseId);
				const { requires: _, ...rest } = m;
				return requires.length > 0 ? { ...rest, requires } : rest;
			}),
	}));
	return { ...programme, stages, updatedAt: now };
}
