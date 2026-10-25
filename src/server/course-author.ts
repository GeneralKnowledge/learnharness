import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { runLessonAuthor, type AuthorRunDeps } from "../agent/author-agent.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { authorBlocksFromMessages, authorContextFor, authorLessonPrompt, canAuthorLesson, fillAuthoredLesson } from "../core/course-author.ts";
import type { CallUsage, CourseRecord } from "../core/contracts.ts";
import { programmeModules } from "../core/programme.ts";
import { resolveConversationSpec, resolveRoleSpec } from "../core/settings-resolution.ts";
import { providerKeyPresent } from "./keys.ts";
import { effectiveSettings, stores } from "./stores.ts";

/**
 * The author queue (author wave, owner 2026-10-25): write a course's
 * planned lessons with the author agent, one lesson at a time, in the
 * background. Each run reads the lesson's place in its course and
 * programme, writes the lesson (src/agent/author-agent.ts), projects it
 * (core/course-author.ts), and stores it in place — re-reading the course
 * after the slow run, so edits made meanwhile are kept.
 *
 * Status lives in memory: a lesson is queued, being written, or failed
 * (with the reason); a written lesson simply stops being planned. A
 * restart drops the queue, never a stored lesson.
 */

export type AuthoringState = { state: "queued" | "writing" } | { state: "failed"; error: string };

const status = new Map<string, AuthoringState>();
const queue: Array<{ courseId: string; lessonId: string }> = [];
let pumping = false;
const keyOf = (courseId: string, lessonId: string) => `${courseId}/${lessonId}`;

/** Engines for one run. Injectable for tests. */
export type AuthorEngines = Pick<AuthorRunDeps, "engine" | "visualEngine" | "demoEngine" | "headless">;
let enginesOverride: (() => AuthorEngines | string) | null = null;

/** Test seam: replace the settings-resolved engines (null restores them). */
export function setAuthorEnginesForTests(fn: (() => AuthorEngines | string) | null): void {
	enginesOverride = fn;
}

/** The author's engines from settings: the conversation model writes, the
 *  figure and demo roles build. A reason string when the author can't run;
 *  a builder without a model or key just leaves its tool out. */
function resolveAuthorEngines(): AuthorEngines | string {
	if (enginesOverride) return enginesOverride();
	const settings = stores.settingsStore.readSettings();
	const spec = resolveConversationSpec(undefined, effectiveSettings().models.strong);
	if (!spec) return "No conversation model is set up. Choose one in Settings first.";
	if (!providerKeyPresent(spec.provider)) return `No API key for ${spec.provider}. Add one in Settings first.`;
	const builder = (role: "visualMaker" | "demoBuilder"): PiEngine | undefined => {
		const s = resolveRoleSpec(role, settings);
		return s && providerKeyPresent(s.provider) ? piEngineForSpec(s) : undefined;
	};
	const visualEngine = builder("visualMaker");
	const demoEngine = builder("demoBuilder");
	return { engine: piEngineForSpec(spec), ...(visualEngine ? { visualEngine } : {}), ...(demoEngine ? { demoEngine } : {}) };
}

/** The first programme that lists this course, as the brief needs it. */
function programmeContext(courseId: string) {
	for (const summary of stores.programmeStore.listProgrammes()) {
		const programme = stores.programmeStore.getProgramme(summary.id);
		const entry = programme && programmeModules(programme).find((m) => m.courseId === courseId);
		if (!programme || !entry) continue;
		const requires = (entry.requires ?? [])
			.map((id) => stores.courseStore.getCourse(id)?.title)
			.filter((t): t is string => typeof t === "string");
		return {
			title: programme.title,
			...(programme.description ? { description: programme.description } : {}),
			...(programme.audience ? { audience: programme.audience } : {}),
			requires,
		};
	}
	return undefined;
}

export type AuthorOutcome = { ok: true; course: CourseRecord; blocks: number } | { ok: false; error: string };

