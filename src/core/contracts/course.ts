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

import type { PlanBlockData } from "./chat.ts";

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
	/** A figure from the visual maker (SVG markup). */
	| { kind: "visual"; svg: string }
	/** An interactive demo from the demo builder (single-file HTML). */
	| { kind: "demo"; title: string; html: string }
	/** The lesson's dependency map (the plan tree as first drawn). */
	| { kind: "plan"; data: PlanBlockData };

export type CourseBlockKind = CourseBlock["kind"];

export interface CourseLesson {
	id: string;
	title: string;
	/** The session this lesson was published from — re-publishing that
	 *  session REPLACES this lesson in place (idempotent by source). */
	sourceChatId: string;
	publishedAt: string;
	blocks: CourseBlock[];
}

/** One stored course: data/courses/<id>.json. */
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
	lessons: Array<{ id: string; title: string }>;
}
