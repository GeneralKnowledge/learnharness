/**
 * Course contracts — the reusable library a session is published into
 * (course-engine wave, owner 2026-10-24: LearnHarness as an ENGINE TO BUILD
 * COURSES; readers consume the stored material and never spend API keys).
 *
 * A course is an ordered list of lessons; a lesson is the learner-independent
 * teaching material of ONE source session — the teacher's prose (math and
 * mermaid included), its questions with their committed answers, the
 * delivered visuals and demos, and the plan map. Learner words never enter a
 * course: no user messages, no answers, no thinking. The projection is pure
 * (core/course.ts courseLessonFromChat); the fs adapter is src/store/courses.ts.
 */

import type { CallUsage, PlanBlockData } from "./chat.ts";

/** Bumped only for breaking shape changes — same lazy discipline as chats. */
export const CURRENT_COURSE_VERSION = 1;

/** One option of a multiple-choice question, as the teacher authored it. */
export interface CourseQuestionOption {
	label: string;
	value: string;
}

/** One block of lesson material, in reading order. */
export type CourseBlock =
	/** Teacher prose — markdown with $math$ and ```mermaid fences. */
	| { kind: "text"; markdown: string }
	/** A graded multiple-choice question (quiz / probe). `role` is the
	 *  teaching-cycle type when the teacher declared one (predict / check). */
	| {
			kind: "choice";
			question: string;
			options: CourseQuestionOption[];
			/** Values of the correct option(s). */
			correct: string[];
			multiSelect: boolean;
			explanation?: string;
			role?: string;
	  }
	/** A free-recall question (explain / recall): the reader writes their own
	 *  answer, then compares it with the committed one. */
	| { kind: "recall"; question: string; answer: string; role?: string }
	/** A practice problem: the statement, then the model solution on reveal. */
	| { kind: "problem"; statement: string; solution: string }
	/** An exercise (exercise wave, owner 2026-10-25: "simple exercises, no
	 *  runner"): a task the reader attempts in the page, optional hints
	 *  revealed one at a time, then the model answer and the reader's own
	 *  mark. Nothing is run or graded by the app. `response` says what
	 *  the attempt box holds; a new kind of response (a runner, a numeric
	 *  check…) is a new value here plus its renderer. */
	| {
			kind: "exercise";
			task: string;
			hints: string[];
			answer: string;
			response: ExerciseResponse;
			/** For code responses: the language, for the box and the answer. */
			language?: string;
	  }
	/** A figure from the visual maker (SVG markup). */
	| { kind: "visual"; svg: string }
	/** An interactive demo from the demo builder (single-file HTML). */
	| { kind: "demo"; title: string; html: string }
	/** The lesson's dependency map (the plan tree as first drawn). */
	| { kind: "plan"; data: PlanBlockData };

export type CourseBlockKind = CourseBlock["kind"];

/** What an exercise's attempt box holds: prose (an essay, a proof, a
 *  working) or code. */
export const EXERCISE_RESPONSES = ["text", "code"] as const;
export type ExerciseResponse = (typeof EXERCISE_RESPONSES)[number];

export interface CourseLesson {
	id: string;
	title: string;
	/** The session this lesson was published from — re-publishing that
	 *  session REPLACES this lesson in place (idempotent by source). Empty
	 *  while the lesson is planned. */
	sourceChatId: string;
	publishedAt: string;
	/** "planned" (author wave, 2026-10-25): a placeholder for a lesson not
	 *  written yet — a title and a brief, no blocks. Readers see it as
	 *  "coming soon"; publishing a session into it fills it in place.
	 *  Absent = written. */
	status?: "planned";
	/** What the lesson should cover — the author's brief. Kept when the
	 *  lesson is written, so it can be regenerated from the same brief. */
	brief?: string;
	/** Set when the author agent wrote this lesson (core/course-author.ts):
	 *  when, and the model calls it cost, per model (the author's own and
	 *  any figure or demo builders). */
	authored?: { at: string; usage: Array<{ model: string; steps: CallUsage[] }> };
	/** The section heading this lesson sits under (programme wave,
	 *  2026-10-25). Consecutive lessons with the same section form one group
	 *  in reading order; absent = no heading. */
	section?: string;
	blocks: CourseBlock[];
}

/** One stored course: data/courses/<id>.json. A course is a MODULE when a
 *  programme lists it (contracts/programme.ts); the course itself never
 *  knows which programmes use it. */
export interface CourseRecord {
	id: string;
	title: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
	version?: number;
	lessons: CourseLesson[];
}

/** The list view's shape (lesson titles, no blocks). */
export interface CourseSummary {
	id: string;
	title: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
	lessons: Array<{ id: string; title: string; section?: string; planned?: true }>;
}

/** What the publish-time wording cleanup did (core/course-cleanup.ts):
 *  off when the author opted out; failed when it could not run (the lesson
 *  was stored as projected). */
export type CleanupOutcome =
	| { status: "off" }
	| { status: "done"; rewritten: number; dropped: number; refused: number }
	| { status: "failed"; error: string };
