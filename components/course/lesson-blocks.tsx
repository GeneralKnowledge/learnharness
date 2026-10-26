"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { VisualOutputCard } from "@/components/artifacts/visual-card";
import { DemoOutputCard } from "@/components/artifacts/demo-card";
import { GRAPH_PAD, PlanDiagram, TEXT_CAP_SCALE } from "@/components/plan-block";
import { isChoiceCorrect, type CourseBlock, type ExerciseResponse, type PlanBlockData } from "@/src/core";

/**
 * A lesson's material in reading order (course-engine wave, 2026-10-24).
 * Every block renders through the SAME components the session uses — the
 * prose renderer (math, mermaid, code), the figure and demo cards, the plan
 * diagram — so a published lesson looks exactly like the session it came
 * from. Questions are self-contained: the reader answers, the committed
 * answer and explanation appear; nothing is sent anywhere.
 */
export function LessonBlocks({ blocks }: { blocks: readonly CourseBlock[] }) {
	return (
		<div className="flex flex-col gap-6" data-testid="lesson-blocks">
			{blocks.map((block, i) => (
				<LessonBlock key={i} block={block} />
			))}
		</div>
	);
}

function LessonBlock({ block }: { block: CourseBlock }) {
	switch (block.kind) {
		case "text":
			return <MessageResponse>{block.markdown}</MessageResponse>;
		case "choice":
			return <ChoiceQuestion block={block} />;
		case "recall":
			return <RecallQuestion block={block} />;
		case "problem":
			return <ProblemBlock block={block} />;
		case "exercise":
			return <ExerciseCard block={block} />;
		case "visual":
			return <VisualOutputCard output={{ svg: block.svg }} />;
		case "demo":
			return <DemoOutputCard output={{ title: block.title, html: block.html, tested: true }} />;
		case "plan":
			return <PlanMap data={block.data} />;
	}
}

/** The question card's frame + its role label (Predict / Check / Question). */
function QuestionFrame({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<section className="rounded-xl border bg-card p-4" data-testid="lesson-question">
			<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
			{children}
		</section>
	);
}

function roleLabel(role: string | undefined, fallback: string): string {
	if (role === "predict") return "Predict";
	if (role === "check") return "Check";
	return fallback;
}

function ChoiceQuestion({ block }: { block: Extract<CourseBlock, { kind: "choice" }> }) {
	const [selected, setSelected] = useState<string[]>([]);
	const [checked, setChecked] = useState(false);
	const right = checked && isChoiceCorrect(selected, block.correct);
	const toggle = (value: string) => {
		if (checked) return;
		setSelected((prev) =>
			block.multiSelect ? (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]) : [value],
		);
	};
	return (
		<QuestionFrame label={roleLabel(block.role, "Question")}>
			<MessageResponse>{block.question}</MessageResponse>
			{block.multiSelect && <p className="mt-1 text-xs text-muted-foreground">Select all that apply.</p>}
			<div className="mt-3 flex flex-col gap-1.5" role={block.multiSelect ? "group" : "radiogroup"}>
				{block.options.map((option) => {
					const isSelected = selected.includes(option.value);
					const isCorrect = block.correct.includes(option.value);
					return (
						<button
							key={option.value}
							type="button"
							role={block.multiSelect ? "checkbox" : "radio"}
							aria-checked={isSelected}
							disabled={checked}
							onClick={() => toggle(option.value)}
							data-testid="lesson-option"
							className={cn(
								"flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
								!checked && (isSelected ? "border-foreground/60 bg-accent" : "hover:bg-accent/60"),
								checked && isCorrect && "border-emerald-500/60 bg-emerald-500/10",
								checked && isSelected && !isCorrect && "border-red-500/60 bg-red-500/10",
							)}
						>
							<span className="mt-0.5 size-4 shrink-0">
								{checked && isCorrect && <CheckIcon className="size-4 text-emerald-500" aria-label="Correct answer" />}
								{checked && isSelected && !isCorrect && <XIcon className="size-4 text-red-500" aria-label="Your answer" />}
							</span>
							<MessageResponse className="min-w-0">{option.label}</MessageResponse>
						</button>
					);
				})}
			</div>
			{checked ? (
				<div className="mt-3" data-testid="lesson-feedback">
					<p className={cn("text-sm font-medium", right ? "text-emerald-500" : "text-red-500")}>
						{right ? "Correct." : "Not quite."}
					</p>
					{block.explanation && <MessageResponse className="mt-2">{block.explanation}</MessageResponse>}
					<button
						type="button"
						onClick={() => {
							setSelected([]);
							setChecked(false);
						}}
						className="mt-3 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
					>
						Try again
					</button>
				</div>
			) : (
				<button
					type="button"
					disabled={selected.length === 0}
					onClick={() => setChecked(true)}
					data-testid="lesson-check"
					className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					Check
				</button>
			)}
		</QuestionFrame>
	);
}

