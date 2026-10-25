import { deleteCourseLesson, updateCourseLessonDetails } from "@/src/server";

/** Rename a lesson or set its section: { title?, section? } — an empty
 *  section clears it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const body = (await req.json().catch(() => null)) as { title?: unknown; section?: unknown } | null;
	if (body?.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	if (body?.section !== undefined && typeof body.section !== "string") {
		return Response.json({ error: "section must be a string" }, { status: 400 });
	}
	const lesson = updateCourseLessonDetails(id, lessonId, {
		title: body?.title as string | undefined,
		section: body?.section as string | undefined,
	});
	if (!lesson) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ title: lesson.title, section: lesson.section ?? "" });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const course = deleteCourseLesson(id, lessonId);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ lessons: course.lessons.length });
}
