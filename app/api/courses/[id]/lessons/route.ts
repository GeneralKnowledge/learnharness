import { planCourseLessons } from "@/src/server";

/** Plan lessons at the end of a course: { lessons: [{ title, brief?,
 *  section? }] }. Planned lessons show as "coming soon" until a session is
 *  published into them. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { lessons?: unknown } | null;
	const items = body?.lessons;
	const valid =
		Array.isArray(items) &&
		items.length > 0 &&
		items.every(
			(i) =>
				typeof i === "object" &&
				i !== null &&
				typeof (i as { title?: unknown }).title === "string" &&
				(i as { title: string }).title.trim() !== "" &&
				["brief", "section"].every((f) => (i as Record<string, unknown>)[f] === undefined || typeof (i as Record<string, unknown>)[f] === "string"),
		);
	if (!valid) return Response.json({ error: "lessons must be a list of { title, brief?, section? }" }, { status: 400 });
	const course = planCourseLessons(id, items as Array<{ title: string; brief?: string; section?: string }>);
	if (!course) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ lessons: course.lessons.length });
}