/** Write one lesson now and store it. Used by the queue; exported for tests. */
export async function authorLesson(courseId: string, lessonId: string, engines?: AuthorEngines): Promise<AuthorOutcome> {
	const course = stores.courseStore.getCourse(courseId);
	const lesson = course?.lessons.find((l) => l.id === lessonId);
	if (!course || !lesson) return { ok: false, error: "The lesson no longer exists." };
	if (!canAuthorLesson(lesson)) return { ok: false, error: "This lesson was published from a session; the author only writes planned lessons." };
	const resolved = engines ?? resolveAuthorEngines();
	if (typeof resolved === "string") return { ok: false, error: resolved };

	const usage = new Map<string, CallUsage[]>();
	let messages: AgentMessage[];
	try {
		const prompt = authorLessonPrompt(authorContextFor(course, lessonId, programmeContext(courseId))!);
		messages = await runLessonAuthor(prompt, {
			...resolved,
			onUsage: (model, step) => usage.set(model, [...(usage.get(model) ?? []), step]),
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error(`[author ${courseId}/${lessonId}] run failed:`, reason);
		return { ok: false, error: `The author agent failed: ${reason}` };
	}
	const blocks = authorBlocksFromMessages(messages);
	if (blocks.length === 0) return { ok: false, error: "The author agent wrote nothing for this lesson." };

	// Re-read after the slow run: renames, reorders and other lessons
	// written meanwhile are kept.
	const fresh = stores.courseStore.getCourse(courseId);
	if (!fresh) return { ok: false, error: "The course was deleted while the lesson was being written." };
	const runs = [...usage].map(([model, steps]) => ({ model, steps }));
	const next = fillAuthoredLesson(fresh, lessonId, blocks, runs, new Date().toISOString());
	if (next === fresh) return { ok: false, error: "The lesson was removed or published from a session while it was being written." };
	stores.courseStore.saveCourse(next);
	return { ok: true, course: next, blocks: blocks.length };
}

async function pump(): Promise<void> {
	if (pumping) return;
	pumping = true;
	try {
		for (let job = queue.shift(); job; job = queue.shift()) {
			const key = keyOf(job.courseId, job.lessonId);
			status.set(key, { state: "writing" });
			const outcome = await authorLesson(job.courseId, job.lessonId);
			if (outcome.ok) status.delete(key);
			else status.set(key, { state: "failed", error: outcome.error });
		}
	} finally {
		pumping = false;
	}
}

export type QueueOutcome = { ok: true; queued: number } | { ok: false; status: 400 | 404 | 503; error: string };

/**
 * Queue lessons of a course for the author agent: the given ids, or every
 * planned lesson. Lessons already queued or being written are skipped; a
 * lesson published from a session is refused.
 */
export function queueCourseAuthoring(courseId: string, lessonIds?: readonly string[]): QueueOutcome {
	const course = stores.courseStore.getCourse(courseId);
	if (!course) return { ok: false, status: 404, error: "Course not found" };
	const engines = resolveAuthorEngines();
	if (typeof engines === "string") return { ok: false, status: 503, error: engines };
	const targets = lessonIds
		? lessonIds.map((id) => course.lessons.find((l) => l.id === id))
		: course.lessons.filter((l) => l.status === "planned");
	if (targets.some((l) => l === undefined)) return { ok: false, status: 400, error: "Unknown lesson id" };
	if (targets.some((l) => !canAuthorLesson(l!))) {
		return { ok: false, status: 400, error: "Only planned lessons, or lessons the author wrote, can be written by the author agent." };
	}
	let queued = 0;
	for (const lesson of targets) {
		const key = keyOf(courseId, lesson!.id);
		const current = status.get(key);
		if (current && current.state !== "failed") continue;
		status.set(key, { state: "queued" });
		queue.push({ courseId, lessonId: lesson!.id });
		queued++;
	}
	void pump();
	return { ok: true, queued };
}

/** Each lesson of the course that is queued, being written, or failed. */
export function courseAuthoringStatus(courseId: string): Record<string, AuthoringState> {
	const out: Record<string, AuthoringState> = {};
	const prefix = `${courseId}/`;
	for (const [key, value] of status) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
	return out;
}
