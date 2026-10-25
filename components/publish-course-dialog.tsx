"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import type { ChatListItem, CleanupOutcome, CourseSummary } from "@/src/core";

/** The "new course" choice in the course picker. */
export const NEW_COURSE = "__new__";

/**
 * Publish a session as a course lesson (course-engine wave, 2026-10-24): pick
 * an existing course or name a new one, then POST /api/courses. The server
 * keeps the teacher's material only (core/course.ts); re-publishing a session
 * already in the course replaces its lesson. The wording cleanup (on by
 * default) has the session's model rewrite learner-specific phrasing. Same portal + Esc + backdrop
 * shape as the delete dialog.
 */
export function PublishCourseDialog({
	chat,
	onClose,
}: {
	/** The session to publish; null = closed. */
	chat: Pick<ChatListItem, "id" | "title"> | null;
	onClose: () => void;
}) {
	const [courses, setCourses] = useState<CourseSummary[] | null>(null);
	const [target, setTarget] = useState<string>(NEW_COURSE);
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const [cleanup, setCleanup] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<{
		courseId: string;
		lessonId: string;
		replaced: boolean;
		cleanup: CleanupOutcome | null;
	} | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});

	useEffect(() => {
		if (!chat) return;
		setTarget(NEW_COURSE);
		setTitle(chat.title);
		setCleanup(true);
		setBusy(false);
		setError(null);
		setDone(null);
		setCourses(null);
		fetch("/api/courses")
			.then((res) => (res.ok ? res.json() : { courses: [] }))
			.then((body: { courses?: CourseSummary[] }) => setCourses(body.courses ?? []))
			.catch(() => setCourses([]));
	}, [chat]);

	useEffect(() => {
		if (!chat) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chat, onClose]);

	const run = async () => {
		if (!chat || busy) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/courses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					target === NEW_COURSE
						? { chatId: chat.id, courseTitle: title, cleanup }
						: { chatId: chat.id, courseId: target, cleanup },
				),
			});
			const body = (await res.json()) as {
				error?: string;
				courseId?: string;
				lessonId?: string;
				replaced?: boolean;
				cleanup?: CleanupOutcome;
			};
			if (!res.ok || !body.courseId || !body.lessonId) {
				setError(body.error ?? `Publishing failed (${res.status})`);
				setBusy(false);
				return;
			}
			setDone({
				courseId: body.courseId,
				lessonId: body.lessonId,
				replaced: body.replaced === true,
				cleanup: body.cleanup ?? null,
			});
			setBusy(false);
		} catch {
			setError("Publishing failed — network error. Try again.");
			setBusy(false);
		}
	};

	if (!chat) return null;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Publish to course"
				data-testid="publish-course-dialog"
				onClick={(e) => e.stopPropagation()}
				className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
			>
				<h2 className="text-sm font-semibold text-foreground">Publish to course</h2>
				<div className="mt-1.5">
					<code className="font-mono text-sm text-foreground">{chat.title}</code>
				</div>
				{done ? (
					<>
						<p className="mt-3 text-sm text-muted-foreground">
							{done.replaced ? "The lesson was updated from this session." : "The session is now a lesson."} Your own
							messages and answers were left out.
						</p>
						{done.cleanup?.status === "done" && (
							<p data-testid="publish-cleanup-done" className="mt-2 text-sm text-muted-foreground">
								{done.cleanup.rewritten === 0
									? "No wording needed tidying for readers."
									: `Tidied ${done.cleanup.rewritten} ${done.cleanup.rewritten === 1 ? "passage" : "passages"} for readers${
											done.cleanup.dropped > 0 ? `, removing ${done.cleanup.dropped} that only spoke to you` : ""
										}.`}
							</p>
						)}
						{done.cleanup?.status === "failed" && (
							<p data-testid="publish-cleanup-failed" className="mt-2 text-sm text-destructive">
								{done.cleanup.error} Publish again to retry.
							</p>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								Close
							</button>
							<a
								href={`/courses/${done.courseId}/${done.lessonId}`}
								data-testid="publish-open-lesson"
								className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
							>
								Open lesson
							</a>
						</div>
					</>
				) : (
					<>
						<p className="mt-2 text-sm text-muted-foreground">
							The teacher&apos;s explanations, questions with their answers, figures, demos and plan map become a lesson
							anyone can read without an API key. Your messages and answers stay out. Publishing the same session again
							updates its lesson.
						</p>
						<label className="mt-3 flex items-start gap-2 text-sm text-foreground">
							<input
								type="checkbox"
								data-testid="publish-course-cleanup"
								checked={cleanup}
								disabled={busy}
								onChange={(e) => setCleanup(e.target.checked)}
								className="mt-0.5"
							/>
							<span>
								Tidy wording for readers
								<span className="block text-xs text-muted-foreground">
									The session&apos;s model rewrites phrases aimed at you (&ldquo;as you said&rdquo;, &ldquo;great
									answer&rdquo;) into course wording. Code, math, diagrams, figures and demos are left untouched. Uses
									your API key.
								</span>
							</span>
						</label>
						<label className="mt-4 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="publish-course-target">
							Course
						</label>
						<select
							id="publish-course-target"
							data-testid="publish-course-target"
							value={target}
							disabled={busy || courses === null}
							onChange={(e) => setTarget(e.target.value)}
							className="mt-1.5 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground"
						>
							<option value={NEW_COURSE}>New course…</option>
							{(courses ?? []).map((c) => (
								<option key={c.id} value={c.id}>
									{c.title} ({c.lessons.length} {c.lessons.length === 1 ? "lesson" : "lessons"})
								</option>
							))}
						</select>
						{target === NEW_COURSE && (
							<input
								type="text"
								data-testid="publish-course-title"
								aria-label="New course title"
								value={title}
								disabled={busy}
								onChange={(e) => setTitle(e.target.value)}
								className="mt-2 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground"
							/>
						)}
						{error && (
							<p data-testid="publish-course-error" className="mt-3 text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={busy}
								className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								data-testid="publish-course-run"
								onClick={() => void run()}
								disabled={busy || (target === NEW_COURSE && title.trim() === "")}
								className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{busy ? (cleanup ? "Tidying and publishing…" : "Publishing…") : "Publish"}
							</button>
						</div>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}
