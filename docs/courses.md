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

## Planned lessons and the author agent

A lesson can be planned before it is written: a title, an optional section, and a brief saying what it should cover. Plan lessons under **Edit course → Plan a lesson**, or give a module a `lessons` list in a programme outline (below). Readers see planned lessons as "coming soon".

A planned lesson is filled in one of two ways:

- **From a session.** Teach the topic in a session, then choose **Publish to course…** and pick the planned lesson under the course. The lesson keeps its place, section and brief.
- **By the author agent.** Under **Edit course**, press **Write** on one lesson or **Write N planned lessons with the author agent**. The author agent writes the whole lesson from its brief, with no live Q&A: it knows the programme's audience, the module, the modules it requires, and the lessons before and after it. Its questions go into the lesson with their answers, and the figures and demos it asks for are built and checked before they are placed. Lessons are written one at a time in the background, using the conversation model for writing and the figure and demo models for those builders. Each written lesson shows what it cost, and can be rewritten from the same brief.

The author agent never rewrites a lesson that was published from a session. Its prompt is `src/agent/prompts/author/00-base.md` followed by the teacher's method, question-principles, accuracy, voice and formatting fragments.

## Programmes

A programme arranges courses into a whole degree, certificate or curriculum. It has stages in order (you name them: "Year 1", "Level 4", "Foundation"), each stage lists modules, and each module is a course with optional credits, an optional flag, and the modules it requires. The engine knows nothing about the subject, so a history or medicine programme is just a different outline.

To lay out a programme in one go, open **New programme from an outline** at the bottom of `/courses` and paste JSON like this:

```json
{
  "title": "BA History",
  "description": "Three years of history.",
  "audience": "Undergraduates with A-level history or equivalent",
  "stages": [
    {
      "title": "Year 1",
      "modules": [
        { "title": "Historical Method", "key": "method", "credits": 20 },
        {
          "title": "The Medieval World",
          "credits": 20,
          "requires": ["method"],
          "lessons": [
            "What 'medieval' means",
            { "title": "Feudal obligations", "brief": "Lords, vassals and the manor", "section": "Society" }
          ]
        }
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
- `lessons` plans the module's lessons in order: a title, or `{ title, brief?, section? }`.
- `audience` says who the programme is for; the author agent writes every lesson for that reader.
- Nothing is created unless the whole outline checks out.

The programme page shows each stage's modules, credits and this browser's progress. Prerequisites are advice: a module says what to finish first but never locks. Under **Edit programme** you can rename stages, move modules between stages, change credits and requirements, and add courses from the library. It also lists anything to fix: a module listed twice, a requirement that isn't in the programme, one that comes in a later stage, or requirements that loop. Deleting a course takes it out of every programme; deleting a programme keeps its courses.

Programmes are stored as one JSON file each in `data/programmes/`; the rules are in `src/core/programme.ts`.

## Reading a course

`/courses` lists the library. Each lesson renders with the same components as a session, so figures, demos, math and diagrams look the same. Questions are answered in the page, and progress is kept in the reader's browser.

## Hosting a reader-only site

Set `LH_READER=1` to serve only the course library and its programmes. `/` redirects to `/courses`, the course API is read-only, and every studio page and API returns 404, so the server needs no provider keys. Point `LH_DATA_DIR` at a directory that holds the `courses/` and `programmes/` folders you published.

LearnHarness is AGPL-3.0: a public deployment of a modified copy must offer its source to its users.
