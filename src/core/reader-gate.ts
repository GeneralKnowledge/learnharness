/**
 * THE READER GATE (course-engine wave, owner 2026-10-24): with LH_READER=1
 * the server is a public course site — readers browse the published library
 * and never reach the studio, its sessions, settings, or anything that
 * spends API keys. Pure: proxy.ts asks it about every request.
 *
 * Allowed: the /courses pages, GET on /api/courses*, and the framework's
 * own assets. "/" lands on the library. Everything else is not found —
 * a 404 rather than a 403, so the studio's routes don't announce themselves.
 */

export type ReaderGateVerdict = "allow" | "home" | "deny";

/** Is the server running as a reader-only course site? */
export function isReaderMode(env: Record<string, string | undefined>): boolean {
	return env.LH_READER === "1";
}

export function readerGate(pathname: string, method: string): ReaderGateVerdict {
	if (pathname === "/") return "home";
	if (pathname === "/courses" || pathname.startsWith("/courses/")) return "allow";
	if (pathname.startsWith("/_next/")) return "allow";
	if (pathname === "/api/courses" || pathname.startsWith("/api/courses/")) {
		return method === "GET" || method === "HEAD" ? "allow" : "deny";
	}
	// Public static files (fonts, icons) — a final segment with an extension.
	if (!pathname.startsWith("/api/") && /\/[^/]+\.[a-z0-9]+$/i.test(pathname)) return "allow";
	return "deny";
}