function RecallQuestion({ block }: { block: Extract<CourseBlock, { kind: "recall" }> }) {
	const [draft, setDraft] = useState("");
	const [revealed, setRevealed] = useState(false);
	return (
		<QuestionFrame label={roleLabel(block.role, "Explain in your own words")}>
			<MessageResponse>{block.question}</MessageResponse>
			<textarea
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				rows={3}
				placeholder="Write your answer, then compare."
				aria-label="Your answer"
				className="mt-3 w-full resize-y rounded-lg border bg-background px-3 py-2 font-sans text-base text-foreground"
			/>
			{revealed ? (
				<div className="mt-3 rounded-lg border-l-2 border-foreground/40 pl-3" data-testid="lesson-feedback">
					<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">The answer</div>
					<MessageResponse>{block.answer}</MessageResponse>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setRevealed(true)}
					data-testid="lesson-reveal"
					className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
				>
					Show the answer
				</button>
			)}
		</QuestionFrame>
	);
}

function ProblemBlock({ block }: { block: Extract<CourseBlock, { kind: "problem" }> }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<QuestionFrame label="Problem">
			<MessageResponse>{block.statement}</MessageResponse>
			{revealed ? (
				<div className="mt-3 rounded-lg border-l-2 border-foreground/40 pl-3" data-testid="lesson-feedback">
					<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Model solution</div>
					<MessageResponse>{block.solution}</MessageResponse>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setRevealed(true)}
					data-testid="lesson-reveal"
					className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
				>
					Show the solution
				</button>
			)}
		</QuestionFrame>
	);
}

type ExerciseBlock = Extract<CourseBlock, { kind: "exercise" }>;

/** The attempt box per response kind (exercise wave, 2026-10-25). A new
 *  kind of exercise response is one entry here plus its contract value. */
const RESPONSE_BOXES: Record<ExerciseResponse, (props: { value: string; onChange: (v: string) => void; language?: string }) => React.ReactNode> = {
	text: ({ value, onChange }) => (
		<textarea
			value={value}
			onChange={(e) => onChange(e.target.value)}
			rows={5}
			placeholder="Work it out here, then compare with the model answer."
			aria-label="Your attempt"
			className="mt-3 w-full resize-y rounded-lg border bg-background px-3 py-2 font-sans text-base text-foreground"
		/>
	),
	code: ({ value, onChange, language }) => (
		<textarea
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={(e) => {
				// Tab indents instead of leaving the box.
				if (e.key !== "Tab" || e.shiftKey) return;
				e.preventDefault();
				const box = e.currentTarget;
				const { selectionStart: start, selectionEnd: end } = box;
				onChange(`${value.slice(0, start)}    ${value.slice(end)}`);
				requestAnimationFrame(() => box.setSelectionRange(start + 4, start + 4));
			}}
			rows={8}
			spellCheck={false}
			placeholder={`Write your ${language ?? "code"} here, then compare with the model answer.`}
			aria-label="Your code"
			className="mt-3 w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-sm text-foreground"
		/>
	),
};

const MARKS = [
	{ value: "got", label: "Got it" },
	{ value: "partly", label: "Partly" },
	{ value: "not-yet", label: "Not yet" },
] as const;
type Mark = (typeof MARKS)[number]["value"];

/** The reader's own mark for one exercise, kept in this browser (keyed by
 *  the task's text, so it follows the exercise, not its position). */
