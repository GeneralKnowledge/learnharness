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

## Ordering lessons

Open **Edit course** on a course page to move lessons up and down, rename them, and give them a section. Lessons next to each other with the same section are shown under one heading. Re-publishing a session keeps its lesson's place and section.

## Programmes

A programme arranges courses into a whole degree, certificate or curriculum. It has stages in order (you name them: "Year 1", "Level 4", "Foundation"), each stage lists modules, and each module is a course with optional credits, an optional flag, and the modules it requires. The engine knows nothing about the subject, so a history or medicine programme is just a different outline.

To lay out a programme in one go, open **New programme from an outline** at the bottom of `/courses` and paste JSON like this:

```json
{
  "title": "BA History",
  "description": "Three years of history.",
  "stages": [
    {
      "title": "Year 1",
      "modules": [
        { "title": "Historical Method", "key": "method", "credits": 20 },
        { "title": "The Medieval World", "credits": 20, "requires": ["method"] }
      ]
    },
    {
      "title": "Year 2",
      "modules": [
        { "title": "Early Modern Europe", "credits": 20, "requires": ["The Medieval World"] },
        { "title": "Oral History", "credits": 10, "optional": true }
      ]
    }
  ]
}
```

- Every module without a `courseId` becomes a new, empty course; publish sessions into it as usual. Give `courseId` to reuse a course you already have.
- `requires` names other modules by `key`, by exact title, or by course id.
- Nothing is created unless the whole outline checks out.

The programme page shows each stage's modules, credits and this browser's progress. Prerequisites are advice: a module says what to finish first but never locks. Under **Edit programme** you can rename stages, move modules between stages, change credits and requirements, and add courses from the library. It also lists anything to fix: a module listed twice, a requirement that isn't in the programme, one that comes in a later stage, or requirements that loop. Deleting a course takes it out of every programme; deleting a programme keeps its courses.

Programmes are stored as one JSON file each in `data/programmes/`; the rules are in `src/core/programme.ts`.

## Reading a course

`/courses` lists the library. Each lesson renders with the same components as a session, so figures, demos, math and diagrams look the same. Questions are answered in the page, and progress is kept in the reader's browser.

## Hosting a reader-only site

Set `LH_READER=1` to serve only the course library and its programmes. `/` redirects to `/courses`, the course API is read-only, and every studio page and API returns 404, so the server needs no provider keys. Point `LH_DATA_DIR` at a directory that holds the `courses/` and `programmes/` folders you published.

LearnHarness is AGPL-3.0: a public deployment of a modified copy must offer its source to its users.
