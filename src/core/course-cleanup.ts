/**
 * The publish-time cleanup pass (course-engine wave 2, owner 2026-10-25).
 *
 * The projection (core/course.ts) drops the learner's own words, but the
 * teacher's prose still talks TO that learner: "as you said earlier",
 * "great answer!", "since you already know Python". A model rewrites each
 * piece of lesson wording into neutral course wording before the lesson is
 * stored. This module is the pure half: what gets rewritten, the prompt,
 * reading the reply, and applying it safely.
 *
 * VISUALS NEVER REACH THE MODEL. Figures, demos and the plan map are not
 * wording and pass through untouched. Inside wording, fenced code (mermaid
 * included), math ($…$, $$…$$, \(…\), \[…\]) and inline code are swapped
 * for ⟦Pn⟧ placeholders before the call and restored after; a rewrite that
 * loses, repeats or invents a placeholder is refused and the original
 * stays. Option values (what grading compares) are never sent.
 *
 * A text block the model empties was only about the one learner ("Nice
 * work — you got it!") and is dropped; questions and problems are never
 * dropped. Pure and deterministic given the reply.
 */

import type { CourseBlock } from "./contracts/course.ts";

/** One piece of lesson wording the model may rewrite. */
export interface CleanupSegment {
	/** `<block index>:<field>` — e.g. "3:markdown", "5:option1". */
	id: string;
	/** The wording with code and math replaced by ⟦Pn⟧ placeholders. */
	text: string;
	/** The protected spans, by placeholder number. */
	slots: string[];
	/** Only whole text blocks may be emptied (= dropped). */
	droppable: boolean;
}

export interface CleanupResult {
	blocks: CourseBlock[];
	/** Segments whose wording changed (drops included). */
	rewritten: number;
	/** Text blocks dropped as learner-only. */
	dropped: number;
	/** Rewrites refused because a placeholder was lost or altered. */
	refused: number;
}

const placeholder = (n: number) => `⟦P${n}⟧`;
const PLACEHOLDER_RE = /⟦P(\d+)⟧/g;

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Replace fenced code blocks (whole lines) with placeholders. */
function protectFences(text: string, slots: string[]): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const fence = FENCE_OPEN_RE.exec(line)?.[1];
		if (!fence) {
			out.push(line);
			continue;
		}
		let end = i + 1;
		while (end < lines.length && !(lines[end] ?? "").trimStart().startsWith(fence)) end++;
		// An unclosed fence runs to the end, as markdown renders it.
		const block = lines.slice(i, Math.min(end, lines.length - 1) + 1).join("\n");
		slots.push(block);
		out.push(placeholder(slots.length - 1));
		i = end;
	}
	return out.join("\n");
}

/** Math and inline code in ONE alternation, so the leftmost span wins and
 *  no span is ever protected inside another (display math is tried before
 *  inline at the same position). Inline $…$ needs no space just inside
 *  either dollar and no digit right after the closing one — so "$5 and
 *  $10" stays prose. */
const SPAN_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|`[^`\n]+`|\$(?=\S)[^$\n]*?\S\$(?!\d)/g;

/** Swap every code/math span for a placeholder; `slots` receives them. */
export function protectWording(text: string): { text: string; slots: string[] } {
	const slots: string[] = [];
	const out = protectFences(text, slots).replace(SPAN_RE, (span) => {
		slots.push(span);
		return placeholder(slots.length - 1);
	});
	return { text: out, slots };
}

/** Put the protected spans back. Null when the rewrite lost, repeated or
 *  invented a placeholder, or moved a fence off its own line — the caller
 *  then keeps the original. */
export function restoreWording(text: string, slots: readonly string[]): string | null {
	const seen = new Array<number>(slots.length).fill(0);
	for (const m of text.matchAll(PLACEHOLDER_RE)) {
		const n = Number(m[1]);
		if (n >= slots.length) return null;
		seen[n] = (seen[n] ?? 0) + 1;
	}
	if (seen.some((count) => count !== 1)) return null;
	// A fence only renders on lines of its own.
	for (const [n, slot] of slots.entries()) {
		if (!FENCE_OPEN_RE.test(slot)) continue;
		const own = new RegExp(`(^|\\n)${placeholder(n)}(\\n|$)`);
		if (!own.test(text)) return null;
	}
	return text.replace(PLACEHOLDER_RE, (_, n: string) => slots[Number(n)] ?? "");
}

/** The rewritable fields of one block (field name → wording). */
function fieldsOf(block: CourseBlock): Array<[string, string]> {
	switch (block.kind) {
		case "text":
			return [["markdown", block.markdown]];
		case "choice":
			return [
				["question", block.question],
				...block.options.map((o, i): [string, string] => [`option${i}`, o.label]),
				...(block.explanation ? [["explanation", block.explanation] as [string, string]] : []),
			];
		case "recall":
			return [
				["question", block.question],
				["answer", block.answer],
			];
		case "problem":
			return [
				["statement", block.statement],
				["solution", block.solution],
			];
		default:
			return [];
	}
}

/** Every piece of wording in the lesson, protected and ready to send. */
export function cleanupSegments(blocks: readonly CourseBlock[]): CleanupSegment[] {
	const segments: CleanupSegment[] = [];
	blocks.forEach((block, i) => {
		for (const [field, wording] of fieldsOf(block)) {
			if (!wording.trim()) continue;
			const { text, slots } = protectWording(wording);
			segments.push({ id: `${i}:${field}`, text, slots, droppable: block.kind === "text" });
		}
	});
	return segments;
}

/** Group segments into calls of at most `maxChars` of wording each (a
 *  single oversize segment gets a call of its own). */
export function batchSegments(segments: readonly CleanupSegment[], maxChars = 16_000): CleanupSegment[][] {
	const batches: CleanupSegment[][] = [];
	let current: CleanupSegment[] = [];
	let size = 0;
	for (const s of segments) {
		if (current.length > 0 && size + s.text.length > maxChars) {
			batches.push(current);
			current = [];
			size = 0;
		}
		current.push(s);
		size += s.text.length;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

export const CLEANUP_SYSTEM_PROMPT =
	"You are the editor who turns one tutoring session's material into a published course lesson. You return exactly the JSON object the instructions demand — nothing else, no preamble, no code fence.";

/** The rewrite request for one batch of segments. */
export function buildCleanupPrompt(segments: readonly CleanupSegment[]): string {
	const input = Object.fromEntries(segments.map((s) => [s.id, s.text]));
	return `The pieces of text below were written by a tutor for ONE learner during a live session. They are being published as a lesson that many readers will work through on their own, without a tutor. Rewrite each piece so it reads as course material for any reader.

