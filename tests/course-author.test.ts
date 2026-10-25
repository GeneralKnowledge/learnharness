/**
 * AUTHOR-MODE PINS (owner, 2026-10-25): a course can hold planned lessons
 * (title + brief, seedable from a programme outline), and the author agent
 * writes them from the brief with no learner in the loop — its questions
 * recorded, not posed; a refused call dropped; the lesson stored in place
 * with what it cost. Runs under an isolated LH_DATA_DIR with faux engines.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-author-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { addPlannedLessons, upsertCourseLesson, updateCourseLesson, courseSummary } = await import("../src/core/course.ts");
const { authorLessonPrompt, authorContextFor, authorBlocksFromMessages, fillAuthoredLesson, canAuthorLesson, authoredCost } =
	await import("../src/core/course-author.ts");
const { parseProgrammeOutline } = await import("../src/core/programme.ts");
const { runLessonAuthor, composeAuthorInstructions } = await import("../src/agent/author-agent.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { createProgrammeFromOutline } = await import("../src/server/programmes.ts");
const { authorLesson, queueCourseAuthoring, courseAuthoringStatus, setAuthorEnginesForTests } = await import(
	"../src/server/course-author.ts"
);
const { planCourseLessons } = await import("../src/server/courses.ts");
type CourseRecord = import("../src/core/contracts.ts").CourseRecord;
type PiEngine = import("../src/agent/models.ts").PiEngine;

after(() => {
	setAuthorEnginesForTests(null);
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const NOW = "2026-10-25T00:00:00.000Z";

function engine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const QUIZ = {
	type: "check",
	question: "Which fact needs no derivation?",
	options: [
		{ label: "An axiom", value: "axiom" },
		{ label: "A theorem", value: "theorem" },
	],
	explanation: "Axioms follow from nothing else.",
	correctAnswer: "axiom",
};

/** A whole lesson: a map, prose, a refused quiz (bad answer), its fix, an
 *  explain, more prose, then finish. */
