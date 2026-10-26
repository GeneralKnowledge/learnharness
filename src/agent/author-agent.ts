import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { PATHS } from "../../config.ts";
import type { CallUsage, PlanBlockData } from "../core/contracts.ts";
import { AUTHOR_TOOLS, type AuthorArtifact } from "../core/course-author.ts";
import { explainInputProblems, quizInputProblems } from "../core/question-core.ts";
import type { PiEngine } from "./models.ts";
import { invalidInputResult } from "./tool-execute.ts";
import { healToolRecord } from "./tools/heal.ts";
import { parseMermaidPlan } from "./tools/mermaid-plan.ts";
import { runDemoBuilder } from "./subagents/demo-builder.ts";
import type { HeadlessApi } from "./subagents/headless.ts";
import { runSubagent } from "./subagents/pi-run.ts";
import { runVisualMaker } from "./subagents/visual-maker.ts";

/**
 * THE AUTHOR (author wave, owner 2026-10-25: "an author agent writes each
 * lesson from a brief, for a stated audience"). One run writes one whole
 * lesson with no learner in the loop:
 *
 * - its questions are RECORDED, not posed — quiz/explain validate exactly
 *   like the teacher's and return at once, so nothing stops the run;
 * - figures and demos are built INLINE: the tool awaits the same visual
 *   maker / demo builder the teacher's jobs use, so the artifact lands at
 *   the call and the author can teach with it in the next sentence;
 * - finish_lesson ends the run.
 *
 * The projection to lesson blocks is pure core (core/course-author.ts);
 * the queue that drives runs and stores lessons is src/server/course-author.ts.
 *
 * The prompt is author/00-base.md followed by the teacher's method,
 * question principles, accuracy, voice and formatting fragments — the same
 * doctrine, re-aimed at a reader (the base says how to read "he").
 */

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");

/** The fragments the author composes, in order. */
export const AUTHOR_PROMPT_FRAGMENTS = [
	"author/00-base.md",
	"teacher/05-method.md",
	"teacher/30-question-principles.md",
	"shared/15-accuracy.md",
	"shared/10-voice.md",
	"shared/40-formatting.md",
] as const;

export function composeAuthorInstructions(): string {
	return AUTHOR_PROMPT_FRAGMENTS.map((f) => fs.readFileSync(path.join(PROMPTS_DIR, f), "utf-8").trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

const optionSchema = Type.Object({
	label: Type.String({ description: "The option as the reader sees it (markdown and $math$ allowed)." }),
	value: Type.String({ description: "A short stable key for this option, referenced by correctAnswer." }),
});

const authorQuizSchema = Type.Object({
	type: Type.Union([Type.Literal("predict"), Type.Literal("check")], {
		description: "predict: before the step it motivates. check: after the step's teaching is complete.",
	}),
	question: Type.String({ description: "The question." }),
	options: Type.Array(optionSchema, { minItems: 2, description: "The options (2 or more), as a JSON array." }),
	multiSelect: Type.Optional(Type.Boolean({ description: "True when more than one option is correct." })),
	explanation: Type.String({
		description: "Shown after the reader answers, right or wrong: why the correct answer is correct. Written before correctAnswer.",
	}),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description: "The value(s) of the correct option(s). An array only with multiSelect.",
	}),
});

const authorExplainSchema = Type.Object({
	type: Type.Union([Type.Literal("predict"), Type.Literal("check")], {
		description: "predict: before the step it motivates. check: after the step's teaching is complete.",
	}),
	question: Type.String({ description: "The question; the reader answers in his own words." }),
	correctAnswer: Type.String({
		description: "The full correct answer, reasoning included. Shown to the reader after he answers.",
	}),
});

const exerciseSchema = Type.Object({
	task: Type.String({
		description: "What the reader must do — complete on its own (data, constraints, what a finished answer looks like).",
	}),
	hints: Type.Array(Type.String(), {
		description: "Hints revealed one at a time, from a nudge to nearly the method. May be empty.",
	}),
	answer: Type.String({
		description: "The model answer, with its working: what the reader compares his attempt against and marks himself by.",
	}),
	response: Type.Union([Type.Literal("text"), Type.Literal("code")], {
		description: "What the reader writes: text (prose, working, a proof) or code.",
	}),
	language: Type.Optional(Type.String({ description: "For code: the language, e.g. python." })),
});

