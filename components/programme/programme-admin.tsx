"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { ProgrammeIssue, ProgrammeView } from "@/src/core";

/**
 * The studio's programme controls (programme wave, 2026-10-25): the
 * structure issues to fix, rename and describe, and the stage editor —
 * stages in order, the modules in each, their credits, whether they are
 * optional, and what they require. Rendered only outside reader mode; the
 * reader gate refuses the writes anyway (core/reader-gate.ts).
 */

type EditModule = { courseId: string; credits: string; optional: boolean; requires: string[] };
type EditStage = { id: string; title: string; description: string; modules: EditModule[] };

const json = { "Content-Type": "application/json" };

function swap<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
	const target = index + by;
	if (target < 0 || target >= list.length) return [...list];
	const next = [...list];
	[next[index], next[target]] = [next[target]!, next[index]!];
	return next;
}

function issueText(issue: ProgrammeIssue, title: (courseId: string) => string): string {
	switch (issue.kind) {
		case "missing-course":
			return `A module's course (${issue.courseId}) no longer exists.`;
		case "duplicate-module":
			return `“${title(issue.courseId)}” is listed more than once.`;
		case "unknown-prerequisite":
			return `“${title(issue.courseId)}” requires a course that isn't in this programme.`;
		case "prerequisite-later":
			return `“${title(issue.courseId)}” requires “${title(issue.requires)}”, which comes in a later stage.`;
		case "prerequisite-cycle":
			return `These modules require each other in a loop: ${issue.courseIds.map((id) => `“${title(id)}”`).join(" → ")}.`;
	}
}

