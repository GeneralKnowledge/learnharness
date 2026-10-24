import { courseLessonFromChat, removeCourseLesson, upsertCourseLesson } from "../core/course.ts";
import type { CourseLesson, CourseRecord } from "../core/contracts.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/**
 * Server-side course entries (course-engine wave, owner 2026-10-24) for
 * app/api/courses* and the /courses reader pages. Publishing is the one
 * orchestration: read the session, project it (core/course.ts), and upsert
 * the lesson into a new or existing course. Re-publishing a session
 * replaces its lesson in place, so a course follows its sessions as they
 * grow.
 */

export const { getCourse, listCourses } = stores.courseStore;

export type PublishOutcome =
	| { ok: false; status: 400 | 404 | 409; error: string }
	| { ok: true; course: CourseRecord; lesson: CourseLesson; replaced: boolean };

export function publishChatToCourse(input: {
	chatId: string;
	/** Publish into this course; absent = create a new one. */
	courseId?: string;
	/** The new course's title (only with no courseId; defaults to the session title). */
	courseTitle?: string;
	/** The lesson title (defaults to the session title). */
	lessonTitle?: string;
}): PublishOutcome {
	const chat = stores.chatStore.getChat(input.chatId);
	if (!chat) return { ok: false, status: 404, error: "Session not found" };
	// The record is mid-write while a turn runs; publish what has settled.
	if (isTurnRunning(chat.id)) return { ok: false, status: 409, error: "Wait for the current turn to finish, then publish." };

	const existing = input.courseId ? stores.courseStore.getCourse(input.courseId) : null;
	if (input.courseId && !existing) return { ok: false, status: 404, error: "Course not found" };

	const now = new Date().toISOString();
	const lesson = courseLessonFromChat(chat, {
		id: `lesson_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		now,
		title: input.lessonTitle,
	});
	if (lesson.blocks.length === 0) {
		return { ok: false, status: 400, error: "This session has no teaching material to publish yet." };
	}

	const course = existing ?? stores.courseStore.createCourse(input.courseTitle?.trim() || chat.title);
	const replaced = course.lessons.some((l) => l.sourceChatId === chat.id);
	const next = upsertCourseLesson(course, lesson, now);
	stores.courseStore.saveCourse(next);
	const stored = next.lessons.find((l) => l.sourceChatId === chat.id) ?? lesson;
	return { ok: true, course: next, lesson: stored, replaced };
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

export function deleteCourse(id: string): boolean {
	return stores.courseStore.deleteCourse(id);
}
