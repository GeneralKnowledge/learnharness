"use client";

import { useState } from "react";

/**
 * The studio's course controls (course-engine wave, 2026-10-24): rename,
 * describe, drop a lesson, delete the course. Rendered only outside reader
 * mode — a hosted reader site never shows them, and its gate refuses the
 * writes anyway (core/reader-gate.ts).
 */
export function CourseAdmin({
	course,
}: {
	course: { id: string; title: string; description?: string; lessons: ReadonlyArray<{ id: string; title: string }> };
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
				<>
					<div className="mt-6 text-xs uppercase tracking-wider text-muted-foreground">Lessons</div>
					<ul className="mt-2 flex flex-col gap-1">
						{course.lessons.map((lesson) => (
							<li key={lesson.id} className="flex items-center justify-between gap-2 text-sm">
								<span className="min-w-0 truncate text-foreground">{lesson.title}</span>
								<button
									type="button"
									onClick={() => void removeLesson(lesson.id)}
									className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									Remove
								</button>
							</li>
						))}
					</ul>
				</>
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
