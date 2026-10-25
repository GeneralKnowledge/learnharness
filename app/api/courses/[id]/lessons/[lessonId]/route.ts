import { deleteCourseLesson, updateCourseLessonDetails } from "@/src/server";

/** Rename a lesson or set its section or brief: { title?, section?, brief? }
 *  — an empty section or brief clears it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const body = (await req.json().catch(() => null)) as { title?: unknown; section?: unknown; brief?: unknown } | null;
	if (body?.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	for (const field of ["section", "brief"] as const) {
		if (body?.[field] !== undefined && typeof body[field] !== "string") {
			return Response.json({ error: `${field} must be a string` }, { status: 400 });
		}
	}
	const lesson = updateCourseLessonDetails(id, lessonId, {
		title: body?.title as string | undefined,
		section: body?.section as string | undefined,
		brief: body?.brief as string | undefined,
	});
	if (!lesson) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ title: lesson.title, section: lesson.section ?? "", brief: lesson.brief ?? "" });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const course = deleteCourseLesson(id, lessonId);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ lessons: course.lessons.length });
}
