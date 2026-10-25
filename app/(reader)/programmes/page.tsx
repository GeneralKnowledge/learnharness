import { redirect } from "next/navigation";

/** Programmes are listed with the courses, in the one library page. */
export default function ProgrammesPage() {
	redirect("/courses");
}
