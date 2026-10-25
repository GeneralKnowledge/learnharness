/**
 * Session → course lesson — the pure projection behind "Publish to course"
 * (course-engine wave, owner 2026-10-24).
 *
 * A teaching session is one learner's conversation; a lesson is the part of
 * it that every later reader can reuse. The projection keeps what the
 * TEACHER authored and drops everything the learner said:
 *
 * - teach sessions start at the plan (the first plan-block marker) — the
 *   probe before it measured one learner and teaches nothing reusable; a
 *   session without a plan is kept whole;
 * - assistant text → text blocks (consecutive parts merge into one);
 * - quiz/probe → choice questions, explain/recall → recall questions, with
 *   the answers the teacher COMMITTED at pose time (never the learner's);
 * - delivered visuals and demos (subagent-steer markers) → figure / demo;
 * - practice sessions keep only their problems and model solutions — the
 *   hints between them answer one learner's attempts.
 *
 * A call whose result came back as an error was never posed and is dropped.
 * Pure and deterministic: same record in, same blocks out.
 */

import type { ChatRecord, PlanBlockData } from "./contracts/chat.ts";
import type { DemoResult, SteerDetails, VisualResult } from "./contracts/jobs.ts";
import type { CourseBlock, CourseLesson, CourseQuestionOption, CourseRecord, CourseSummary } from "./contracts/course.ts";
import { PRACTICE_PROBLEM_TOOL, type LhMessage } from "./native-messages.ts";

