/**
 * Author mode — the pure half (author wave, owner 2026-10-25: "an author
 * agent writes each lesson from a brief, for a stated audience").
 *
 * A planned lesson (a title and a brief in a course) is written by the
 * author agent (src/agent/author-agent.ts) with no learner in the loop: it
 * writes the material, records its questions with their answers, and
 * commissions figures and demos, which it waits for. This module:
 *
 * - builds the brief the agent receives (authorLessonPrompt) from the
 *   lesson's place in its course and programme — nothing subject-specific;
 * - projects the agent's run into lesson blocks (authorBlocksFromMessages),
 *   with the same question shapes a published session produces;
 * - stores the written lesson in place (fillAuthoredLesson).
 *
 * Browser-safe; no I/O.
 */

import type { CourseBlock, CourseLesson, CourseRecord } from "./contracts/course.ts";
import type { CallUsage, PlanBlockData } from "./contracts/chat.ts";
import { choiceBlock, isPlannedLesson, recallBlock } from "./course.ts";
import { callCost } from "./prices.ts";

/** The author agent's tool names (src/agent/author-agent.ts). */
export const AUTHOR_TOOLS = {
	quiz: "quiz",
	explain: "explain",
	figure: "figure",
	demo: "demo",
	map: "lesson_map",
	finish: "finish_lesson",
} as const;

/** What the author agent's figure, demo and map tools return in a
 *  successful result's details — the block to place at the call. */
export type AuthorArtifact =
	| { kind: "visual"; svg: string }
	| { kind: "demo"; title: string; html: string }
	| { kind: "plan"; data: PlanBlockData };

/** Everything the brief says about where a lesson sits. */
export interface AuthorLessonContext {
	programme?: { title: string; description?: string; audience?: string };
	course: { title: string; description?: string };
	/** Titles of the modules this one requires (from the programme). */
	requires: string[];
	lesson: { title: string; brief?: string; section?: string };
	/** 1-based place in the course, and the course's length. */
	number: number;
	total: number;
	before: Array<{ title: string; brief?: string }>;
	after: Array<{ title: string; brief?: string }>;
}

const list = (items: Array<{ title: string; brief?: string }>) =>
	items.map((l, i) => `${i + 1}. ${l.title}${l.brief ? ` — ${l.brief}` : ""}`).join("\n");

/** The user message for one lesson: its place, audience and brief. */
export function authorLessonPrompt(ctx: AuthorLessonContext): string {
	const lines: string[] = ["Write this lesson.", ""];
	if (ctx.programme) {
		lines.push(`Programme: ${ctx.programme.title}${ctx.programme.description ? ` — ${ctx.programme.description}` : ""}`);
	}
	lines.push(
		`Audience: ${
			ctx.programme?.audience ??
			"not stated — write for a motivated adult who is new to this module and has finished the modules it requires"
		}`,
	);
	lines.push(`Module: ${ctx.course.title}${ctx.course.description ? ` — ${ctx.course.description}` : ""}`);
	if (ctx.requires.length > 0) lines.push(`Modules the reader has finished: ${ctx.requires.join(", ")}`);
	if (ctx.lesson.section) lines.push(`Section: ${ctx.lesson.section}`);
	lines.push(`Lesson ${ctx.number} of ${ctx.total}: ${ctx.lesson.title}`);
	lines.push(`Brief: ${ctx.lesson.brief ?? "none — decide the scope from the title and the lesson's place in the module"}`);
	if (ctx.before.length > 0) {
		lines.push("", "Earlier lessons in this module (the reader has read them; build on them, don't repeat them):", list(ctx.before));
	}
	if (ctx.after.length > 0) {
		lines.push("", "Later lessons in this module (leave their material to them):", list(ctx.after));
	}
	return lines.join("\n");
}

type RunMessage = {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	isError?: boolean;
	details?: unknown;
};

function artifactBlock(details: unknown): CourseBlock | null {
	const d = details as Partial<AuthorArtifact> | null | undefined;
	if (!d) return null;
	if (d.kind === "visual" && typeof d.svg === "string" && d.svg) return { kind: "visual", svg: d.svg };
	if (d.kind === "demo" && typeof d.html === "string" && d.html) {
		return { kind: "demo", title: typeof d.title === "string" && d.title ? d.title : "Demo", html: d.html };
	}
	if (d.kind === "plan" && d.data && Array.isArray(d.data.nodes) && d.data.nodes.length > 0) return { kind: "plan", data: d.data };
	return null;
}

/**
 * The lesson the author agent wrote, in reading order: its prose, its
 * questions (a call the tool refused is dropped — the agent retried it),
 * and each figure, demo or map where it was called. Pure.
 */
