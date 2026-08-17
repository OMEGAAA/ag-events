# Source and QA notes

## Reporting job

- Audience: product stakeholders / facility operations
- Question: Why does July show unusually few events, and does archiving remove them from facility utilization?
- Decision use: distinguish a display-definition issue from missing data, then rank follow-up fixes by data-loss risk.
- Time scope: 2026 calendar months, with July as the focal month and March–August as comparison context.

## Required executive-report structure mapping

- Title: `title`
- Executive Summary: `executive_summary`
- Key findings with visual evidence: `count_definition_finding` through `other_findings`
- Recommended next steps: `recommendations`
- Further questions: `further_questions`
- Caveats and assumptions: `caveats`

No required section was omitted or reordered.

## Source inventory

- `admin/admin.js`: dashboard aggregation, archive loading, automatic archive logic, ID handling.
- `events.json`: 55 active event records in the inspected snapshot.
- `archived_events.json`: 126 archived event records in the inspected snapshot.

The local repository snapshot is authoritative for this diagnostic. Unsaved Firebase/browser state was unavailable and is called out as a caveat.

## Evidence map

| Section | Question | Evidence form | Fields | Supported claim | Output |
|---|---|---|---|---|---|
| 「4件」は実施回数ではなく登録単位 | Is July low because activity is low or because one record holds many dates? | Comparison / grouped bar | `month_label`, `count_type`, `count` | July has 4 registered records but 20 date ranges | `report.html` |

The chart uses six ordered month categories, blue for registered records, and orange for date ranges. `monthly_count_chart.sql` materializes the reviewed monthly aggregates from the JSON/JavaScript reproduction into the exact long-form rows used by the chart. It is a presentation transformation; the controlling evidence remains `events.json`, `archived_events.json`, and `admin/admin.js`.

## Validation checks

- Reproduced the dashboard population as `events + archivedEvents`.
- Reproduced month inclusion through expanded date ranges.
- Reproduced 8:00–21:00 clipping and the 11-facility denominator.
- Compared summed reservation minutes with unioned facility/date/time intervals to quantify overlap inflation.
- Checked active IDs against both archived record IDs and archived `originalEventId` values.
- Checked missing `usageType`, missing time values, duplicate locations, and unknown facility names.

## Material caveats

- The local files may lag unpublished Firebase or browser-memory edits.
- The overlap analysis treats simultaneous reservations at one facility as one occupied interval; if the business intentionally wants demand-hours rather than occupancy-hours, the current additive metric may be valid but should be renamed.
- “Date range” counts each `dates` element once. A multi-day range is one range but multiple occupied days; July’s 20 ranges are all single-day entries.
