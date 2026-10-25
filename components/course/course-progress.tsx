"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { courseSections } from "@/src/core";

/**
 * Reader progress (course-engine wave, 2026-10-24): which lessons this
 * browser has finished, per course, in localStorage. No accounts by design
 * (owner, 2026-10-24: single user for now) — progress is a per-viewer
 * convenience, so every read and write tolerates storage being unavailable.
 */

const key = (courseId: string) => `lh.course.${courseId}.done`;

export function readDone(courseId: string): string[] {
	try {
		const raw = JSON.parse(window.localStorage.getItem(key(courseId)) ?? "[]");
		return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

function writeDone(courseId: string, done: readonly string[]): void {
	try {
		window.localStorage.setItem(key(courseId), JSON.stringify(done));
	} catch {
		/* storage blocked — progress just isn't remembered */
	}
}

export function useCourseProgress(courseId: string) {
	const [done, setDone] = useState<string[]>([]);
	useEffect(() => setDone(readDone(courseId)), [courseId]);
	const mark = useCallback(
		(lessonId: string, value: boolean) => {
			const next = value ? [...new Set([...readDone(courseId), lessonId])] : readDone(courseId).filter((id) => id !== lessonId);
			writeDone(courseId, next);
			setDone(next);
		},
		[courseId],
	);
	return { done, mark };
}

/** The course page's lesson list, grouped under its section headings, with
 *  this browser's checkmarks. */
export function LessonList({
	courseId,
	lessons,
}: {
	courseId: string;
	lessons: ReadonlyArray<{ id: string; title: string; section?: string }>;
}) {
	const { done } = useCourseProgress(courseId);
	return (
		<>
			<p className="text-xs uppercase tracking-wider text-muted-foreground" data-testid="course-progress">
				{done.filter((id) => lessons.some((l) => l.id === id)).length} of {lessons.length} lessons done
			</p>
			{courseSections(lessons).map((group, gi) => (
				<section key={gi} className={gi > 0 && !group.section ? "mt-6" : "mt-3"} data-testid="course-section">
					{group.section && (
						<h2 className="mb-2 mt-6 font-title text-lg tracking-tight text-foreground">{group.section}</h2>
					)}
					<ol className="flex flex-col gap-1.5">
						{group.lessons.map((lesson) => (
							<li key={lesson.id}>
								<a
									href={`/courses/${courseId}/${lesson.id}`}
									className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent"
								>
									<span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{lesson.number}</span>
									<span className="min-w-0 flex-1 font-sans text-base text-foreground">{lesson.title}</span>
									{done.includes(lesson.id) && <CheckIcon className="size-4 shrink-0 text-emerald-500" aria-label="Done" />}
								</a>
							</li>
						))}
					</ol>
				</section>
			))}
		</>
	);
}

/** The lesson footer's done toggle. */
export function MarkDone({ courseId, lessonId }: { courseId: string; lessonId: string }) {
	const { done, mark } = useCourseProgress(courseId);
	const isDone = done.includes(lessonId);
	return (
		<button
			type="button"
			onClick={() => mark(lessonId, !isDone)}
			data-testid="lesson-mark-done"
			className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
		>
			{isDone && <CheckIcon className="size-4 text-emerald-500" />}
			{isDone ? "Done" : "Mark as done"}
		</button>
	);
}
