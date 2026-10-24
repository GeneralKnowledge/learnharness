# Courses

LearnHarness can turn its teaching sessions into courses that anyone can read without an API key.

## Building a course

1. Teach yourself a topic in an ordinary session.
2. Right-click the session in the sidebar and choose **Publish to course…**.
3. Pick an existing course or name a new one.

The session becomes a lesson. It keeps the teacher's material and none of the learner's:

| Kept | Left out |
| --- | --- |
| The plan map, without the learner's position | Everything before the plan (the probe measured one learner) |
| Teacher prose, including math and mermaid diagrams | The learner's messages, answers, thinking and confidence |
| Quiz and explain questions, with the committed answers and explanations | Questions whose call failed |
| Figures from the visual maker and demos from the demo builder | Research briefs, failed figures and demos, agent reasoning |
| Practice sessions: each problem and its model solution | Practice sessions: the hints and replies between problems |

Publishing the same session again replaces its lesson in place, so a course can follow a session as it grows. The projection is `src/core/course.ts`; courses are stored as one JSON file each in `data/courses/`.

## Reading a course

`/courses` lists the library. Each lesson renders with the same components as a session, so figures, demos, math and diagrams look the same. Questions are answered in the page, and progress is kept in the reader's browser.

## Hosting a reader-only site

Set `LH_READER=1` to serve only the course library. `/` redirects to `/courses`, the course API is read-only, and every studio page and API returns 404, so the server needs no provider keys. Point `LH_DATA_DIR` at a directory that holds the `courses/` folder you published.

LearnHarness is AGPL-3.0: a public deployment of a modified copy must offer its source to its users.
