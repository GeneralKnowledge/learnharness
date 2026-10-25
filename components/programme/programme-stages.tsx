"use client";

import { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { readDone } from "@/components/course/course-progress";

/**
 * A programme's stages and modules for a reader (programme wave,
 * 2026-10-25), with this browser's progress read from the same per-course
 * store the lesson pages write. Prerequisites are advice, not locks: a
 * module whose requirements aren't finished says so and stays open.
 */

export interface StageModule {
	courseId: string;
	title: string;
	description?: string;
	/** Written lessons only. */
	lessonIds: string[];
	/** Lessons planned but not written yet. */
	planned: number;
	credits?: number;
	optional: boolean;
	requires: Array<{ courseId: string; title: string }>;
}

export interface Stage {
	id: string;
	title: string;
	description?: string;
	credits: number;
	modules: StageModule[];
}

/** Lessons done per course, for the given modules. */
function useModuleProgress(modules: readonly StageModule[]): Map<string, number> {
	const [done, setDone] = useState(new Map<string, number>());
	const key = modules.map((m) => m.courseId).join(",");
	useEffect(() => {
		const next = new Map<string, number>();
		for (const m of modules) {
			const ids = new Set(m.lessonIds);
			next.set(m.courseId, readDone(m.courseId).filter((id) => ids.has(id)).length);
		}
		setDone(next);
		// Keyed on the module ids: `modules` is a fresh array every render.
	}, [key]);
	return done;
}

export function ProgrammeStages({ stages }: { stages: readonly Stage[] }) {
	const all = stages.flatMap((s) => s.modules);
	const done = useModuleProgress(all);
	const finished = (m: StageModule) => m.lessonIds.length > 0 && (done.get(m.courseId) ?? 0) >= m.lessonIds.length;
	const finishedIds = new Set(all.filter(finished).map((m) => m.courseId));

	return (
		<div className="flex flex-col gap-10" data-testid="programme-stages">
			{stages.map((stage) => {
				const complete = stage.modules.filter(finished).length;
				return (
					<section key={stage.id} data-testid="programme-stage">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h2 className="font-title text-2xl tracking-tight text-foreground">{stage.title}</h2>
							<span className="text-xs uppercase tracking-wider text-muted-foreground">
								{complete} of {stage.modules.length} modules done
								{stage.credits > 0 && <> · {stage.credits} credits</>}
							</span>
						</div>
						{stage.description && <p className="mt-1.5 font-sans text-base text-muted-foreground">{stage.description}</p>}
						<ul className="mt-4 flex flex-col gap-2">
							{stage.modules.map((m) => {
								const lessons = m.lessonIds.length;
								const read = done.get(m.courseId) ?? 0;
								const waiting = m.requires.filter((r) => !finishedIds.has(r.courseId));
								const body = (
									<>
										<div className="flex items-start gap-3">
											<div className="min-w-0 flex-1">
												<div className="font-sans text-lg text-foreground">{m.title}</div>
												{m.description && <p className="mt-0.5 font-sans text-sm text-muted-foreground">{m.description}</p>}
											</div>
											{finished(m) && <CheckIcon className="mt-1 size-4 shrink-0 text-emerald-500" aria-label="Done" />}
										</div>
										<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase tracking-wider text-muted-foreground">
											<span>{lessons === 0 ? "Coming soon" : `${read} of ${lessons} lessons`}</span>
											{lessons > 0 && m.planned > 0 && <span>{m.planned} more coming</span>}
											{m.credits !== undefined && <span>{m.credits} credits</span>}
											{m.optional && <span>Optional</span>}
										</div>
										{m.requires.length > 0 && (
											<p className="mt-1.5 text-xs text-muted-foreground">
												{waiting.length === 0 ? "Builds on " : "Finish first: "}
												{(waiting.length === 0 ? m.requires : waiting).map((r) => r.title).join(", ")}
											</p>
										)}
									</>
								);
								return (
									<li key={m.courseId} data-testid="programme-module">
										{lessons === 0 ? (
											<div className="rounded-xl border border-dashed p-4 opacity-70">{body}</div>
										) : (
											<a href={`/courses/${m.courseId}`} className="block rounded-xl border p-4 transition-colors hover:bg-accent">
												{body}
											</a>
										)}
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
