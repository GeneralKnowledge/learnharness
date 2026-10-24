import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseAdmin } from "@/components/course/course-admin";
import { LessonList } from "@/components/course/course-progress";
import { courseSummary, isReaderMode } from "@/src/core";
import { getCourse } from "@/src/server";

export const dynamic = "force-dynamic";

/** One course: its description and lessons, with this browser's progress. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const course = getCourse(id);
	if (!course) notFound();
	const summary = courseSummary(course);
	const first = summary.lessons[0];
	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
			<Link href="/courses" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
				All courses
			</Link>
			<h1 className="mt-4 font-title text-3xl tracking-tight text-foreground">{summary.title}</h1>
			{summary.description && <p className="mt-3 font-sans text-lg text-muted-foreground">{summary.description}</p>}
			{first ? (
				<>
					<Link
						href={`/courses/${summary.id}/${first.id}`}
						className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
					>
						Start the course
					</Link>
					<div className="mt-10">
						<LessonList courseId={summary.id} lessons={summary.lessons} />
					</div>
				</>
			) : (
				<p className="mt-6 font-sans text-base text-muted-foreground">This course has no lessons yet.</p>
			)}
			{!isReaderMode(process.env) && <CourseAdmin course={summary} />}
		</main>
	);
}