const CHOICE_TOOLS = new Set(["quiz", "probe"]);
const RECALL_TOOLS = new Set(["explain", "recall"]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Options as authored — tolerating the JSON-string encoding some models
 *  send (the same heal the question tools apply at call time). */
function optionsOf(raw: unknown): CourseQuestionOption[] {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return value
		.map((o) => ({ label: str((o as { label?: unknown })?.label), value: str((o as { value?: unknown })?.value) }))
		.filter((o) => o.label.length > 0 && o.value.length > 0);
}

/** correctAnswer → option values (a label is accepted, like the grader does). */
function correctValues(raw: unknown, options: readonly CourseQuestionOption[]): string[] {
	const entries = (Array.isArray(raw) ? raw : [raw]).map(str).filter((s) => s.length > 0);
	const out: string[] = [];
	for (const entry of entries) {
		const match = options.find((o) => o.value === entry) ?? options.find((o) => o.label === entry);
		if (match && !out.includes(match.value)) out.push(match.value);
	}
	return out;
}

/** A quiz/probe call's arguments as a choice block (null when ungradeable). */
export function choiceBlock(args: Record<string, unknown>): CourseBlock | null {
	const question = str(args.question);
	const options = optionsOf(args.options);
	const correct = correctValues(args.correctAnswer, options);
	if (!question || options.length < 2 || correct.length === 0) return null;
	const explanation = str(args.explanation);
	const role = str(args.type);
	return {
		kind: "choice",
		question,
		options,
		correct,
		multiSelect: args.multiSelect === true || correct.length > 1,
		...(explanation ? { explanation } : {}),
		...(role ? { role } : {}),
	};
}

/** An explain/recall call's arguments as a recall block. */
export function recallBlock(args: Record<string, unknown>): CourseBlock | null {
	const question = str(args.question);
	const answer = str(args.correctAnswer);
	if (!question || !answer) return null;
	const role = str(args.type);
	return { kind: "recall", question, answer, ...(role ? { role } : {}) };
}

function problemBlock(args: Record<string, unknown>): CourseBlock | null {
	const statement = str(args.statement);
	const solution = str(args.modelSolution);
	if (!statement || !solution) return null;
	return { kind: "problem", statement, solution };
}

/** A delivered visual or demo — failures (empty svg/html) render nothing. */
function artifactBlock(details: unknown): CourseBlock | null {
	const d = details as Partial<SteerDetails> | undefined;
	if (!d || d.aborted || !d.result) return null;
	if (d.kind === "visual") {
		const svg = (d.result as VisualResult).svg;
		return typeof svg === "string" && svg.length > 0 ? { kind: "visual", svg } : null;
	}
	if (d.kind === "demo") {
		const r = d.result as DemoResult;
		return typeof r.html === "string" && r.html.length > 0 ? { kind: "demo", title: str(r.title) || "Demo", html: r.html } : null;
	}
	return null;
}

/** The plan map as a reader sees it: no learner position, every node upcoming. */
function planBlock(details: unknown): CourseBlock | null {
	const d = details as Partial<PlanBlockData> | undefined;
	if (!d || !Array.isArray(d.nodes) || d.nodes.length === 0 || !Array.isArray(d.edges)) return null;
	return {
		kind: "plan",
		data: {
			kind: "full",
			at: str(d.at),
			current: null,
			nodes: d.nodes.map((n) => ({ id: n.id, title: n.title, status: "upcoming" as const })),
			edges: d.edges.map((e) => ({ from: e.from, to: e.to })),
		},
	};
}

/** The lesson material of one session, in reading order. */
export function courseBlocksFromMessages(messages: readonly LhMessage[], kind: "teach" | "practice" = "teach"): CourseBlock[] {
	const failed = new Set<string>();
	for (const m of messages) {
		if (m.role === "toolResult" && m.isError) failed.add(m.toolCallId);
	}
	const firstPlan = messages.findIndex((m) => m.role === "custom" && m.customType === "plan-block");
	const start = kind === "teach" && firstPlan >= 0 ? firstPlan : 0;

	const blocks: CourseBlock[] = [];
	const push = (block: CourseBlock | null) => {
		if (!block) return;
		const last = blocks.at(-1);
		if (block.kind === "text" && last?.kind === "text") {
			last.markdown = `${last.markdown}\n\n${block.markdown}`;
			return;
		}
		blocks.push(block);
	};

	for (const m of messages.slice(start)) {
		if (m.role === "custom") {
			if (kind === "practice") continue;
			if (m.customType === "plan-block") push(planBlock(m.details));
			else if (m.customType === "subagent-steer") push(artifactBlock(m.details));
			continue;
		}
		if (m.role !== "assistant") continue;
		for (const part of m.content) {
			if (part.type === "text") {
				if (kind === "teach" && part.text.trim()) push({ kind: "text", markdown: part.text.trim() });
				continue;
			}
			if (part.type !== "toolCall" || failed.has(part.id)) continue;
			const args = (part.arguments ?? {}) as Record<string, unknown>;
			if (kind === "practice") {
				if (part.name === PRACTICE_PROBLEM_TOOL) push(problemBlock(args));
				continue;
			}
			if (CHOICE_TOOLS.has(part.name)) push(choiceBlock(args));
			else if (RECALL_TOOLS.has(part.name)) push(recallBlock(args));
		}
	}
	return blocks;
}

/** One session as a lesson. `id`/`now` are injected so the projection stays pure. */
export function courseLessonFromChat(
	chat: ChatRecord,
	opts: { id: string; now: string; title?: string },
): CourseLesson {
	return {
		id: opts.id,
		title: str(opts.title) || chat.title,
		sourceChatId: chat.id,
		publishedAt: opts.now,
		blocks: courseBlocksFromMessages(chat.messages, chat.kind ?? "teach"),
	};
}

/** Add a lesson, or replace the one published from the same session in place
 *  (keeping its id, position and section, so reader links and progress
 *  survive and an author's ordering is never undone by a re-publish).
 *  A session not yet in the course may instead fill a PLANNED lesson
 *  (`intoLessonId`), which keeps that lesson's id, place, section and brief. */
export function upsertCourseLesson(course: CourseRecord, lesson: CourseLesson, now: string, intoLessonId?: string): CourseRecord {
	let idx = course.lessons.findIndex((l) => l.sourceChatId === lesson.sourceChatId);
	if (idx < 0 && intoLessonId) idx = course.lessons.findIndex((l) => l.id === intoLessonId && isPlannedLesson(l));
	const keep = (l: CourseLesson): CourseLesson => {
		const { status: _, ...written } = lesson;
		return {
			...written,
			id: l.id,
			...(l.section ? { section: l.section } : {}),
			...(l.brief && !lesson.brief ? { brief: l.brief } : {}),
		};
	};
	const lessons = idx < 0 ? [...course.lessons, lesson] : course.lessons.map((l, i) => (i === idx ? keep(l) : l));
	return { ...course, lessons, updatedAt: now };
}

/** A lesson that is only planned: a title and brief, nothing to read yet. */
export function isPlannedLesson(lesson: Pick<CourseLesson, "status">): boolean {
	return lesson.status === "planned";
}

/** Plan lessons at the end of a course (ids injected). Blank titles are skipped. */
export function addPlannedLessons(
	course: CourseRecord,
	items: ReadonlyArray<{ id: string; title: string; brief?: string; section?: string }>,
	now: string,
): CourseRecord {
	const planned: CourseLesson[] = items
		.map((item) => ({ ...item, title: str(item.title), brief: str(item.brief), section: str(item.section) }))
		.filter((item) => item.title)
		.map((item) => ({
			id: item.id,
			title: item.title,
			sourceChatId: "",
			publishedAt: now,
			status: "planned" as const,
			...(item.brief ? { brief: item.brief } : {}),
			...(item.section ? { section: item.section } : {}),
			blocks: [],
		}));
	if (planned.length === 0) return course;
	return { ...course, lessons: [...course.lessons, ...planned], updatedAt: now };
}

/** Drop one lesson; the course is returned unchanged when the id is unknown. */
export function removeCourseLesson(course: CourseRecord, lessonId: string, now: string): CourseRecord {
	if (!course.lessons.some((l) => l.id === lessonId)) return course;
	return { ...course, lessons: course.lessons.filter((l) => l.id !== lessonId), updatedAt: now };
}

/** Put the lessons in the given order. Null unless `lessonIds` names every
 *  lesson exactly once — a reorder never adds or loses a lesson. */
export function reorderCourseLessons(course: CourseRecord, lessonIds: readonly string[], now: string): CourseRecord | null {
	if (lessonIds.length !== course.lessons.length || new Set(lessonIds).size !== lessonIds.length) return null;
	const byId = new Map(course.lessons.map((l) => [l.id, l]));
	const lessons = lessonIds.map((id) => byId.get(id));
	if (lessons.some((l) => l === undefined)) return null;
	return { ...course, lessons: lessons as CourseLesson[], updatedAt: now };
}

/** Rename a lesson or set its section heading or brief (empty clears).
 *  The course is returned unchanged when the lesson id is unknown. */
export function updateCourseLesson(
	course: CourseRecord,
	lessonId: string,
	patch: { title?: string; section?: string; brief?: string },
	now: string,
): CourseRecord {
	if (!course.lessons.some((l) => l.id === lessonId)) return course;
	const title = str(patch.title);
	const lessons = course.lessons.map((l) => {
		if (l.id !== lessonId) return l;
		const next: CourseLesson = { ...l, ...(title ? { title } : {}) };
		if (patch.section !== undefined) {
			const section = str(patch.section);
			if (section) next.section = section;
			else delete next.section;
		}
		if (patch.brief !== undefined) {
			const brief = str(patch.brief);
			if (brief) next.brief = brief;
			else delete next.brief;
		}
		return next;
	});
	return { ...course, lessons, updatedAt: now };
}

/** Lessons grouped for display: each run of consecutive lessons sharing a
 *  section is one group (a section may recur later as its own group).
 *  `number` is the lesson's 1-based place in the whole course. */
export function courseSections<L extends { section?: string }>(
	lessons: readonly L[],
): Array<{ section: string | null; lessons: Array<L & { number: number }> }> {
	const groups: Array<{ section: string | null; lessons: Array<L & { number: number }> }> = [];
	lessons.forEach((lesson, i) => {
		const section = lesson.section ?? null;
		const last = groups.at(-1);
		if (last && last.section === section) last.lessons.push({ ...lesson, number: i + 1 });
		else groups.push({ section, lessons: [{ ...lesson, number: i + 1 }] });
	});
	return groups;
}

export function courseSummary(course: CourseRecord): CourseSummary {
	return {
		id: course.id,
		title: course.title,
		...(course.description ? { description: course.description } : {}),
		createdAt: course.createdAt,
		updatedAt: course.updatedAt,
		lessons: course.lessons.map((l) => ({
			id: l.id,
			title: l.title,
			...(l.section ? { section: l.section } : {}),
			...(isPlannedLesson(l) ? { planned: true as const } : {}),
		})),
	};
}

/** Grade a choice selection: right only when it is exactly the correct set. */
export function isChoiceCorrect(selected: readonly string[], correct: readonly string[]): boolean {
	return selected.length === correct.length && correct.every((v) => selected.includes(v));
}
