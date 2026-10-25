"use client";

import { useState } from "react";

/**
 * "New programme from an outline" (programme wave, 2026-10-25): paste one
 * JSON outline (docs/courses.md "Programmes") and the whole programme is
 * laid out — modules without a course become empty courses to fill.
 * Studio only.
 */
export function ProgrammeImport() {
	const [outline, setOutline] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const create = async () => {
		setStatus(null);
		let body: unknown;
		try {
			body = JSON.parse(outline);
		} catch {
			return setStatus("The outline isn't valid JSON.");
		}
		setBusy(true);
		const res = await fetch("/api/programmes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { programmeId?: string; error?: string } | null;
		setBusy(false);
		if (res?.ok && data?.programmeId) window.location.assign(`/programmes/${data.programmeId}`);
		else setStatus(data?.error ?? "Creating the programme failed. Try again.");
	};

	return (
		<details className="mt-10 rounded-xl border p-4" data-testid="programme-import">
			<summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">New programme from an outline</summary>
			<p className="mt-3 text-sm text-muted-foreground">
				Paste a programme outline as JSON: a title, then stages, each with its modules. Modules that don&apos;t name an
				existing course become new, empty courses. The format is in docs/courses.md.
			</p>
			<textarea
				aria-label="Programme outline"
				value={outline}
				rows={10}
				onChange={(e) => setOutline(e.target.value)}
				placeholder={'{\n  "title": "…",\n  "stages": [{ "title": "Year 1", "modules": [{ "title": "…", "credits": 15 }] }]\n}'}
				className="mt-3 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground"
			/>
			<button
				type="button"
				onClick={() => void create()}
				disabled={busy || outline.trim() === ""}
				className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{busy ? "Creating…" : "Create programme"}
			</button>
			{status && <p className="mt-3 text-sm text-destructive">{status}</p>}
		</details>
	);
}