function useExerciseMark(task: string): [Mark | null, (mark: Mark) => void] {
	const key = useMemo(() => {
		let h = 5381;
		for (let i = 0; i < task.length; i++) h = ((h << 5) + h + task.charCodeAt(i)) | 0;
		return `lh.exercise.${(h >>> 0).toString(36)}`;
	}, [task]);
	const [mark, setMark] = useState<Mark | null>(null);
	useEffect(() => {
		try {
			const stored = window.localStorage.getItem(key);
			setMark(MARKS.some((m) => m.value === stored) ? (stored as Mark) : null);
		} catch {
			/* storage blocked — the mark just isn't remembered */
		}
	}, [key]);
	const save = (next: Mark) => {
		setMark(next);
		try {
			window.localStorage.setItem(key, next);
		} catch {
			/* storage blocked */
		}
	};
	return [mark, save];
}

/** An exercise: attempt, hints one at a time, the model answer, then the
 *  reader marks himself. Nothing is run or graded. */
function ExerciseCard({ block }: { block: ExerciseBlock }) {
	const [draft, setDraft] = useState("");
	const [hintsShown, setHintsShown] = useState(0);
	const [revealed, setRevealed] = useState(false);
	const [mark, setMark] = useExerciseMark(block.task);
	const answer =
		block.response === "code" && !block.answer.includes("```")
			? `\`\`\`${block.language ?? ""}\n${block.answer}\n\`\`\``
			: block.answer;
	return (
		<QuestionFrame label={block.response === "code" ? `Exercise · ${block.language ?? "code"}` : "Exercise"}>
			<div data-testid="lesson-exercise">
				<MessageResponse>{block.task}</MessageResponse>
				{RESPONSE_BOXES[block.response]({ value: draft, onChange: setDraft, language: block.language })}
				{block.hints.slice(0, hintsShown).map((hint, i) => (
					<div key={i} className="mt-2 rounded-lg bg-accent/40 px-3 py-2" data-testid="lesson-hint">
						<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Hint {i + 1}</div>
						<MessageResponse>{hint}</MessageResponse>
					</div>
				))}
				<div className="mt-3 flex flex-wrap gap-2">
					{hintsShown < block.hints.length && !revealed && (
						<button
							type="button"
							onClick={() => setHintsShown((n) => n + 1)}
							data-testid="lesson-hint-next"
							className="rounded-md border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
						>
							{hintsShown === 0 ? "Show a hint" : "Another hint"} ({hintsShown + 1} of {block.hints.length})
						</button>
					)}
					{!revealed && (
						<button
							type="button"
							onClick={() => setRevealed(true)}
							data-testid="lesson-reveal"
							className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
						>
							Show the model answer
						</button>
					)}
				</div>
				{revealed && (
					<>
						<div className="mt-3 rounded-lg border-l-2 border-foreground/40 pl-3" data-testid="lesson-feedback">
							<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Model answer</div>
							<MessageResponse>{answer}</MessageResponse>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="How did you do?">
							<span className="text-xs uppercase tracking-wide text-muted-foreground">How did you do?</span>
							{MARKS.map((m) => (
								<button
									key={m.value}
									type="button"
									role="radio"
									aria-checked={mark === m.value}
									onClick={() => setMark(m.value)}
									data-testid="lesson-mark"
									className={cn(
										"rounded-md border px-2.5 py-1 text-sm transition-colors",
										mark === m.value ? "border-foreground/60 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
									)}
								>
									{m.label}
								</button>
							))}
						</div>
					</>
				)}
			</div>
		</QuestionFrame>
	);
}

/** The lesson's dependency map, drawn by the session's own plan diagram. */
function PlanMap({ data }: { data: PlanBlockData }) {
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const statuses = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.status] as const)), [data]);
	return (
		<figure className="my-2" data-testid="lesson-plan">
			<PlanDiagram
				nodes={data.nodes}
				edges={data.edges}
				statusOf={(id) => statuses.get(id) ?? "upcoming"}
				markerId={markerId}
				pad={GRAPH_PAD}
				textCapScale={TEXT_CAP_SCALE}
				monochrome
			/>
			<figcaption className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Lesson map</figcaption>
		</figure>
	);
}
