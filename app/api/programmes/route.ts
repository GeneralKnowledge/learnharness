import { createProgrammeFromOutline, listProgrammes } from "@/src/server";

/** The programme list (programme wave, 2026-10-25). */
export async function GET() {
	return Response.json({ programmes: listProgrammes() });
}

/**
 * Create a programme from one outline (docs/courses.md "Programmes"):
 * { title, description?, stages: [{ title, modules: [{ title, key?,
 * courseId?, credits?, optional?, requires? }] }] }. Modules without a
 * courseId become new, empty courses.
 */
export async function POST(req: Request) {
	const body = await req.json().catch(() => undefined);
	if (body === undefined) return Response.json({ error: "The body must be JSON" }, { status: 400 });
	const outcome = createProgrammeFromOutline(body);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
	return Response.json({ programmeId: outcome.programme.id, createdCourses: outcome.createdCourses });
}