Change only wording that depends on that one learner or that live conversation:
- references to the learner's earlier answers, messages, mistakes, background or goals ("as you said", "your answer B", "since you already know Java", "you mentioned…");
- reactions to the learner ("Great answer!", "Not quite", "Good question", "Exactly right, you…");
- conversational logistics ("let me know when you're ready", "reply with…", "I'll ask you next…", "in your last message").
Addressing the reader as "you" in general is fine ("you can think of a function as…").

Keep everything else exactly: the teaching content, its order, its tone, its markdown structure (headings, lists, emphasis), and its length as far as the edit allows. Do not add new explanations, summaries, or headings. A piece that needs no change is returned unchanged.

Every ⟦Pn⟧ token stands for code, math or a diagram. Each one must appear in your rewrite exactly once, unchanged, in a sensible place.

A piece whose id ends in ":markdown" may be returned as an empty string when it ONLY reacts to or talks about the individual learner and teaches nothing. Never empty any other piece.

Return ONE JSON object mapping every id to its rewritten text, with the same ids as the input.

INPUT:
${JSON.stringify(input, null, 2)}`;
}

/** The model's reply → id → rewritten text. Tolerates a code fence or
 *  stray prose around the object; anything unreadable yields an empty map
 *  (every segment then keeps its original). */
export function parseCleanupReply(reply: string): Map<string, string> {
	const start = reply.indexOf("{");
	const end = reply.lastIndexOf("}");
	if (start < 0 || end <= start) return new Map();
	try {
		const parsed = JSON.parse(reply.slice(start, end + 1)) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
		const out = new Map<string, string>();
		for (const [id, value] of Object.entries(parsed)) {
			if (typeof value === "string") out.set(id, value);
		}
		return out;
	} catch {
		return new Map();
	}
}

/** Apply the rewrites to the blocks. Unknown ids are ignored; a refused or
 *  missing rewrite keeps the original wording. */
export function applyCleanup(
	blocks: readonly CourseBlock[],
	segments: readonly CleanupSegment[],
	rewrites: ReadonlyMap<string, string>,
): CleanupResult {
	const next: Array<CourseBlock | null> = blocks.map((b) =>
		b.kind === "choice" ? { ...b, options: b.options.map((o) => ({ ...o })) } : { ...b },
	);
	let rewritten = 0;
	let dropped = 0;
	let refused = 0;

	for (const s of segments) {
		const raw = rewrites.get(s.id);
		if (raw === undefined) continue;
		const [indexText = "", field = ""] = s.id.split(":");
		const index = Number(indexText);
		const block = next[index];
		if (!block) continue;

		if (raw.trim() === "") {
			if (!s.droppable) {
				refused++;
				continue;
			}
			next[index] = null;
			rewritten++;
			dropped++;
			continue;
		}
		const restored = restoreWording(raw.trim(), s.slots);
		if (restored === null) {
			refused++;
			continue;
		}
		if (setField(block, field, restored)) rewritten++;
	}

	// A drop can leave two text blocks side by side — merge them, as the
	// projection does.
	const out: CourseBlock[] = [];
	for (const block of next) {
		if (!block) continue;
		const last = out.at(-1);
		if (block.kind === "text" && last?.kind === "text") {
			last.markdown = `${last.markdown}\n\n${block.markdown}`;
			continue;
		}
		out.push(block);
	}
	return { blocks: out, rewritten, dropped, refused };
}

/** Write one field; true when the wording changed. */
function setField(block: CourseBlock, field: string, value: string): boolean {
	const option = /^option(\d+)$/.exec(field);
	if (option && block.kind === "choice") {
		const o = block.options[Number(option[1])];
		if (!o || o.label === value) return false;
		o.label = value;
		return true;
	}
	const record = block as unknown as Record<string, unknown>;
	if (typeof record[field] !== "string" || record[field] === value) return false;
	record[field] = value;
	return true;
}
