import {
	courseLessonFromChat,
	removeCourseLesson,
	reorderCourseLessons,
	updateCourseLesson,
	upsertCourseLesson,
} from "../core/course.ts";
import { removeProgrammeCourse } from "../core/programme.ts";
import {
	applyCleanup,
	batchSegments,
	buildCleanupPrompt,
	cleanupSegments,
	CLEANUP_SYSTEM_PROMPT,
	parseCleanupReply,
} from "../core/course-cleanup.ts";
import type { CleanupOutcome, CourseBlock, CourseLesson, CourseRecord } from "../core/contracts.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { providerKeyPresent } from "./keys.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/**
 * Server-side course entries (course-engine wave, owner 2026-10-24) for
 * app/api/courses* and the /courses reader pages. Publishing is the one
 * orchestration: read the session, project it (core/course.ts), and upsert
 * the lesson into a new or existing course. Re-publishing a session
 * replaces its lesson in place, so a course follows its sessions as they
 * grow.
 *
 * The cleanup pass (wave 2, owner 2026-10-25) sits between projection and
 * upsert: the session's own conversation model rewrites learner-specific
 * wording into course wording (core/course-cleanup.ts). It never blocks a
 * publish — when it cannot run, the lesson is stored as projected and the
 * outcome says why, so the dialog can tell the author.
 */

/** One rewrite call: prompt in, reply text out. Injectable for tests. */
export type CleanupRewriter = (prompt: string) => Promise<string>;


export const { getCourse, listCourses } = stores.courseStore;

export type PublishOutcome =
	| { ok: false; status: 400 | 404 | 409; error: string }
	| { ok: true; course: CourseRecord; lesson: CourseLesson; replaced: boolean; cleanup: CleanupOutcome };

/** The production rewriter: the chat's conversation model (as compaction
 *  uses it), one zero-tool turn. Null + reason when it cannot run. */
function conversationRewriter(chatSettings: Parameters<typeof resolveConversationSpec>[0]): CleanupRewriter | string {
	const spec = resolveConversationSpec(chatSettings, effectiveSettings().models.strong);
	if (!spec) return "No conversation model is set up, so the wording was published as it was.";
	if (!providerKeyPresent(spec.provider)) {
		return `No API key for ${spec.provider}, so the wording was published as it was.`;
	}
	const engine = piEngineForSpec(spec);
	return async (prompt) => {
		const { text } = await runSubagent([], {
			// The engine override is always present, so the role label never
			// resolves an engine (compaction's precedent for one-shot text jobs).
			role: "researcher" as never,
			prompt,
			engine,
			systemPrompt: CLEANUP_SYSTEM_PROMPT,
			maxTurns: 1,
		});
		return text;
	};
}

/** Run the cleanup over a lesson's blocks, one call per batch. */
async function cleanBlocks(
	blocks: CourseBlock[],
	rewrite: CleanupRewriter,
): Promise<{ blocks: CourseBlock[]; cleanup: CleanupOutcome }> {
	const segments = cleanupSegments(blocks);
	if (segments.length === 0) return { blocks, cleanup: { status: "done", rewritten: 0, dropped: 0, refused: 0 } };
	try {
		const replies = await Promise.all(batchSegments(segments).map((batch) => rewrite(buildCleanupPrompt(batch))));
		const rewrites = new Map<string, string>();
		for (const reply of replies) for (const [id, text] of parseCleanupReply(reply)) rewrites.set(id, text);
		const result = applyCleanup(blocks, segments, rewrites);
		return {
			blocks: result.blocks,
			cleanup: { status: "done", rewritten: result.rewritten, dropped: result.dropped, refused: result.refused },
		};
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error("[courses] cleanup failed:", reason);
		return { blocks, cleanup: { status: "failed", error: `The cleanup pass failed (${reason}), so the wording was published as it was.` } };
	}
}

