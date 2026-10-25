import { deleteProgramme, programmeView, updateProgramme } from "@/src/server";

/** The programme with its courses joined in, and any structure issues. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = programmeView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ programme: view.programme, issues: view.issues });
}

/** Rename, describe, or replace the stages: { title?, description?,
 *  audience?, stages? } — stages is the whole list, as stored. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as {
		title?: unknown;
		description?: unknown;
		audience?: unknown;
		stages?: unknown;
	} | null;
	if (body?.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	for (const field of ["description", "audience"] as const) {
		if (body?.[field] !== undefined && typeof body[field] !== "string") {
			return Response.json({ error: `${field} must be a string` }, { status: 400 });
		}
	}
	const outcome = updateProgramme(id, {
		title: body?.title as string | undefined,
		description: body?.description as string | undefined,
		audience: body?.audience as string | undefined,
		stages: body?.stages,
	});
	if (!outcome) return Response.json({ error: "Not found" }, { status: 404 });
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
	return Response.json({ ok: true });
}

/** Delete the programme. Its courses stay in the library. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!deleteProgramme(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ ok: true });
}