const figureSchema = Type.Object({
	brief: Type.String({
		description:
			"Exactly what ONE figure must show: coordinates, labels, proportions, orientation. The maker sees nothing else of the lesson.",
	}),
});

const demoSchema = Type.Object({
	title: Type.String({ description: "A short title for the demo card." }),
	brief: Type.String({
		description:
			"The concept, every control and what it does, the interactions, the visual style, and any formulas or constants. " +
			"The builder sees nothing else of the lesson.",
	}),
});

const mapSchema = Type.Object({
	mermaid: Type.String({
		description: 'The lesson\'s dependency map as a mermaid graph: "graph TD" then lines like a[First idea] --> b[Builds on it].',
	}),
});

const finishSchema = Type.Object({});

const recorded = (text: string) => ({ content: [{ type: "text" as const, text }], details: null });
const placed = (text: string, details: AuthorArtifact) => ({ content: [{ type: "text" as const, text }], details });
const failed = (text: string) => ({ content: [{ type: "text" as const, text }], details: null, isError: true });

/** pi-ai Usage → the persisted CallUsage (the chat-handler's mapping). */
export function callUsageOf(usage: Usage): CallUsage {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		reasoningTokens: usage.reasoning ?? 0,
	};
}

export interface AuthorRunDeps {
	/** The author's own model (the conversation model). */
	engine: PiEngine;
	/** Absent = no figure tool this run (no model set up for it). */
	visualEngine?: PiEngine;
	/** Absent = no demo tool this run. */
	demoEngine?: PiEngine;
	/** Test seam for the builders' browser checks. */
	headless?: HeadlessApi;
	/** Money channel: every model call, by model id ("provider:id"). */
	onUsage: (model: string, usage: CallUsage) => void;
	abortSignal?: AbortSignal;
	/** Max author model calls. Default 60. */
	maxTurns?: number;
}

const modelIdOf = (engine: PiEngine) => `${engine.model.provider}:${engine.model.id}`;