export async function publishChatToCourse(
	input: {
	chatId: string;
	/** Publish into this course; absent = create a new one. */
	courseId?: string;
	/** The new course's title (only with no courseId; defaults to the session title). */
	courseTitle?: string;
	/** The lesson title (defaults to the session title). */
	lessonTitle?: string;
	/** Rewrite learner-specific wording before storing (default off here;
	 *  the route turns it on unless the dialog opts out). */
	cleanup?: boolean;
	},
	deps: { rewrite?: CleanupRewriter } = {},
): Promise<PublishOutcome> {
	const chat = stores.chatStore.getChat(input.chatId);
	if (!chat) return { ok: false, status: 404, error: "Session not found" };
	// The record is mid-write while a turn runs; publish what has settled.
	if (isTurnRunning(chat.id)) return { ok: false, status: 409, error: "Wait for the current turn to finish, then publish." };

	if (input.courseId && !stores.courseStore.getCourse(input.courseId)) {
		return { ok: false, status: 404, error: "Course not found" };
	}

	const now = new Date().toISOString();
	const lesson = courseLessonFromChat(chat, {
		id: `lesson_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		now,
		title: input.lessonTitle,
	});
	if (lesson.blocks.length === 0) {
		return { ok: false, status: 400, error: "This session has no teaching material to publish yet." };
	}

	let cleanup: CleanupOutcome = { status: "off" };
	if (input.cleanup) {
		const rewrite = deps.rewrite ?? conversationRewriter(chat.settings);
		if (typeof rewrite === "string") cleanup = { status: "failed", error: rewrite };
		else ({ blocks: lesson.blocks, cleanup } = await cleanBlocks(lesson.blocks, rewrite));
	}

	// Re-read the course AFTER the (slow) cleanup, so a publish that landed
	// meanwhile is not overwritten.
	const existing = input.courseId ? stores.courseStore.getCourse(input.courseId) : null;
	if (input.courseId && !existing) return { ok: false, status: 404, error: "Course not found" };
	const course = existing ?? stores.courseStore.createCourse(input.courseTitle?.trim() || chat.title);
	const replaced = course.lessons.some((l) => l.sourceChatId === chat.id);
	const next = upsertCourseLesson(course, lesson, now);
	stores.courseStore.saveCourse(next);
	const stored = next.lessons.find((l) => l.sourceChatId === chat.id) ?? lesson;
	return { ok: true, course: next, lesson: stored, replaced, cleanup };
}

/** Rename a course or set its description. Null when the id is unknown. */
export function updateCourseDetails(id: string, patch: { title?: string; description?: string }): CourseRecord | null {
	const course = stores.courseStore.getCourse(id);
	if (!course) return null;
	const title = patch.title?.trim();
	const description = patch.description?.trim();
	const next: CourseRecord = {
		...course,
		...(title ? { title } : {}),
		...(description !== undefined ? { description } : {}),
		updatedAt: new Date().toISOString(),
	};
	if (next.description === "") delete next.description;
	stores.courseStore.saveCourse(next);
	return next;
}

/** Remove one lesson. Null when the course is unknown; the unchanged course
 *  when the lesson is. */
export function deleteCourseLesson(courseId: string, lessonId: string): CourseRecord | null {
	const course = stores.courseStore.getCourse(courseId);
	if (!course) return null;
	const next = removeCourseLesson(course, lessonId, new Date().toISOString());
	if (next !== course) stores.courseStore.saveCourse(next);
	return next;
}

/** Put a course's lessons in a new order (every lesson, once). Null when
 *  the course is unknown; "invalid" when the ids are not a reordering. */
export function reorderCourse(courseId: string, lessonIds: readonly string[]): CourseRecord | null | "invalid" {
	const course = stores.courseStore.getCourse(courseId);
	if (!course) return null;
	const next = reorderCourseLessons(course, lessonIds, new Date().toISOString());
	if (!next) return "invalid";
	stores.courseStore.saveCourse(next);
	return next;
}

/** Rename one lesson or set its section. Null when the course or lesson is
 *  unknown. */
export function updateCourseLessonDetails(
	courseId: string,
	lessonId: string,
	patch: { title?: string; section?: string },
): CourseLesson | null {
	const course = stores.courseStore.getCourse(courseId);
	if (!course) return null;
	const next = updateCourseLesson(course, lessonId, patch, new Date().toISOString());
	if (next === course) return null;
	stores.courseStore.saveCourse(next);
	return next.lessons.find((l) => l.id === lessonId) ?? null;
}

/** Delete a course, and take it out of every programme that listed it. */
export function deleteCourse(id: string): boolean {
	if (!stores.courseStore.deleteCourse(id)) return false;
	const now = new Date().toISOString();
	for (const summary of stores.programmeStore.listProgrammes()) {
		const programme = stores.programmeStore.getProgramme(summary.id);
		if (!programme) continue;
		const next = removeProgrammeCourse(programme, id, now);
		if (next !== programme) stores.programmeStore.saveProgramme(next);
	}
	return true;
}
