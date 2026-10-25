import { courseAuthoringStatus, queueCourseAuthoring } from "@/src/server";

/** Which lessons of the course the author agent has queued, is writing, or
 *  failed on (author wave, 2026-10-25). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return Response.json({ lessons: courseAuthoringStatus(id) });
}

/** Queue lessons for the author agent: { lessonIds? } — absent = every
 *  planned lesson. Runs in the background, one lesson at a time. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { lessonIds?: unknown } | null;
	const ids = body?.lessonIds;
	if (ids !== undefined && (!Array.isArray(ids) || ids.some((v) => typeof v !== "string"))) {
		return Response.json({ error: "lessonIds must be a list of lesson ids" }, { status: 400 });
	}
	const outcome = queueCourseAuthoring(id, ids as string[] | undefined);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return Response.json({ queued: outcome.queued });
}
