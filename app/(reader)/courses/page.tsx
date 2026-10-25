import Link from "next/link";
import { ProgrammeImport } from "@/components/programme/programme-import";
import { isReaderMode } from "@/src/core";
import { listCourses, listProgrammes } from "@/src/server";

export const dynamic = "force-dynamic";

/** The library (course-engine wave, 2026-10-24): programmes first, then
 *  every course (programme wave, 2026-10-25). */
export default function CoursesPage() {
	const courses = listCourses();
	const programmes = listProgrammes();
	const reader = isReaderMode(process.env);
	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
			<header className="flex items-baseline justify-between gap-4">
				<h1 className="font-title text-3xl tracking-tight text-foreground">Courses</h1>
				{!reader && (
					<Link href="/" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
						Back to studio
					</Link>
				)}
			</header>
			{programmes.length > 0 && (
				<section className="mt-8" data-testid="programmes-list">
					<h2 className="text-xs uppercase tracking-wider text-muted-foreground">Programmes</h2>
					<ul className="mt-3 flex flex-col gap-3">
						{programmes.map((p) => (
							<li key={p.id}>
								<Link href={`/programmes/${p.id}`} className="block rounded-xl border p-5 transition-colors hover:bg-accent">
									<div className="font-title text-xl tracking-tight text-foreground">{p.title}</div>
									{p.description && <p className="mt-1.5 font-sans text-base text-muted-foreground">{p.description}</p>}
									<div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
										{p.stages} {p.stages === 1 ? "stage" : "stages"} · {p.modules} {p.modules === 1 ? "module" : "modules"}
									</div>
								</Link>
							</li>
						))}
					</ul>
					{courses.length > 0 && <h2 className="mt-10 text-xs uppercase tracking-wider text-muted-foreground">All courses</h2>}
				</section>
			)}
			{courses.length === 0 ? (
				<p className="mt-8 font-sans text-base text-muted-foreground" data-testid="courses-empty">
					{reader
						? "No courses have been published yet."
						: "No courses yet. Open a session's menu in the sidebar and choose “Publish to course…” to make its teaching into a lesson."}
				</p>
			) : (
				<ul className={`${programmes.length > 0 ? "mt-3" : "mt-8"} flex flex-col gap-3`} data-testid="courses-list">
					{courses.map((course) => (
						<li key={course.id}>
							<Link href={`/courses/${course.id}`} className="block rounded-xl border p-5 transition-colors hover:bg-accent">
								<div className="font-title text-xl tracking-tight text-foreground">{course.title}</div>
								{course.description && (
									<p className="mt-1.5 font-sans text-base text-muted-foreground">{course.description}</p>
								)}
								<div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
									{course.lessons.length} {course.lessons.length === 1 ? "lesson" : "lessons"}
								</div>
							</Link>
						</li>
					))}
				</ul>
			)}
			{!reader && <ProgrammeImport />}
		</main>
	);
}
