/**
 * CourseStore — the fs JSON adapter (one file per course in data/courses/).
 *
 * Implements core/ports.ts CourseStore; the record shapes live in
 * core/contracts/course.ts. Same idioms as src/store/chats.ts: sync fs,
 * id-guarded filenames, JSON with tab indentation, a write choke point that
 * stamps the version, and an honest refusal to read a newer-stamped record.
 * Wired in the composition root (src/server/stores.ts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { CourseStore } from "../core/ports.ts";
import type { CourseRecord, CourseSummary } from "../core/contracts.ts";
import { CURRENT_COURSE_VERSION } from "../core/contracts.ts";
import { courseSummary } from "../core/course.ts";

function courseFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid course id: ${id}`);
	return path.join(PATHS.courses, `${id}.json`);
}

function writeCourse(record: CourseRecord): void {
	fs.mkdirSync(PATHS.courses, { recursive: true });
	fs.writeFileSync(courseFile(record.id), JSON.stringify({ ...record, version: CURRENT_COURSE_VERSION }, null, "\t"), "utf-8");
}

function createCourse(title: string): CourseRecord {
	const now = new Date().toISOString();
	const record: CourseRecord = {
		id: `course_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: title.trim() || "Untitled course",
		createdAt: now,
		updatedAt: now,
		lessons: [],
	};
	writeCourse(record);
	return { ...record, version: CURRENT_COURSE_VERSION };
}

function getCourse(id: string): CourseRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(courseFile(id), "utf-8"));
	} catch {
		return null;
	}
	const record = parsed as Partial<CourseRecord>;
	if (typeof record.id !== "string" || !Array.isArray(record.lessons)) return null;
	if (typeof record.version === "number" && record.version > CURRENT_COURSE_VERSION) {
		console.error(`[course ${id}] record stamped with schema version ${record.version} > ${CURRENT_COURSE_VERSION} — refusing to read it`);
		return null;
	}
	return record as CourseRecord;
}

function listCourses(): CourseSummary[] {
	try {
		fs.mkdirSync(PATHS.courses, { recursive: true });
		return fs
			.readdirSync(PATHS.courses)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getCourse(f.slice(0, -5)))
			.filter((r): r is CourseRecord => r !== null)
			.map(courseSummary)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function saveCourse(course: CourseRecord): void {
	writeCourse(course);
}

function deleteCourse(id: string): boolean {
	try {
		fs.unlinkSync(courseFile(id));
		return true;
	} catch {
		return false;
	}
}

export const courseStore: CourseStore = {
	createCourse,
	getCourse,
	listCourses,
	saveCourse,
	deleteCourse,
};
