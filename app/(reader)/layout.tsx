import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "../globals.css";

// The course reader's root layout (course-engine wave, 2026-10-24): the
// studio's fonts and styles, none of its providers — a reader page talks to
// no session, settings, or event channel, so it runs on a key-less server.
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

export const metadata: Metadata = {
	title: "Courses · LearnHarness",
	description: "Courses built with LearnHarness: explanations, questions, figures, and interactive demos.",
};

export default function ReaderLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`dark ${ui.variable} ${prose.variable}`}>
			<body className="min-h-dvh antialiased">{children}</body>
		</html>
	);
}
