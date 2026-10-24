/**
 * COURSE-ENGINE PINS (owner, 2026-10-24): a session publishes as a lesson
 * that keeps the teacher's material and none of the learner's words; the
 * lesson replaces itself on re-publish; the reader gate keeps a hosted
 * course site away from the studio. Runs under an isolated LH_DATA_DIR
 * (set before any config-loading import, so app modules load dynamically).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { courseBlocksFromMessages, courseLessonFromChat, upsertCourseLesson, removeCourseLesson, isChoiceCorrect } =
	await import("../src/core/course.ts");
const { readerGate, isReaderMode } = await import("../src/core/reader-gate.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { publishChatToCourse, deleteCourseLesson, updateCourseDetails } = await import("../src/server/courses.ts");
type LhMessage = import("../src/core/native-messages.ts").LhMessage;

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

let seq = 0;
const id = () => `m${++seq}`;
const user = (text: string) => ({ id: id(), role: "user", content: text, timestamp: 0 }) as unknown as LhMessage;
const assistant = (...content: unknown[]) =>
	({ id: id(), role: "assistant", content, timestamp: 0 }) as unknown as LhMessage;
const text = (t: string) => ({ type: "text", text: t });
const call = (callId: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall", id: callId, name, arguments: args });
const result = (callId: string, toolName: string, isError = false, details: unknown = {}) =>
	({ id: id(), role: "toolResult", toolCallId: callId, toolName, isError, content: [], details, timestamp: 0 }) as unknown as LhMessage;
const marker = (customType: string, details: unknown) =>
	({ id: id(), role: "custom", customType, content: "", display: true, details, timestamp: 0 }) as unknown as LhMessage;

const plan = {
	kind: "full",
	at: "2026-10-24T00:00:00.000Z",
	current: "b",
	nodes: [
		{ id: "a", title: "Definitions", status: "visited" },
		{ id: "b", title: "Chain rule", status: "current" },
	],
	edges: [{ from: "a", to: "b" }],
};

const teachSession: LhMessage[] = [
	user("I want to understand the chain rule"),
	assistant(text("Let me see where you are."), call("p1", "probe", { question: "Q?", options: [{ label: "x", value: "x" }, { label: "y", value: "y" }], correctAnswer: "x" })),
	result("p1", "probe", false, { correct: false, thinking: "I guessed" }),
	marker("plan-block", plan),
	assistant({ type: "thinking", thinking: "private reasoning" }, text("Start from **rates**."), text("Then $\\frac{dy}{dx}$.")),
	assistant(
		call("q1", "quiz", {
			type: "predict",
			nodeId: "b",
			question: "What is $\\frac{dy}{dt}$?",
			options: '[{"label":"$6\\\\cos(2x)$","value":"a"},{"label":"$2\\\\cos(2x)$","value":"b"}]',
			explanation: "Multiply the rates.",
			correctAnswer: "$6\\cos(2x)$",
		}),
	),
	result("q1", "quiz", false, { correct: true }),
	user("that clicked, my answer was a"),
	assistant(call("q2", "quiz", { question: "Broken?", options: [], correctAnswer: "z" })),
	result("q2", "quiz", true),
	assistant(call("e1", "explain", { type: "check", nodeId: "b", question: "Why multiply?", correctAnswer: "Because rates compose." })),
	result("e1", "explain", false, { text: "learner words" }),
	marker("subagent-steer", { jobId: "j1", kind: "visual", toolCallId: "v1", result: { svg: "<svg></svg>" } }),
	marker("subagent-steer", { jobId: "j2", kind: "visual", toolCallId: "v2", result: { svg: "", notes: "failed" } }),
	marker("subagent-steer", { jobId: "j3", kind: "demo", toolCallId: "d1", result: { title: "Slider", html: "<p>hi</p>", tested: true } }),
	marker("subagent-steer", { jobId: "j4", kind: "research", toolCallId: "r1", result: { brief: "notes", sources: [] } }),
	assistant(text("That's the whole idea.")),
];

describe("session → lesson projection", () => {
	const blocks = courseBlocksFromMessages(teachSession);

	it("starts at the plan: the probe phase and its questions stay out", () => {
		assert.equal(blocks[0]?.kind, "plan");
		assert.ok(!JSON.stringify(blocks).includes("Let me see where you are"));
		assert.ok(!JSON.stringify(blocks).includes("Q?"));
	});

	it("keeps no learner words, answers, or agent reasoning", () => {
		const all = JSON.stringify(blocks);
		for (const learner of ["chain rule", "that clicked", "learner words", "I guessed", "private reasoning"]) {
			assert.ok(!all.includes(learner), `leaked: ${learner}`);
		}
	});

	it("clears the learner's position from the plan map", () => {
		const planBlock = blocks[0] as Extract<(typeof blocks)[number], { kind: "plan" }>;
		assert.equal(planBlock.data.current, null);
		assert.ok(planBlock.data.nodes.every((n) => n.status === "upcoming"));
	});

	it("merges consecutive teacher text into one block", () => {
		assert.deepEqual(blocks[1], { kind: "text", markdown: "Start from **rates**.\n\nThen $\\frac{dy}{dx}$." });
	});

	it("keeps a quiz with the committed answer, healing string options and label answers", () => {
		assert.deepEqual(blocks[2], {
			kind: "choice",
			question: "What is $\\frac{dy}{dt}$?",
			options: [
				{ label: "$6\\cos(2x)$", value: "a" },
				{ label: "$2\\cos(2x)$", value: "b" },
			],
			correct: ["a"],
			multiSelect: false,
			explanation: "Multiply the rates.",
			role: "predict",
		});
	});

	it("drops a question whose call failed", () => {
		assert.ok(!JSON.stringify(blocks).includes("Broken?"));
	});

	it("keeps free-recall questions with the committed answer", () => {
		assert.deepEqual(blocks[3], { kind: "recall", question: "Why multiply?", answer: "Because rates compose.", role: "check" });
	});

	it("keeps delivered figures and demos, never failed ones or research briefs", () => {
		assert.deepEqual(blocks[4], { kind: "visual", svg: "<svg></svg>" });
		assert.deepEqual(blocks[5], { kind: "demo", title: "Slider", html: "<p>hi</p>" });
		assert.deepEqual(blocks[6], { kind: "text", markdown: "That's the whole idea." });
		assert.equal(blocks.length, 7);
	});

	it("keeps a session with no plan whole", () => {
		const noPlan = courseBlocksFromMessages([assistant(text("Intro."))]);
		assert.deepEqual(noPlan, [{ kind: "text", markdown: "Intro." }]);
	});

	it("practice sessions keep only problems and model solutions", () => {
		const practice = courseBlocksFromMessages(
			[
				assistant(text("Here is one.")),
				assistant(call("pr1", "problem", { statement: "Differentiate $x^2$.", mode: "recall", modelSolution: "$2x$" })),
				result("pr1", "problem"),
				user("is it 2x?"),
				assistant(text("Hint: power rule.")),
			],
			"practice",
		);
		assert.deepEqual(practice, [{ kind: "problem", statement: "Differentiate $x^2$.", solution: "$2x$" }]);
	});
});

describe("lesson assembly", () => {
	const chat = { id: "chat_1", title: "Chain rule", createdAt: "", updatedAt: "", messages: teachSession };
	const base = { id: "course_1", title: "Calculus", createdAt: "", updatedAt: "", lessons: [] };

	it("re-publishing a session replaces its lesson in place, keeping id and position", () => {
		const first = courseLessonFromChat(chat, { id: "lesson_a", now: "t1" });
		const other = { ...courseLessonFromChat({ ...chat, id: "chat_2", title: "Limits" }, { id: "lesson_b", now: "t1" }) };
		let course = upsertCourseLesson(upsertCourseLesson(base, first, "t1"), other, "t1");
		const again = courseLessonFromChat(chat, { id: "lesson_new", now: "t2", title: "Chain rule, revised" });
		course = upsertCourseLesson(course, again, "t2");
		assert.deepEqual(
			course.lessons.map((l) => [l.id, l.title]),
			[
				["lesson_a", "Chain rule, revised"],
				["lesson_b", "Limits"],
			],
		);
		assert.equal(course.updatedAt, "t2");
	});

	it("removing an unknown lesson returns the course unchanged", () => {
		assert.equal(removeCourseLesson(base, "nope", "t3"), base);
	});

	it("grades a choice only on the exact correct set", () => {
		assert.equal(isChoiceCorrect(["a"], ["a"]), true);
		assert.equal(isChoiceCorrect(["a", "b"], ["b", "a"]), true);
		assert.equal(isChoiceCorrect(["a"], ["a", "b"]), false);
		assert.equal(isChoiceCorrect(["a", "c"], ["a"]), false);
	});
});

describe("publishing (store + server)", () => {
	it("publishes a session into a new course, then updates it in place", () => {
		const chat = chatStore.createChat("Chain rule");
		chatStore.saveMessages(chat.id, teachSession);
		const first = publishChatToCourse({ chatId: chat.id, courseTitle: "Calculus" });
		assert.ok(first.ok);
		assert.equal(first.course.title, "Calculus");
		assert.equal(first.replaced, false);

		const again = publishChatToCourse({ chatId: chat.id, courseId: first.course.id });
		assert.ok(again.ok);
		assert.equal(again.replaced, true);
		assert.equal(again.lesson.id, first.lesson.id);

		const stored = courseStore.getCourse(first.course.id);
		assert.equal(stored?.lessons.length, 1);
		assert.equal(stored?.version, 1);
		assert.deepEqual(
			courseStore.listCourses().map((c) => c.title),
			["Calculus"],
		);
	});

	it("refuses unknown sessions, unknown courses, and sessions with nothing to teach", () => {
		assert.deepEqual(publishChatToCourse({ chatId: "chat_missing" }), { ok: false, status: 404, error: "Session not found" });
		const chat = chatStore.createChat("Empty");
		const missingCourse = publishChatToCourse({ chatId: chat.id, courseId: "course_missing" });
		assert.equal(missingCourse.ok, false);
		assert.equal(!missingCourse.ok && missingCourse.status, 404);
		const empty = publishChatToCourse({ chatId: chat.id });
		assert.equal(!empty.ok && empty.status, 400);
	});

	it("renames, describes, and removes lessons", () => {
		const course = courseStore.createCourse("Draft");
		assert.equal(updateCourseDetails(course.id, { title: "Final", description: "About things" })?.description, "About things");
		assert.equal("description" in (updateCourseDetails(course.id, { description: "" }) ?? {}), false);
		assert.equal(deleteCourseLesson("course_missing", "x"), null);
		assert.equal(courseStore.getCourse("../etc"), null, "ids are path-guarded");
	});
});

describe("reader gate", () => {
	it("is off unless LH_READER=1", () => {
		assert.equal(isReaderMode({}), false);
		assert.equal(isReaderMode({ LH_READER: "1" }), true);
	});

	it("serves the library and its assets, nothing of the studio", () => {
		assert.equal(readerGate("/", "GET"), "home");
		assert.equal(readerGate("/courses", "GET"), "allow");
		assert.equal(readerGate("/courses/course_1/lesson_a", "GET"), "allow");
		assert.equal(readerGate("/_next/static/chunk.js", "GET"), "allow");
		assert.equal(readerGate("/fonts/cmu.woff2", "GET"), "allow");
		assert.equal(readerGate("/api/courses", "GET"), "allow");
		assert.equal(readerGate("/api/courses", "POST"), "deny");
		assert.equal(readerGate("/api/courses/course_1", "DELETE"), "deny");
		assert.equal(readerGate("/api/chats", "GET"), "deny");
		assert.equal(readerGate("/api/settings", "GET"), "deny");
		assert.equal(readerGate("/chat/new", "GET"), "deny");
		assert.equal(readerGate("/api/chats/x/markdown.md", "GET"), "deny");
	});
});
