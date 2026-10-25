/**
 * EXERCISE PINS (owner, 2026-10-25: "simple exercises, no runner"): an
 * exercise is a task, hints, a model answer and the reader's own mark —
 * for any subject, nothing run or graded. The author agent places them;
 * the reader card shows the task and attempt box, with hints and the
 * answer behind buttons.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { exerciseBlock } from "../src/core/course.ts";
import { authorBlocksFromMessages } from "../src/core/course-author.ts";
import { runLessonAuthor } from "../src/agent/author-agent.ts";
import { LessonBlocks } from "../components/course/lesson-blocks.tsx";
import type { CourseBlock } from "../src/core/contracts.ts";

describe("exercise blocks", () => {
	it("project from a call: hints tolerated as JSON text, response defaults to text", () => {
		assert.deepEqual(exerciseBlock({ task: " Prove it. ", hints: '["Induct on n", ""]', answer: "By induction…" }), {
			kind: "exercise",
			task: "Prove it.",
			hints: ["Induct on n"],
			answer: "By induction…",
			response: "text",
		});
		assert.deepEqual(exerciseBlock({ task: "Sum a list", hints: [], answer: "sum(xs)", response: "code", language: "python" }), {
			kind: "exercise",
			task: "Sum a list",
			hints: [],
			answer: "sum(xs)",
			response: "code",
			language: "python",
		});
		assert.equal(exerciseBlock({ task: "No answer", hints: [] }), null);
	});

	it("the author agent places them, and a refused one is dropped", async () => {
		const faux = createFauxCore({});
		faux.setResponses([
			() =>
				fauxAssistantMessage(
					[fauxText("Apply it."), fauxToolCall("exercise", { task: "Date the charter.", hints: ["Look at the witnesses"], answer: "", response: "text" }, { id: "x1" })],
					{ stopReason: "toolUse" },
				),
			() =>
				fauxAssistantMessage(
					[fauxToolCall("exercise", { task: "Date the charter.", hints: ["Look at the witnesses"], answer: "c. 1150, from the witness list.", response: "text" }, { id: "x2" })],
					{ stopReason: "toolUse" },
				),
			() => fauxAssistantMessage([fauxToolCall("finish_lesson", {}, { id: "f" })], { stopReason: "toolUse" }),
		]);
		const messages = await runLessonAuthor("Write it.", { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, onUsage: () => {} });
		const blocks = authorBlocksFromMessages(messages);
		assert.deepEqual(blocks.map((b) => b.kind), ["text", "exercise"]);
		assert.equal(blocks[1]!.kind === "exercise" && blocks[1]!.answer, "c. 1150, from the witness list.");
	});

	it("render the task and attempt box, with hints and the answer behind buttons", () => {
		const blocks: CourseBlock[] = [
			{ kind: "exercise", task: "Write `double(n)`.", hints: ["Multiply", "By two"], answer: "def double(n):\n    return 2 * n", response: "code", language: "python" },
			{ kind: "exercise", task: "Explain the result.", hints: [], answer: "Because…", response: "text" },
		];
		const html = renderToStaticMarkup(<LessonBlocks blocks={blocks} />);
		assert.match(html, /Exercise · python/);
		assert.match(html, /aria-label="Your code"/);
		assert.match(html, /aria-label="Your attempt"/);
		assert.match(html, /Show a hint \(1 of 2\)/);
		assert.equal((html.match(/Show the model answer/g) ?? []).length, 2);
		assert.doesNotMatch(html, /return 2 \* n/, "the answer stays hidden until asked for");
		assert.doesNotMatch(html, /Multiply/, "hints stay hidden until asked for");
	});
});