/** The author's tool registry for one run. */
export function authorTools(deps: AuthorRunDeps): Record<string, AgentTool<any>> {
	// Typed consts (not inline literals): the specific AgentTool typing gives
	// execute its precise input (teacher-agent's bareQuestionTools precedent).
	const quiz: AgentTool<typeof authorQuizSchema> = {
		name: AUTHOR_TOOLS.quiz,
		label: "quiz",
		description: "Place a multiple-choice question here in the lesson. Recorded at once; the run continues.",
		parameters: authorQuizSchema,
		executionMode: "sequential",
		execute: async (_id, input) => {
			const problems = quizInputProblems(input);
			return problems.length > 0 ? invalidInputResult(AUTHOR_TOOLS.quiz, problems) : recorded("Question recorded. Continue the lesson.");
		},
	};
	const explain: AgentTool<typeof authorExplainSchema> = {
		name: AUTHOR_TOOLS.explain,
		label: "explain",
		description: "Place a free-recall question here in the lesson. Recorded at once; the run continues.",
		parameters: authorExplainSchema,
		executionMode: "sequential",
		execute: async (_id, input) => {
			const problems = explainInputProblems(input);
			return problems.length > 0 ? invalidInputResult(AUTHOR_TOOLS.explain, problems) : recorded("Question recorded. Continue the lesson.");
		},
	};
	const exercise: AgentTool<typeof exerciseSchema> = {
		name: AUTHOR_TOOLS.exercise,
		label: "exercise",
		description: "Place an exercise here: a task the reader attempts, hints, and the model answer. Recorded at once; the run continues.",
		parameters: exerciseSchema,
		executionMode: "sequential",
		execute: async (_id, input) => {
			const problems = [
				...(input.task.trim() ? [] : ["task is required."]),
				...(input.answer.trim() ? [] : ["answer is required — write the model answer with its working."]),
			];
			return problems.length > 0
				? invalidInputResult(AUTHOR_TOOLS.exercise, problems)
				: recorded("Exercise recorded. Continue the lesson.");
		},
	};
	const map: AgentTool<typeof mapSchema> = {
		name: AUTHOR_TOOLS.map,
		label: "lesson map",
		description: "Place the lesson's dependency map here (call it first, if at all).",
		parameters: mapSchema,
		executionMode: "sequential",
		execute: async (_id, input) => {
			const parsed = parseMermaidPlan(input.mermaid);
			if (!parsed.ok || !parsed.plan) return invalidInputResult(AUTHOR_TOOLS.map, parsed.problems);
			const data: PlanBlockData = {
				kind: "full",
				at: new Date().toISOString(),
				current: null,
				nodes: parsed.plan.nodes.map((n) => ({ id: n.id, title: n.title, status: "upcoming" as const })),
				edges: parsed.plan.edges.map((e) => ({ from: e.from, to: e.to })),
			};
			return placed("Map placed.", { kind: "plan", data });
		},
	};
	const finish: AgentTool<typeof finishSchema> = {
		name: AUTHOR_TOOLS.finish,
		label: "finish lesson",
		description: "The lesson is complete. Call once, last.",
		parameters: finishSchema,
		executionMode: "sequential",
		execute: async () => ({ ...recorded("Lesson finished."), terminate: true }),
	};
	const tools: Record<string, AgentTool<any>> = {
		[AUTHOR_TOOLS.quiz]: quiz,
		[AUTHOR_TOOLS.explain]: explain,
		[AUTHOR_TOOLS.exercise]: exercise,
		[AUTHOR_TOOLS.map]: map,
		[AUTHOR_TOOLS.finish]: finish,
	};
	if (deps.visualEngine) {
		const engine = deps.visualEngine;
		const figure: AgentTool<typeof figureSchema> = {
			name: AUTHOR_TOOLS.figure,
			label: "figure",
			description: "Have one precise static figure drawn and placed here. Waits until it is built (a minute or two).",
			parameters: figureSchema,
			executionMode: "sequential",
			execute: async (_id, input) => {
				const result = await runVisualMaker(
					{ brief: input.brief },
					{
						engine,
						...(deps.headless ? { headless: deps.headless } : {}),
						abortSignal: deps.abortSignal,
						onUsage: (u) => deps.onUsage(modelIdOf(engine), callUsageOf(u)),
					},
				);
				if (!result.svg) return failed(`The figure could not be built: ${result.notes ?? "no reason given"}. Nothing was placed.`);
				return placed(`Figure built and placed here.${result.notes ? ` Maker's notes: ${result.notes}` : ""}`, {
					kind: "visual",
					svg: result.svg,
				});
			},
		};
		tools[AUTHOR_TOOLS.figure] = figure;
	}
	if (deps.demoEngine) {
		const engine = deps.demoEngine;
		const demo: AgentTool<typeof demoSchema> = {
			name: AUTHOR_TOOLS.demo,
			label: "demo",
			description: "Have one interactive demo built, tested and placed here. Waits until it is built (a few minutes).",
			parameters: demoSchema,
			executionMode: "sequential",
			execute: async (_id, input) => {
				const result = await runDemoBuilder(
					{ title: input.title, brief: input.brief },
					{
						engine,
						...(deps.headless ? { headless: deps.headless } : {}),
						abortSignal: deps.abortSignal,
						onUsage: (u) => deps.onUsage(modelIdOf(engine), callUsageOf(u)),
					},
				);
				if (!result.html) return failed(`The demo could not be built: ${result.notes ?? "no reason given"}. Nothing was placed.`);
				const title = result.title || input.title;
				return placed(`Demo "${title}" built, tested and placed here.${result.notes ? ` Builder's notes: ${result.notes}` : ""}`, {
					kind: "demo",
					title,
					html: result.html,
				});
			},
		};
		tools[AUTHOR_TOOLS.demo] = demo;
	}
	return healToolRecord(tools);
}

/** Write one lesson. Returns the run's messages (assistant + tool results);
 *  the caller projects them (core authorBlocksFromMessages). Provider
 *  failures throw, like every sub-agent run. */
export async function runLessonAuthor(prompt: string, deps: AuthorRunDeps): Promise<AgentMessage[]> {
	const { newMessages } = await runSubagent(Object.values(authorTools(deps)), {
		// The engine override is always present, so the role label never
		// resolves an engine (the cleanup pass's precedent).
		role: "teacher",
		engine: deps.engine,
		systemPrompt: composeAuthorInstructions(),
		prompt,
		maxTurns: deps.maxTurns ?? 60,
		abortSignal: deps.abortSignal,
		onUsage: (u) => deps.onUsage(modelIdOf(deps.engine), callUsageOf(u)),
		shouldStop: (message) => message.content.some((c) => c.type === "toolCall" && c.name === AUTHOR_TOOLS.finish),
	});
	return newMessages;
}
