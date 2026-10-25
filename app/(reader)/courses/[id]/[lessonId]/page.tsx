import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonBlocks } from "@/components/course/lesson-blocks";
import { MarkDone } from "@/components/course/course-progress";
import { isPlannedLesson } from "@/src/core";
import { getCourse } from "@/src/server";

export const dynamic = "force-dynamic";

/** One lesson, read top to bottom, with the course's previous / next links. */
export default async function LessonPage({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
	const { id, lessonId } = await params;
	const course = getCourse(id);
	// Planned lessons have nothing to read yet: they are not pages.
	const lessons = course?.lessons.filter((l) => !isPlannedLesson(l)) ?? [];
	const index = lessons.findIndex((l) => l.id === lessonId);
	if (!course || index < 0) notFound();
	const lesson = lessons[index]!;
	const prev = lessons[index - 1];
	const next = lessons[index + 1];
	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
			<Link href={`/courses/${course.id}`} className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
				{course.title}
			</Link>
			<div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
				Lesson {index + 1} of {lessons.length}
				{lesson.section && <> · {lesson.section}</>}
			</div>
			<h1 className="mt-1 font-title text-3xl tracking-tight text-foreground">{lesson.title}</h1>
			<article className="mt-8">
				<LessonBlocks blocks={lesson.blocks} />
			</article>
			<nav className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-6">
				{prev ? (
					<Link href={`/courses/${course.id}/${prev.id}`} className="text-sm text-muted-foreground hover:text-foreground">
						← {prev.title}
					</Link>
				) : (
					<span />
				)}
				<MarkDone courseId={course.id} lessonId={lesson.id} />
				{next ? (
					<Link href={`/courses/${course.id}/${next.id}`} className="text-sm text-foreground hover:underline">
						{next.title} →
					</Link>
				) : (
					<Link href={`/courses/${course.id}`} className="text-sm text-foreground hover:underline">
						Back to the course
					</Link>
				)}
			</nav>
		</main>
	);
}
