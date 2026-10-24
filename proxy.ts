import { NextResponse, type NextRequest } from "next/server";
import { isReaderMode, readerGate } from "./src/core/reader-gate.ts";

/**
 * Reader mode (course-engine wave, 2026-10-24): LH_READER=1 serves only the
 * published course library — see src/core/reader-gate.ts. Unset, every
 * request passes untouched (the desktop app and the studio are unchanged).
 */
export function proxy(request: NextRequest) {
	if (!isReaderMode(process.env)) return NextResponse.next();
	const verdict = readerGate(request.nextUrl.pathname, request.method);
	if (verdict === "allow") return NextResponse.next();
	if (verdict === "home") return NextResponse.redirect(new URL("/courses", request.url));
	return new NextResponse("Not found", { status: 404 });
}
