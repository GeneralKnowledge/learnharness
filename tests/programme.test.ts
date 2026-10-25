/**
 * PROGRAMME PINS (owner, 2026-10-25): the engine holds whole multi-course
 * programmes without knowing their subject — stages of modules with
 * credits and prerequisites, laid out from one outline; lessons can be
 * reordered and grouped under sections. Runs under an isolated LH_DATA_DIR.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-programme-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { parseProgrammeOutline, planProgrammeOutline, parseProgrammeStages, programmeIssues, removeProgrammeCourse } =
	await import("../src/core/programme.ts");
const { reorderCourseLessons, updateCourseLesson, upsertCourseLesson, courseSections } = await import("../src/core/course.ts");
const { readerGate } = await import("../src/core/reader-gate.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { programmeStore } = await import("../src/store/programmes.ts");
const { createProgrammeFromOutline, programmeView, updateProgramme, deleteProgramme } = await import("../src/server/programmes.ts");
const { deleteCourse, reorderCourse, updateCourseLessonDetails } = await import("../src/server/courses.ts");
type CourseRecord = import("../src/core/contracts.ts").CourseRecord;
type ProgrammeRecord = import("../src/core/contracts.ts").ProgrammeRecord;

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const NOW = "2026-10-25T00:00:00.000Z";
const lesson = (id: string, section?: string) => ({
	id,
	title: `Lesson ${id}`,
	sourceChatId: `chat_${id}`,
	publishedAt: NOW,
	...(section ? { section } : {}),
	blocks: [{ kind: "text" as const, markdown: id }],
});
const course = (lessons: ReturnType<typeof lesson>[]): CourseRecord => ({
	id: "course_x",
	title: "X",
	createdAt: NOW,
	updatedAt: NOW,
	lessons,
});

let n = 0;
const ids = { existingCourseIds: new Set<string>(), newCourseId: () => `course_${++n}`, newStageId: () => `stage_${++n}` };

// A deliberately non-CS outline: the engine must not care.
const history = {
	title: "BA History",
	description: "Three years of history.",
	stages: [
		{
			title: "Year 1",
			modules: [
				{ title: "Historical Method", key: "method", credits: 20 },
				{ title: "The Medieval World", credits: 20, requires: ["method"] },
			],
		},
		{
			title: "Year 2",
			modules: [
				{ title: "Early Modern Europe", credits: 20, requires: ["The Medieval World"] },
				{ title: "Oral History", credits: 10, optional: true, requires: ["method"] },
			],
		},
	],
};

describe("programme outline", () => {
	it("checks an outline and names the first problem plainly", () => {
		assert.equal(parseProgrammeOutline(history).ok, true);
		assert.deepEqual(parseProgrammeOutline({ stages: [] }), { ok: false, error: "The outline needs a title" });
		assert.deepEqual(parseProgrammeOutline({ title: "T", stages: [] }), { ok: false, error: "The outline needs at least one stage" });
		const bad = parseProgrammeOutline({ title: "T", stages: [{ title: "S", modules: [{ title: "M", credits: -5 }] }] });
		assert.deepEqual(bad, { ok: false, error: "Stage 1, module 1: credits must be a number of 0 or more" });
	});

	it("lays out stages, new courses, and prerequisites by key or title", () => {
		const outline = parseProgrammeOutline(history);
		assert.ok(outline.ok);
		const plan = planProgrammeOutline(outline.value, ids);
		assert.ok(plan.ok);
		const { stages, newCourses } = plan.value;
		assert.equal(newCourses.length, 4);
		assert.deepEqual(stages.map((s) => s.title), ["Year 1", "Year 2"]);
		const [method, medieval] = stages[0]!.modules;
		const [earlyModern, oral] = stages[1]!.modules;
		assert.deepEqual(medieval!.requires, [method!.courseId]);
		assert.deepEqual(earlyModern!.requires, [medieval!.courseId]);
		assert.equal(oral!.optional, true);
		assert.equal(oral!.credits, 10);
	});

	it("refuses unknown and ambiguous requirements, and unknown course ids", () => {
		const unknown = parseProgrammeOutline({ title: "T", stages: [{ title: "S", modules: [{ title: "A", requires: ["Nope"] }] }] });
		assert.ok(unknown.ok);
		const plan = planProgrammeOutline(unknown.value, ids);
		assert.equal(plan.ok, false);
		assert.match((plan as { error: string }).error, /requires “Nope”/);

		const twice = parseProgrammeOutline({
			title: "T",
			stages: [{ title: "S", modules: [{ title: "A" }, { title: "A" }, { title: "B", requires: ["A"] }] }],
		});
		assert.ok(twice.ok);
		assert.match((planProgrammeOutline(twice.value, ids) as { error: string }).error, /more than one module/);

		const ghost = parseProgrammeOutline({ title: "T", stages: [{ title: "S", modules: [{ title: "A", courseId: "course_gone" }] }] });
		assert.ok(ghost.ok);
		assert.match((planProgrammeOutline(ghost.value, ids) as { error: string }).error, /doesn't exist/);
	});
});

describe("programme structure checks", () => {
	const programme = (stages: ProgrammeRecord["stages"]): ProgrammeRecord => ({
		id: "programme_x",
		title: "P",
		createdAt: NOW,
		updatedAt: NOW,
		stages,
	});

	it("finds missing courses, duplicates, unknown and later prerequisites", () => {
		const p = programme([
			{ id: "s1", title: "One", modules: [{ courseId: "a", requires: ["b"] }, { courseId: "a" }, { courseId: "c", requires: ["zz"] }] },
			{ id: "s2", title: "Two", modules: [{ courseId: "b" }, { courseId: "gone" }] },
		]);
		const issues = programmeIssues(p, new Set(["a", "b", "c"]));
		assert.deepEqual(
			issues.filter((i) => i.kind !== "prerequisite-cycle"),
			[
				{ kind: "duplicate-module", courseId: "a" },
				{ kind: "missing-course", courseId: "gone" },
				{ kind: "prerequisite-later", courseId: "a", requires: "b" },
				{ kind: "unknown-prerequisite", courseId: "c", requires: "zz" },
			],
		);
	});

	it("reports each prerequisite loop once", () => {
		const p = programme([
			{
				id: "s1",
				title: "One",
				modules: [
					{ courseId: "a", requires: ["b"] },
					{ courseId: "b", requires: ["c"] },
					{ courseId: "c", requires: ["a"] },
					{ courseId: "d", requires: ["a"] },
				],
			},
		]);
		const cycles = programmeIssues(p, new Set(["a", "b", "c", "d"])).filter((i) => i.kind === "prerequisite-cycle");
		assert.equal(cycles.length, 1);
		assert.deepEqual([...(cycles[0] as { courseIds: string[] }).courseIds].sort(), ["a", "b", "c"]);
	});

	it("a clean programme has no issues, and removing a course clears it everywhere", () => {
		const p = programme([
			{ id: "s1", title: "One", modules: [{ courseId: "a" }, { courseId: "b", requires: ["a"] }] },
			{ id: "s2", title: "Two", modules: [{ courseId: "c", requires: ["a", "b"] }] },
		]);
		assert.deepEqual(programmeIssues(p, new Set(["a", "b", "c"])), []);
		const without = removeProgrammeCourse(p, "a", NOW);
		assert.deepEqual(without.stages[0]!.modules, [{ courseId: "b" }]);
		assert.deepEqual(without.stages[1]!.modules, [{ courseId: "c", requires: ["b"] }]);
		assert.equal(removeProgrammeCourse(p, "nope", NOW), p);
	});

	it("parses the editor's stages, keeping valid ids and dropping self-requirements", () => {
		const parsed = parseProgrammeStages(
			[
				{ id: "s1", title: "One", modules: [{ courseId: "a", credits: 15, requires: ["a", "b"] }] },
				{ id: "s1", title: "Dup id", modules: [] },
				{ title: "New", modules: [] },
			],
			() => "fresh",
		);
		assert.ok(parsed.ok);
		assert.deepEqual(parsed.value.map((s) => s.id), ["s1", "fresh", "fresh"]);
		assert.deepEqual(parsed.value[0]!.modules, [{ courseId: "a", credits: 15, requires: ["b"] }]);
		assert.equal(parseProgrammeStages([{ title: "", modules: [] }], () => "x").ok, false);
	});
});

describe("lesson order and sections", () => {
	const c = course([lesson("a", "Basics"), lesson("b", "Basics"), lesson("c"), lesson("d", "Basics")]);

	it("reorders only by a full permutation", () => {
		assert.deepEqual(reorderCourseLessons(c, ["d", "c", "b", "a"], NOW)!.lessons.map((l) => l.id), ["d", "c", "b", "a"]);
		assert.equal(reorderCourseLessons(c, ["a", "b", "c"], NOW), null);
		assert.equal(reorderCourseLessons(c, ["a", "a", "b", "c"], NOW), null);
		assert.equal(reorderCourseLessons(c, ["a", "b", "c", "zz"], NOW), null);
	});

	it("groups runs of the same section, numbering through the course", () => {
		const groups = courseSections(c.lessons);
		assert.deepEqual(
			groups.map((g) => [g.section, g.lessons.map((l) => l.number)]),
			[
				["Basics", [1, 2]],
				[null, [3]],
				["Basics", [4]],
			],
		);
	});

	it("renames and sets or clears a section", () => {
		const renamed = updateCourseLesson(c, "c", { title: "  Third  ", section: "Extra" }, NOW);
		assert.equal(renamed.lessons[2]!.title, "Third");
		assert.equal(renamed.lessons[2]!.section, "Extra");
		const cleared = updateCourseLesson(renamed, "c", { section: " " }, NOW);
		assert.equal("section" in cleared.lessons[2]!, false);
		assert.equal(updateCourseLesson(c, "zz", { title: "x" }, NOW), c);
	});

	it("re-publishing keeps the lesson's section and place", () => {
		const republished = upsertCourseLesson(c, { ...lesson("new"), sourceChatId: "chat_b" }, NOW);
		assert.deepEqual(republished.lessons.map((l) => l.id), ["a", "b", "c", "d"]);
		assert.equal(republished.lessons[1]!.section, "Basics");
		assert.equal(republished.lessons[1]!.blocks[0]!.kind, "text");
	});
});

describe("programmes (store + server)", () => {
	it("creates a programme and its empty courses from one outline", () => {
		const existing = courseStore.createCourse("Existing Course");
		const outcome = createProgrammeFromOutline({
			...history,
			stages: [...history.stages, { title: "Year 3", modules: [{ title: "Reused", courseId: existing.id, requires: ["method"] }] }],
		});
		assert.ok(outcome.ok);
		assert.equal(outcome.createdCourses, 4);
		const view = programmeView(outcome.programme.id)!;
		assert.deepEqual(view.issues, []);
		assert.equal(view.totalCredits, 70);
		assert.deepEqual(view.stages.map((s) => s.credits), [40, 30, 0]);
		const medieval = view.stages[0]!.modules[1]!;
		assert.equal(medieval.course!.title, "The Medieval World");
		assert.deepEqual(medieval.requires.map((r) => r.title), ["Historical Method"]);
		assert.equal(view.stages[2]!.modules[0]!.courseId, existing.id);
		assert.equal(programmeStore.listProgrammes().some((p) => p.id === outcome.programme.id && p.modules === 5), true);
	});

	it("writes nothing when the outline is wrong", () => {
		const before = courseStore.listCourses().length;
		const outcome = createProgrammeFromOutline({ title: "T", stages: [{ title: "S", modules: [{ title: "A", requires: ["B"] }] }] });
		assert.equal(outcome.ok, false);
		assert.equal(courseStore.listCourses().length, before);
	});

	it("edits the structure, and deleting a course takes it out of the programme", () => {
		const outcome = createProgrammeFromOutline({
			title: "MBBS",
			stages: [{ title: "Phase 1", modules: [{ title: "Anatomy" }, { title: "Physiology", requires: ["Anatomy"] }] }],
		});
		assert.ok(outcome.ok);
		const id = outcome.programme.id;
		const [anatomy, physiology] = outcome.programme.stages[0]!.modules;
		const updated = updateProgramme(id, {
			title: "Medicine",
			stages: [
				{ id: outcome.programme.stages[0]!.id, title: "Phase 1", modules: [anatomy] },
				{ title: "Phase 2", modules: [{ ...physiology, credits: 30 }] },
			],
		});
		assert.ok(updated && updated.ok);
		assert.equal(updated.programme.title, "Medicine");
		assert.equal(updated.programme.stages[0]!.id, outcome.programme.stages[0]!.id);
		assert.equal(updated.programme.stages[1]!.modules[0]!.credits, 30);
		assert.deepEqual(updateProgramme(id, { stages: "nope" }), { ok: false, error: "stages must be a list" });

		assert.equal(deleteCourse(anatomy!.courseId), true);
		const after = programmeStore.getProgramme(id)!;
		assert.deepEqual(after.stages[0]!.modules, []);
		assert.deepEqual(after.stages[1]!.modules, [{ courseId: physiology!.courseId, credits: 30 }]);

		assert.equal(deleteProgramme(id), true);
		assert.equal(programmeStore.getProgramme(id), null);
		assert.notEqual(courseStore.getCourse(physiology!.courseId), null, "a programme's courses outlive it");
	});

	it("reorders and sections a stored course's lessons", () => {
		const stored = courseStore.createCourse("Ordered");
		courseStore.saveCourse({ ...stored, lessons: [lesson("a"), lesson("b")] });
		assert.equal(reorderCourse(stored.id, ["a"]), "invalid");
		assert.equal(reorderCourse("course_missing", []), null);
		const next = reorderCourse(stored.id, ["b", "a"]);
		assert.ok(next && next !== "invalid");
		assert.deepEqual(courseStore.getCourse(stored.id)!.lessons.map((l) => l.id), ["b", "a"]);
		assert.equal(updateCourseLessonDetails(stored.id, "a", { section: "Part 1" })!.section, "Part 1");
		assert.equal(updateCourseLessonDetails(stored.id, "zz", { section: "x" }), null);
	});
});

describe("reader gate", () => {
	it("serves the programme pages and read-only programme API", () => {
		assert.equal(readerGate("/programmes/programme_1", "GET"), "allow");
		assert.equal(readerGate("/api/programmes", "GET"), "allow");
		assert.equal(readerGate("/api/programmes", "POST"), "deny");
		assert.equal(readerGate("/api/programmes/programme_1", "PUT"), "deny");
		assert.equal(readerGate("/api/courses/course_1/order", "PUT"), "deny");
		assert.equal(readerGate("/programmesx", "GET"), "deny");
	});
});
