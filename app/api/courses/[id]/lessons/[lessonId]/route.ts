import { deleteCourseLesson } from "@/src/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const course = deleteCourseLesson(id, lessonId);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ lessons: course.lessons.length });
}
