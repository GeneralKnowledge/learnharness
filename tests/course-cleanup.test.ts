/**
 * PUBLISH-TIME CLEANUP PINS (owner, 2026-10-25): the cleanup pass rewrites
 * learner-specific wording but can never touch code, math, diagrams,
 * figures, demos, the plan map, or the values grading compares; a rewrite
 * that loses a protected span keeps the original; only whole text blocks
 * may be dropped.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyCleanup,
	batchSegments,
	buildCleanupPrompt,
	cleanupSegments,
	parseCleanupReply,
	protectWording,
	restoreWording,
} from "../src/core/course-cleanup.ts";
import type { CourseBlock } from "../src/core/contracts.ts";

const MERMAID = "```mermaid\ngraph TD\n  A[you said] --> B\n```";

describe("protecting code and math", () => {
	it("swaps fences, math and inline code for placeholders and restores them", () => {
		const source = `As you said, $x^2$ grows.\n\n${MERMAID}\n\nUse \`print(you)\` and $$\\int f$$ or \\(a\\) and \\[b\\].`;
		const { text, slots } = protectWording(source);
		assert.equal(slots.length, 6);
		assert.ok(!text.includes("graph TD") && !text.includes("x^2") && !text.includes("print"));
		assert.equal(restoreWording(text, slots), source);
	});

	it("leaves prices as prose", () => {
		assert.deepEqual(protectWording("It costs $5 and $10.").slots, []);
	});

	it("never nests one protected span inside another", () => {
		const { text, slots } = protectWording("See $`x`$ here.");
		assert.equal(slots.length, 1);
		assert.equal(restoreWording(text, slots), "See $`x`$ here.");
	});

	it("protects an unclosed fence to the end", () => {
		const { text, slots } = protectWording("Intro\n```python\nprint(1)");
		assert.equal(text, "Intro\n⟦P0⟧");
		assert.equal(slots[0], "```python\nprint(1)");
	});

	it("refuses a rewrite that loses, repeats or invents a placeholder", () => {
		const slots = ["$a$", "$b$"];
		assert.equal(restoreWording("only ⟦P0⟧", slots), null);
		assert.equal(restoreWording("⟦P0⟧ ⟦P0⟧ ⟦P1⟧", slots), null);
		assert.equal(restoreWording("⟦P0⟧ ⟦P1⟧ ⟦P2⟧", slots), null);
		assert.equal(restoreWording("⟦P1⟧ then ⟦P0⟧", slots), "$b$ then $a$");
	});

	it("refuses a rewrite that moves a fence into a sentence", () => {
		const slots = ["```mermaid\ngraph TD\n```"];
		assert.equal(restoreWording("See ⟦P0⟧ here.", slots), null);
		assert.equal(restoreWording("See below.\n⟦P0⟧", slots), "See below.\n```mermaid\ngraph TD\n```");
	});
});

const blocks: CourseBlock[] = [
	{ kind: "plan", data: { kind: "full", at: "", current: null, nodes: [{ id: "a", title: "A", status: "upcoming" }], edges: [] } },
	{ kind: "text", markdown: `Great answer! As you said, $f(x)$ is a function.\n\n${MERMAID}` },
	{
		kind: "choice",
		question: "Since you know Java, which is right?",
		options: [
			{ label: "Your pick", value: "a" },
			{ label: "$x$", value: "b" },
		],
		correct: ["b"],
		multiSelect: false,
		explanation: "You were close.",
	},
	{ kind: "visual", svg: "<svg>you said</svg>" },
	{ kind: "text", markdown: "Nice work, you nailed it!" },
	{ kind: "demo", title: "Demo", html: "<p>you</p>" },
	{ kind: "text", markdown: "Next comes recursion." },
	{ kind: "recall", question: "Why, in your words?", answer: "Because." },
];

describe("segments", () => {
	const segments = cleanupSegments(blocks);

	it("sends wording only — never visuals, demos, the plan, or option values", () => {
		assert.deepEqual(
			segments.map((s) => s.id),
			["1:markdown", "2:question", "2:option0", "2:option1", "2:explanation", "4:markdown", "6:markdown", "7:question", "7:answer"],
		);
		const prompt = buildCleanupPrompt(segments);
		assert.ok(!prompt.includes("<svg>") && !prompt.includes("<p>you</p>") && !prompt.includes("graph TD"));
	});

	it("batches by size, never splitting a segment", () => {
		const batches = batchSegments(segments, 40);
		assert.equal(batches.flat().length, segments.length);
		assert.ok(batches.length > 1);
	});
});

describe("applying a rewrite", () => {
	const segments = cleanupSegments(blocks);

	it("rewrites wording, drops learner-only text, merges neighbours, and keeps the rest", () => {
		const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
			"1:markdown": "⟦P1⟧ is a function.\n\n⟦P0⟧",
			"2:question": "Which is right?",
			"2:option0": "The first option",
			"2:explanation": "",
			"4:markdown": "",
			"7:question": "Why, in a sentence?",
			"9:markdown": "unknown id",
		})}\n\`\`\``;
		const result = applyCleanup(blocks, segments, parseCleanupReply(reply));

		assert.equal(result.dropped, 1);
		assert.equal(result.refused, 1, "a question's explanation may not be emptied");
		assert.equal(result.rewritten, 5);
		assert.deepEqual(result.blocks[1], { kind: "text", markdown: `$f(x)$ is a function.\n\n${MERMAID}` });
		const choice = result.blocks[2] as Extract<CourseBlock, { kind: "choice" }>;
		assert.equal(choice.question, "Which is right?");
		assert.deepEqual(choice.options, [
			{ label: "The first option", value: "a" },
			{ label: "$x$", value: "b" },
		]);
		assert.deepEqual(choice.correct, ["b"]);
		assert.equal(choice.explanation, "You were close.");
		assert.deepEqual(result.blocks[3], blocks[3]);
		assert.deepEqual(result.blocks[4], blocks[5]);
		assert.deepEqual(result.blocks.map((b) => b.kind), ["plan", "text", "choice", "visual", "demo", "text", "recall"]);
		// The input is never mutated.
		assert.equal((blocks[2] as Extract<CourseBlock, { kind: "choice" }>).question, "Since you know Java, which is right?");
	});

	it("keeps the original when a rewrite mangles a protected span", () => {
		const result = applyCleanup(blocks, segments, new Map([["1:markdown", "f(x) is a function."]]));
		assert.equal(result.refused, 1);
		assert.deepEqual(result.blocks[1], blocks[1]);
	});

	it("merges text blocks a drop leaves side by side", () => {
		const three: CourseBlock[] = [
			{ kind: "text", markdown: "One." },
			{ kind: "visual", svg: "<svg/>" },
			{ kind: "text", markdown: "Two." },
		];
		const result = applyCleanup(three, cleanupSegments(three), new Map());
		assert.deepEqual(result.blocks, three);
		const noVisual = [three[0]!, { kind: "text", markdown: "Well done!" } as CourseBlock, three[2]!];
		const merged = applyCleanup(noVisual, cleanupSegments(noVisual), new Map([["1:markdown", ""]]));
		assert.deepEqual(merged.blocks, [{ kind: "text", markdown: "One.\n\nTwo." }]);
	});

	it("reads nothing from an unreadable reply", () => {
		assert.equal(parseCleanupReply("sorry").size, 0);
		assert.equal(parseCleanupReply("{not json}").size, 0);
		assert.equal(parseCleanupReply('["a"]').size, 0);
	});
});
