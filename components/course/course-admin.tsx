"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

/**
 * The studio's course controls (course-engine wave, 2026-10-24): rename,
 * describe, drop a lesson, delete the course; reorder lessons and group them
 * under section headings (programme wave, 2026-10-25). Rendered only outside reader
 * mode — a hosted reader site never shows them, and its gate refuses the
 * writes anyway (core/reader-gate.ts).
 */
export function CourseAdmin({
	course,
}: {
	course: {
		id: string;
		title: string;
		description?: string;
		lessons: ReadonlyArray<{ id: string; title: string; section?: string }>;
	};
}) {
	const [title, setTitle] = useState(course.title);
	const [description, setDescription] = useState(course.description ?? "");
	const [status, setStatus] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const save = async () => {
		setStatus(null);
		const res = await fetch(`/api/courses/${course.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title, description }),
		}).catch(() => null);
		if (res?.ok) window.location.reload();
		else setStatus("Saving failed. Try again.");
	};

	const removeLesson = async (lessonId: string) => {
		const res = await fetch(`/api/courses/${course.id}/lessons/${lessonId}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) window.location.reload();
		else setStatus("Removing the lesson failed. Try again.");
	};

	const removeCourse = async () => {
		const res = await fetch(`/api/courses/${course.id}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) window.location.assign("/courses");
		else setStatus("Deleting the course failed. Try again.");
	};

	return (
		<details className="mt-10 rounded-xl border p-4" data-testid="course-admin">
			<summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">Edit course</summary>
			<label className="mt-4 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="course-title">
				Title
			</label>
			<input
				id="course-title"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				className="mt-1.5 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground"
			/>
			<label className="mt-3 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="course-description">
				Description
			</label>
			<textarea
				id="course-description"
				value={description}
				rows={2}
				onChange={(e) => setDescription(e.target.value)}
				className="mt-1.5 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground"
			/>
			<button
				type="button"
				onClick={() => void save()}
				disabled={title.trim() === ""}
				className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				Save
			</button>

			{course.lessons.length > 0 && (
				<LessonEditor
					courseId={course.id}
					lessons={course.lessons}
					onRemove={(id) => void removeLesson(id)}
					onError={setStatus}
				/>
			)}

			<div className="mt-6 border-t border-border/60 pt-4">
				{confirmDelete ? (
					<div className="flex items-center gap-2">
						<span className="text-sm text-destructive">Delete this course for good?</span>
						<button
							type="button"
							onClick={() => void removeCourse()}
							className="rounded-md bg-destructive px-3 py-1.5 text-sm text-white"
						>
							Delete
						</button>
						<button
							type="button"
							onClick={() => setConfirmDelete(false)}
							className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirmDelete(true)}
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Delete course…
					</button>
				)}
			</div>
			{status && <p className="mt-3 text-sm text-destructive">{status}</p>}
		</details>
	);
}

type EditableLesson = { id: string; title: string; section: string };

/** Lesson order, titles and section headings, saved together. A lesson
 *  inherits nothing from its neighbours: a blank section means no heading. */
function LessonEditor({
	courseId,
	lessons,
	onRemove,
	onError,
}: {
	courseId: string;
	lessons: ReadonlyArray<{ id: string; title: string; section?: string }>;
	onRemove: (lessonId: string) => void;
	onError: (message: string | null) => void;
}) {
	const initial: EditableLesson[] = lessons.map((l) => ({ id: l.id, title: l.title, section: l.section ?? "" }));
	const [rows, setRows] = useState(initial);
	const [saving, setSaving] = useState(false);
	const before = new Map(initial.map((l) => [l.id, l]));
	const orderChanged = rows.some((r, i) => r.id !== initial[i]?.id);
	const edited = rows.filter((r) => {
		const was = before.get(r.id);
		return was && (was.title !== r.title.trim() || was.section !== r.section.trim());
	});
	const dirty = orderChanged || edited.length > 0;

	const move = (index: number, by: -1 | 1) =>
		setRows((prev) => {
			const target = index + by;
			if (target < 0 || target >= prev.length) return prev;
			const next = [...prev];
			[next[index], next[target]] = [next[target]!, next[index]!];
			return next;
		});
	const edit = (id: string, patch: Partial<EditableLesson>) =>
		setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

	const save = async () => {
		onError(null);
		setSaving(true);
		const json = { "Content-Type": "application/json" };
		const calls: Array<Promise<Response | null>> = edited.map((r) =>
			fetch(`/api/courses/${courseId}/lessons/${r.id}`, {
				method: "PATCH",
				headers: json,
				body: JSON.stringify({ ...(r.title.trim() ? { title: r.title } : {}), section: r.section }),
			}).catch(() => null),
		);
		const results = await Promise.all(calls);
		const order = orderChanged
			? await fetch(`/api/courses/${courseId}/order`, {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ lessonIds: rows.map((r) => r.id) }),
				}).catch(() => null)
			: null;
		setSaving(false);
		if (results.every((r) => r?.ok) && (!orderChanged || order?.ok)) window.location.reload();
		else onError("Saving the lessons failed. Try again.");
	};

	return (
		<>
			<div className="mt-6 text-xs uppercase tracking-wider text-muted-foreground">Lessons</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Lessons next to each other with the same section are shown under one heading.
			</p>
			<ol className="mt-2 flex flex-col gap-1.5" data-testid="lesson-editor">
				{rows.map((lesson, i) => (
					<li key={lesson.id} className="flex flex-wrap items-center gap-1.5 text-sm sm:flex-nowrap">
						<span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
						<input
							aria-label="Lesson title"
							value={lesson.title}
							onChange={(e) => edit(lesson.id, { title: e.target.value })}
							className="min-w-0 flex-[2] rounded-md border bg-background px-2 py-1 text-sm text-foreground"
						/>
						<input
							aria-label="Section"
							placeholder="Section"
							value={lesson.section}
							onChange={(e) => edit(lesson.id, { section: e.target.value })}
							className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
						/>
						<button
							type="button"
							aria-label="Move up"
							disabled={i === 0}
							onClick={() => move(i, -1)}
							className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
						>
							<ArrowUpIcon className="size-3.5" />
						</button>
						<button
							type="button"
							aria-label="Move down"
							disabled={i === rows.length - 1}
							onClick={() => move(i, 1)}
							className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
						>
							<ArrowDownIcon className="size-3.5" />
						</button>
						<button
							type="button"
							onClick={() => onRemove(lesson.id)}
							className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							Remove
						</button>
					</li>
				))}
			</ol>
			<button
				type="button"
				onClick={() => void save()}
				disabled={!dirty || saving || rows.some((r) => r.title.trim() === "")}
				className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{saving ? "Saving…" : "Save lessons"}
			</button>
		</>
	);
}
