import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgrammeStages } from "@/components/programme/programme-stages";
import { ProgrammeAdmin } from "@/components/programme/programme-admin";
import { isReaderMode } from "@/src/core";
import { programmeView } from "@/src/server";

export const dynamic = "force-dynamic";

/** One programme (programme wave, 2026-10-25): its stages and modules, with
 *  credits, prerequisites, and this browser's progress. */
export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = programmeView(id);
	if (!view) notFound();
	const { programme } = view;
	const reader = isReaderMode(process.env);
	// Readers never see a module whose course is gone.
	const stages = view.stages.map((s) => ({ ...s, modules: s.modules.filter((m) => m.course !== null) }));
	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
			<Link href="/courses" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
				Library
			</Link>
			<h1 className="mt-4 font-title text-3xl tracking-tight text-foreground">{programme.title}</h1>
			{programme.description && <p className="mt-3 font-sans text-lg text-muted-foreground">{programme.description}</p>}
			<div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
				{stages.length} {stages.length === 1 ? "stage" : "stages"} ·{" "}
				{stages.reduce((n, s) => n + s.modules.length, 0)} modules
				{view.totalCredits > 0 && <> · {view.totalCredits} credits</>}
			</div>
			{stages.length === 0 ? (
				<p className="mt-8 font-sans text-base text-muted-foreground">This programme has no stages yet.</p>
			) : (
				<div className="mt-10">
					<ProgrammeStages
						stages={stages.map((s) => ({
							...s,
							modules: s.modules.map((m) => ({
								courseId: m.courseId,
								title: m.course!.title,
								...(m.course!.description ? { description: m.course!.description } : {}),
								lessonIds: m.course!.lessons.map((l) => l.id),
								...(m.credits !== undefined ? { credits: m.credits } : {}),
								optional: m.optional,
								requires: m.requires,
							})),
						}))}
					/>
				</div>
			)}
			{!reader && <ProgrammeAdmin view={view} />}
		</main>
	);
}