export function authorBlocksFromMessages(messages: readonly unknown[]): CourseBlock[] {
	const results = new Map<string, RunMessage>();
	for (const raw of messages) {
		const m = raw as RunMessage;
		if (m.role === "toolResult" && m.toolCallId) results.set(m.toolCallId, m);
	}
	const blocks: CourseBlock[] = [];
	const push = (block: CourseBlock | null) => {
		if (!block) return;
		const last = blocks.at(-1);
		if (block.kind === "text" && last?.kind === "text") last.markdown = `${last.markdown}\n\n${block.markdown}`;
		else blocks.push(block);
	};
	for (const raw of messages) {
		const m = raw as RunMessage;
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		for (const part of m.content as Array<{ type?: string; text?: string; id?: string; name?: string; arguments?: unknown }>) {
			if (part.type === "text") {
				const text = (part.text ?? "").trim();
				if (text) push({ kind: "text", markdown: text });
				continue;
			}
			if (part.type !== "toolCall" || !part.id) continue;
			const result = results.get(part.id);
			if (!result || result.isError) continue;
			const args = (part.arguments ?? {}) as Record<string, unknown>;
			if (part.name === AUTHOR_TOOLS.quiz) push(choiceBlock(args));
			else if (part.name === AUTHOR_TOOLS.explain) push(recallBlock(args));
			else push(artifactBlock(result.details));
		}
	}
	return blocks;
}

/** Can the author agent (re)write this lesson? Planned lessons, and lessons
 *  it wrote before — never one published from a session. */
export function canAuthorLesson(lesson: CourseLesson): boolean {
	return isPlannedLesson(lesson) || lesson.authored !== undefined;
}

/** The brief context for one lesson of a course. Null when the lesson is
 *  unknown. */
export function authorContextFor(
	course: CourseRecord,
	lessonId: string,
	programme?: { title: string; description?: string; audience?: string; requires: string[] },
): AuthorLessonContext | null {
	const index = course.lessons.findIndex((l) => l.id === lessonId);
	if (index < 0) return null;
	const lesson = course.lessons[index]!;
	const brief = (l: CourseLesson) => ({ title: l.title, ...(l.brief ? { brief: l.brief } : {}) });
	return {
		...(programme
			? {
					programme: {
						title: programme.title,
						...(programme.description ? { description: programme.description } : {}),
						...(programme.audience ? { audience: programme.audience } : {}),
					},
				}
			: {}),
		course: { title: course.title, ...(course.description ? { description: course.description } : {}) },
		requires: programme?.requires ?? [],
		lesson: {
			title: lesson.title,
			...(lesson.brief ? { brief: lesson.brief } : {}),
			...(lesson.section ? { section: lesson.section } : {}),
		},
		number: index + 1,
		total: course.lessons.length,
		before: course.lessons.slice(0, index).map(brief),
		after: course.lessons.slice(index + 1).map(brief),
	};
}

/** Store a written lesson in place: same id, title, place, section and
 *  brief; the blocks and the authoring record replace what was there.
 *  The course is returned unchanged when the lesson is unknown or was
 *  published from a session meanwhile. */
export function fillAuthoredLesson(
	course: CourseRecord,
	lessonId: string,
	blocks: CourseBlock[],
	usage: Array<{ model: string; steps: CallUsage[] }>,
	now: string,
): CourseRecord {
	const target = course.lessons.find((l) => l.id === lessonId);
	if (!target || !canAuthorLesson(target)) return course;
	const lessons = course.lessons.map((l) => {
		if (l.id !== lessonId) return l;
		const { status: _, ...rest } = l;
		return { ...rest, sourceChatId: "", publishedAt: now, blocks, authored: { at: now, usage } };
	});
	return { ...course, lessons, updatedAt: now };
}

/** What writing this lesson cost, in USD — null when it wasn't written by
 *  the author agent or a model's price is unknown (never guess a price). */
export function authoredCost(lesson: Pick<CourseLesson, "authored">): number | null {
	if (!lesson.authored) return null;
	let total = 0;
	for (const run of lesson.authored.usage) {
		for (const step of run.steps) {
			const cost = callCost(
				{
					...(step.inputTokens !== undefined ? { inputTokens: step.inputTokens } : {}),
					...(step.outputTokens !== undefined ? { outputTokens: step.outputTokens } : {}),
					...(step.cacheReadTokens !== undefined ? { cacheReadTokens: step.cacheReadTokens } : {}),
					...(step.cacheWriteTokens !== undefined ? { cacheWriteTokens: step.cacheWriteTokens } : {}),
				},
				run.model,
			);
			if (cost === null) return null;
			total += cost;
		}
	}
	return total;
}