function lessonScript(): FauxResponseStep[] {
	return [
		() =>
			fauxAssistantMessage([fauxToolCall("lesson_map", { mermaid: "graph TD\n  a[Axioms] --> b[Theorems]" }, { id: "m1" })], {
				stopReason: "toolUse",
			}),
		() =>
			fauxAssistantMessage(
				[fauxText("## Axioms\n\nStart from what needs no proof."), fauxToolCall("quiz", { ...QUIZ, correctAnswer: "nope" }, { id: "q1" })],
				{ stopReason: "toolUse" },
			),
		() => fauxAssistantMessage([fauxToolCall("quiz", QUIZ, { id: "q2" })], { stopReason: "toolUse" }),
		() =>
			fauxAssistantMessage(
				[
					fauxText("Theorems rest on them."),
					fauxToolCall("explain", { type: "check", question: "Why?", correctAnswer: "Because each step is justified." }, { id: "e1" }),
				],
				{ stopReason: "toolUse" },
			),
		() => fauxAssistantMessage([fauxText("That is the whole structure."), fauxToolCall("finish_lesson", {}, { id: "f1" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("(should never be asked for)")]),
	];
}

const planned = (course: CourseRecord) =>
	addPlannedLessons(
		course,
		[
			{ id: "l1", title: "Sets", brief: "What a set is", section: "Foundations" },
			{ id: "l2", title: "Axioms", brief: "Why start from axioms" },
			{ id: "l3", title: "Proof", section: "Foundations" },
			{ id: "l4", title: "  " },
		],
		NOW,
	);
const base: CourseRecord = { id: "course_x", title: "Logic", description: "Reasoning", createdAt: NOW, updatedAt: NOW, lessons: [] };

describe("planned lessons", () => {
	it("are added at the end with their brief and section, blank titles skipped", () => {
		const c = planned(base);
		assert.deepEqual(c.lessons.map((l) => [l.id, l.status, l.blocks.length]), [
			["l1", "planned", 0],
			["l2", "planned", 0],
			["l3", "planned", 0],
		]);
		assert.equal(c.lessons[0]!.brief, "What a set is");
		assert.deepEqual(courseSummary(c).lessons[1], { id: "l2", title: "Axioms", planned: true });
		assert.equal(updateCourseLesson(c, "l2", { brief: "" }, NOW).lessons[1]!.brief, undefined);
	});

	it("a published session can fill one in place, keeping its id, section and brief", () => {
		const c = planned(base);
		const lesson = { id: "new", title: "From a session", sourceChatId: "chat_1", publishedAt: NOW, blocks: [{ kind: "text" as const, markdown: "x" }] };
		const filled = upsertCourseLesson(c, lesson, NOW, "l1");
		const l1 = filled.lessons[0]!;
		assert.equal(l1.id, "l1");
		assert.equal(l1.status, undefined);
		assert.equal(l1.section, "Foundations");
		assert.equal(l1.brief, "What a set is");
		assert.equal(l1.sourceChatId, "chat_1");
		// A target that isn't planned is ignored: the lesson is appended.
		assert.equal(upsertCourseLesson(filled, { ...lesson, sourceChatId: "chat_2" }, NOW, "l1").lessons.length, 4);
	});

	it("an outline seeds a module's planned lessons", () => {
		const outline = parseProgrammeOutline({
			title: "Law LLB",
			audience: "First-year law students",
			stages: [{ title: "Year 1", modules: [{ title: "Contract", lessons: ["Offer", { title: "Acceptance", brief: "Mirror image rule" }, { title: "" }] }] }],
		});
		assert.equal(outline.ok, false, "a blank lesson title is refused");
		const created = createProgrammeFromOutline({
			title: "Law LLB",
			audience: "First-year law students",
			stages: [{ title: "Year 1", modules: [{ title: "Contract", lessons: ["Offer", { title: "Acceptance", brief: "Mirror image rule", section: "Formation" }] }] }],
		});
		assert.ok(created.ok);
		assert.equal(created.programme.audience, "First-year law students");
		const course = courseStore.getCourse(created.programme.stages[0]!.modules[0]!.courseId)!;
		assert.deepEqual(course.lessons.map((l) => [l.title, l.status, l.brief ?? null, l.section ?? null]), [
			["Offer", "planned", null, null],
			["Acceptance", "planned", "Mirror image rule", "Formation"],
		]);
	});
});

describe("the author's brief", () => {
	it("places the lesson: programme, audience, prerequisites, neighbours", () => {
		const ctx = authorContextFor(planned(base), "l2", {
			title: "BA Philosophy",
			audience: "Undergraduates new to logic",
			requires: ["Critical Thinking"],
		})!;
		const prompt = authorLessonPrompt(ctx);
		assert.match(prompt, /Programme: BA Philosophy/);
		assert.match(prompt, /Audience: Undergraduates new to logic/);
		assert.match(prompt, /Modules the reader has finished: Critical Thinking/);
		assert.match(prompt, /Lesson 2 of 3: Axioms/);
		assert.match(prompt, /Brief: Why start from axioms/);
		assert.match(prompt, /Earlier lessons[^\n]*\n1\. Sets — What a set is/);
		assert.match(prompt, /Later lessons[^\n]*\n1\. Proof/);
		assert.match(authorLessonPrompt(authorContextFor(base.lessons.length ? base : planned(base), "l1")!), /Audience: not stated/);
		assert.equal(authorContextFor(base, "nope"), null);
	});

	it("composes the author prompt from the base and the teacher's doctrine", () => {
		const text = composeAuthorInstructions();
		assert.match(text, /# The author/);
		assert.match(text, /# The method — two principles/);
		assert.match(text, /## Formatting/);
	});
});

describe("the author run", () => {
	it("records questions without stopping, drops refused calls, and ends at finish_lesson", async () => {
		const messages = await runLessonAuthor("Write it.", { engine: engine(lessonScript()), onUsage: () => {} });
		const blocks = authorBlocksFromMessages(messages);
		assert.deepEqual(
			blocks.map((b) => b.kind),
			["plan", "text", "choice", "text", "recall", "text"],
		);
		assert.equal(blocks[2]!.kind === "choice" && blocks[2]!.correct[0], "axiom");
		assert.equal(blocks[2]!.kind === "choice" && blocks[2]!.role, "check");
		assert.equal(blocks.some((b) => b.kind === "text" && b.markdown.includes("never be asked")), false);
	});

	it("places artifacts from successful results only", () => {
		const blocks = authorBlocksFromMessages([
			{ role: "assistant", content: [fauxToolCall("figure", { brief: "x" }, { id: "v1" }), fauxToolCall("figure", { brief: "y" }, { id: "v2" })] },
			{ role: "toolResult", toolCallId: "v1", isError: false, details: { kind: "visual", svg: "<svg/>" } },
			{ role: "toolResult", toolCallId: "v2", isError: true, details: null },
		]);
		assert.deepEqual(blocks, [{ kind: "visual", svg: "<svg/>" }]);
	});

	it("stores a written lesson in place, with its cost record", () => {
		const c = planned(base);
		const usage = [{ model: "faux:x", steps: [{ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }] }];
		const written = fillAuthoredLesson(c, "l2", [{ kind: "text", markdown: "hi" }], usage, NOW);
		const l2 = written.lessons[1]!;
		assert.equal(l2.status, undefined);
		assert.equal(l2.brief, "Why start from axioms");
		assert.deepEqual(l2.authored, { at: NOW, usage });
		assert.equal(canAuthorLesson(l2), true, "an authored lesson can be rewritten");
		assert.equal(authoredCost(l2), null, "an unknown model is unpriced, never guessed");
		const fromSession = { ...l2, authored: undefined, sourceChatId: "chat_9" };
		assert.equal(canAuthorLesson(fromSession), false);
		assert.equal(fillAuthoredLesson({ ...c, lessons: [fromSession] }, "l2", [], usage, NOW).lessons[0], fromSession);
	});
});

describe("the author queue (store + server)", () => {
	it("writes a planned lesson and stores it in place", async () => {
		const course = courseStore.createCourse("Geometry");
		planCourseLessons(course.id, [{ title: "Angles", brief: "Degrees and radians" }]);
		const lessonId = courseStore.getCourse(course.id)!.lessons[0]!.id;
		const outcome = await authorLesson(course.id, lessonId, { engine: engine(lessonScript()) });
		assert.ok(outcome.ok, outcome.ok ? "" : outcome.error);
		const stored = courseStore.getCourse(course.id)!.lessons[0]!;
		assert.equal(stored.id, lessonId);
		assert.equal(stored.status, undefined);
		assert.equal(stored.blocks.length, 6);
		assert.equal(stored.authored!.usage.length, 1);
		assert.equal(stored.authored!.usage[0]!.steps.length, 5);
	});

	it("reports a run that wrote nothing, and leaves the lesson planned", async () => {
		const course = courseStore.createCourse("Empty");
		planCourseLessons(course.id, [{ title: "Nothing" }]);
		const lessonId = courseStore.getCourse(course.id)!.lessons[0]!.id;
		const outcome = await authorLesson(course.id, lessonId, {
			engine: engine([() => fauxAssistantMessage([fauxToolCall("finish_lesson", {}, { id: "f" })], { stopReason: "toolUse" })]),
		});
		assert.deepEqual(outcome, { ok: false, error: "The author agent wrote nothing for this lesson." });
		assert.equal(courseStore.getCourse(course.id)!.lessons[0]!.status, "planned");
	});

	it("queues every planned lesson, refuses session lessons, and clears status when written", async () => {
		setAuthorEnginesForTests(() => ({ engine: engine(lessonScript()) }));
		const course = courseStore.createCourse("Queue");
		planCourseLessons(course.id, [{ title: "One" }]);
		const stored = courseStore.getCourse(course.id)!;
		courseStore.saveCourse({
			...stored,
			lessons: [...stored.lessons, { id: "s", title: "Session", sourceChatId: "chat_1", publishedAt: NOW, blocks: [] }],
		});
		assert.equal(queueCourseAuthoring(course.id, ["s"]).ok, false);
		assert.deepEqual(queueCourseAuthoring("course_missing"), { ok: false, status: 404, error: "Course not found" });
		const queued = queueCourseAuthoring(course.id);
		assert.deepEqual(queued, { ok: true, queued: 1 });
		for (let i = 0; i < 100 && Object.keys(courseAuthoringStatus(course.id)).length > 0; i++) await new Promise((r) => setTimeout(r, 20));
		assert.deepEqual(courseAuthoringStatus(course.id), {});
		assert.equal(courseStore.getCourse(course.id)!.lessons[0]!.status, undefined);

		setAuthorEnginesForTests(() => "No conversation model is set up. Choose one in Settings first.");
		assert.deepEqual(queueCourseAuthoring(course.id), {
			ok: false,
			status: 503,
			error: "No conversation model is set up. Choose one in Settings first.",
		});
	});
});
