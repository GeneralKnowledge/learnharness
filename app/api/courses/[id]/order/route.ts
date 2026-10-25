import { reorderCourse } from "@/src/server";

/** Reorder a course's lessons: { lessonIds } naming every lesson once. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { lessonIds?: unknown } | null;
	const ids = body?.lessonIds;
	if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
		return Response.json({ error: "lessonIds must be a list of lesson ids" }, { status: 400 });
	}
	const course = reorderCourse(id, ids as string[]);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	if (course === "invalid") return Response.json({ error: "lessonIds must name every lesson exactly once" }, { status: 400 });
	return Response.json({ lessonIds: course.lessons.map((l) => l.id) });
}