export function ProgrammeAdmin({ view }: { view: ProgrammeView }) {
	const { programme } = view;
	const courseTitle = (id: string) => view.courses.find((c) => c.id === id)?.title ?? id;
	const [title, setTitle] = useState(programme.title);
	const [description, setDescription] = useState(programme.description ?? "");
	const [stages, setStages] = useState<EditStage[]>(
		programme.stages.map((s) => ({
			id: s.id,
			title: s.title,
			description: s.description ?? "",
			modules: s.modules.map((m) => ({
				courseId: m.courseId,
				credits: m.credits === undefined ? "" : String(m.credits),
				optional: m.optional === true,
				requires: m.requires ?? [],
			})),
		})),
	);
	const [status, setStatus] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const used = new Set(stages.flatMap((s) => s.modules.map((m) => m.courseId)));
	const unused = view.courses.filter((c) => !used.has(c.id));

	const editStage = (si: number, patch: Partial<EditStage>) =>
		setStages((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)));
	const editModule = (si: number, mi: number, patch: Partial<EditModule>) =>
		editStage(si, { modules: stages[si]!.modules.map((m, i) => (i === mi ? { ...m, ...patch } : m)) });
	const moveModuleToStage = (si: number, mi: number, target: number) =>
		setStages((prev) => {
			const mod = prev[si]!.modules[mi]!;
			return prev.map((s, i) => {
				if (i === si) return { ...s, modules: s.modules.filter((_, j) => j !== mi) };
				if (i === target) return { ...s, modules: [...s.modules, mod] };
				return s;
			});
		});

	const save = async () => {
		setStatus(null);
		const badCredits = stages.flatMap((s) => s.modules).find((m) => m.credits.trim() !== "" && !(Number(m.credits) >= 0));
		if (badCredits) return setStatus(`Credits for “${courseTitle(badCredits.courseId)}” must be a number.`);
		const body = {
			title,
			description,
			stages: stages.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description,
				modules: s.modules.map((m) => ({
					courseId: m.courseId,
					...(m.credits.trim() !== "" ? { credits: Number(m.credits) } : {}),
					optional: m.optional,
					requires: m.requires.filter((r) => used.has(r)),
				})),
			})),
		};
		const res = await fetch(`/api/programmes/${programme.id}`, { method: "PUT", headers: json, body: JSON.stringify(body) }).catch(
			() => null,
		);
		if (res?.ok) window.location.reload();
		else setStatus((await res?.json().catch(() => null))?.error ?? "Saving failed. Try again.");
	};

	const remove = async () => {
		const res = await fetch(`/api/programmes/${programme.id}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) window.location.assign("/courses");
		else setStatus("Deleting the programme failed. Try again.");
	};

	const input = "rounded-md border bg-background px-2 py-1 text-sm text-foreground";
	const iconButton =
		"shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30";
	const textButton = "shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

	return (
		<details className="mt-12 rounded-xl border p-4" data-testid="programme-admin" open={view.issues.length > 0}>
			<summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
				Edit programme{view.issues.length > 0 && ` · ${view.issues.length} to fix`}
			</summary>

			{view.issues.length > 0 && (
				<ul className="mt-4 flex flex-col gap-1 rounded-md border border-destructive/40 p-3 text-sm text-destructive" data-testid="programme-issues">
					{view.issues.map((issue, i) => (
						<li key={i}>{issueText(issue, courseTitle)}</li>
					))}
				</ul>
			)}

			<label className="mt-4 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="programme-title">
				Title
			</label>
			<input id="programme-title" value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1.5 w-full ${input}`} />
			<label className="mt-3 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="programme-description">
				Description
			</label>
			<textarea
				id="programme-description"
				value={description}
				rows={2}
				onChange={(e) => setDescription(e.target.value)}
				className={`mt-1.5 w-full resize-y ${input}`}
			/>

			<div className="mt-6 text-xs uppercase tracking-wider text-muted-foreground">Stages</div>
			<div className="mt-2 flex flex-col gap-4">
				{stages.map((stage, si) => (
					<div key={stage.id} className="rounded-lg border p-3" data-testid="programme-stage-editor">
						<div className="flex items-center gap-1.5">
							<input
								aria-label="Stage title"
								value={stage.title}
								onChange={(e) => editStage(si, { title: e.target.value })}
								className={`min-w-0 flex-1 ${input}`}
							/>
							<button type="button" aria-label="Move stage up" disabled={si === 0} onClick={() => setStages(swap(stages, si, -1))} className={iconButton}>
								<ArrowUpIcon className="size-3.5" />
							</button>
							<button
								type="button"
								aria-label="Move stage down"
								disabled={si === stages.length - 1}
								onClick={() => setStages(swap(stages, si, 1))}
								className={iconButton}
							>
								<ArrowDownIcon className="size-3.5" />
							</button>
							<button type="button" onClick={() => setStages(stages.filter((_, i) => i !== si))} className={textButton}>
								Remove
							</button>
						</div>
						<input
							aria-label="Stage description"
							placeholder="Description (optional)"
							value={stage.description}
							onChange={(e) => editStage(si, { description: e.target.value })}
							className={`mt-1.5 w-full ${input}`}
						/>
						<ul className="mt-3 flex flex-col gap-2">
							{stage.modules.map((m, mi) => {
								const others = stages.flatMap((s) => s.modules).filter((o) => o.courseId !== m.courseId);
								return (
									<li key={m.courseId} className="rounded-md bg-accent/30 p-2 text-sm">
										<div className="flex flex-wrap items-center gap-1.5">
											<span className="min-w-0 flex-1 truncate text-foreground">{courseTitle(m.courseId)}</span>
											<input
												aria-label="Credits"
												placeholder="Credits"
												inputMode="numeric"
												value={m.credits}
												onChange={(e) => editModule(si, mi, { credits: e.target.value })}
												className={`w-20 ${input}`}
											/>
											<label className="flex items-center gap-1 text-xs text-muted-foreground">
												<input type="checkbox" checked={m.optional} onChange={(e) => editModule(si, mi, { optional: e.target.checked })} />
												Optional
											</label>
											<select
												aria-label="Stage"
												value={si}
												onChange={(e) => moveModuleToStage(si, mi, Number(e.target.value))}
												className={input}
											>
												{stages.map((s, i) => (
													<option key={s.id} value={i}>
														{s.title || `Stage ${i + 1}`}
													</option>
												))}
											</select>
											<button
												type="button"
												aria-label="Move module up"
												disabled={mi === 0}
												onClick={() => editStage(si, { modules: swap(stage.modules, mi, -1) })}
												className={iconButton}
											>
												<ArrowUpIcon className="size-3.5" />
											</button>
											<button
												type="button"
												aria-label="Move module down"
												disabled={mi === stage.modules.length - 1}
												onClick={() => editStage(si, { modules: swap(stage.modules, mi, 1) })}
												className={iconButton}
											>
												<ArrowDownIcon className="size-3.5" />
											</button>
											<button
												type="button"
												onClick={() => editStage(si, { modules: stage.modules.filter((_, j) => j !== mi) })}
												className={textButton}
											>
												Remove
											</button>
										</div>
										{others.length > 0 && (
											<details className="mt-1.5">
												<summary className="cursor-pointer text-xs text-muted-foreground">
													Requires{m.requires.length > 0 ? `: ${m.requires.map(courseTitle).join(", ")}` : " nothing"}
												</summary>
												<div className="mt-1 flex flex-col gap-0.5 pl-2">
													{others.map((o) => (
														<label key={o.courseId} className="flex items-center gap-1.5 text-xs text-foreground">
															<input
																type="checkbox"
																checked={m.requires.includes(o.courseId)}
																onChange={(e) =>
																	editModule(si, mi, {
																		requires: e.target.checked
																			? [...m.requires, o.courseId]
																			: m.requires.filter((r) => r !== o.courseId),
																	})
																}
															/>
															{courseTitle(o.courseId)}
														</label>
													))}
												</div>
											</details>
										)}
									</li>
								);
							})}
						</ul>
						{unused.length > 0 && (
							<select
								aria-label="Add a course to this stage"
								value=""
								onChange={(e) =>
									e.target.value &&
									editStage(si, {
										modules: [...stage.modules, { courseId: e.target.value, credits: "", optional: false, requires: [] }],
									})
								}
								className={`mt-2 w-full ${input}`}
							>
								<option value="">Add a course…</option>
								{unused.map((c) => (
									<option key={c.id} value={c.id}>
										{c.title}
									</option>
								))}
							</select>
						)}
					</div>
				))}
			</div>
			<button
				type="button"
				onClick={() =>
					setStages([...stages, { id: "", title: `Stage ${stages.length + 1}`, description: "", modules: [] }])
				}
				className="mt-3 rounded-md border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
			>
				Add stage
			</button>

			<div className="mt-4">
				<button
					type="button"
					onClick={() => void save()}
					disabled={title.trim() === "" || stages.some((s) => s.title.trim() === "")}
					className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					Save programme
				</button>
			</div>

			<div className="mt-6 border-t border-border/60 pt-4">
				{confirmDelete ? (
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm text-destructive">Delete this programme? Its courses stay in the library.</span>
						<button type="button" onClick={() => void remove()} className="rounded-md bg-destructive px-3 py-1.5 text-sm text-white">
							Delete
						</button>
						<button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
							Cancel
						</button>
					</div>
				) : (
					<button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-muted-foreground hover:text-foreground">
						Delete programme…
					</button>
				)}
			</div>
			{status && <p className="mt-3 text-sm text-destructive">{status}</p>}
		</details>
	);
}
