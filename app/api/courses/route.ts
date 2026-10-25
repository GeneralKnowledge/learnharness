import { listCourses, publishChatToCourse } from "@/src/server";

/** The course library (course-engine wave, 2026-10-24): summaries only —
 *  the reader pages read whole courses server-side. */
export async function GET() {
	return Response.json({ courses: listCourses() });
}

/**
 * Publish a session as a lesson: { chatId, courseId?, courseTitle?,
 * lessonTitle?, intoLessonId?, cleanup? }. No courseId creates a new course;
 * re-publishing a session already in the course replaces its lesson in
 * place; intoLessonId fills that planned lesson of the course. The wording
 * cleanup pass runs unless cleanup is false.
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
	const chatId = text(body?.chatId);
	if (!chatId) return Response.json({ error: "chatId must be a non-empty string" }, { status: 400 });
	const outcome = await publishChatToCourse({
		chatId,
		courseId: text(body?.courseId),
		courseTitle: text(body?.courseTitle),
		lessonTitle: text(body?.lessonTitle),
		intoLessonId: text(body?.intoLessonId),
		cleanup: body?.cleanup !== false,
	});
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return Response.json({
		courseId: outcome.course.id,
		courseTitle: outcome.course.title,
		lessonId: outcome.lesson.id,
		blocks: outcome.lesson.blocks.length,
		replaced: outcome.replaced,
		cleanup: outcome.cleanup,
	});
}
