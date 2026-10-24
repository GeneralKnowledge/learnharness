import { deleteCourse, getCourse, updateCourseDetails } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const course = getCourse(id);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(course);
}

/** Rename / describe: { title?, description? } — an empty description clears it. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { title?: unknown; description?: unknown } | null;
	if (body?.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	if (body?.description !== undefined && typeof body.description !== "string") {
		return Response.json({ error: "description must be a string" }, { status: 400 });
	}
	const course = updateCourseDetails(id, {
		title: body?.title as string | undefined,
		description: body?.description as string | undefined,
	});
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ title: course.title, description: course.description ?? "" });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!deleteCourse(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ ok: true });
}
