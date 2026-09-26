# Source and QA notes

## Reporting job

- Audience: product stakeholders / facility operations
- Question: Why is the July facility utilization rate unusually low?
- Decision use: distinguish a calculation issue from source-data loss and identify the safest recovery action.
- Time scope: July 2026, with March-August current-state context and Git history through 2026-08-17.

## Required executive-report structure mapping

- Title: `title`
- Executive Summary: `executive_summary`
- Key findings with visual evidence: `history_finding` through `quality_finding`
- Recommended next steps: `recommendations`
- Further questions: `further_questions`
- Caveats and assumptions: `caveats`

No required section was omitted. Metric definitions are included before the evidence that depends on them.

## Source inventory

- `events.json`: 52 active event records in the inspected snapshot.
- `archived_events.json`: 127 archived event records in the inspected snapshot.
- `admin/admin.js`: current dashboard, archive, and manual-delete behavior.
- Git history for `events.json` and `archived_events.json`: 313 source snapshots inspected.
- `analyze-july.mjs`: reproducible current-state calculation and data-quality profile.
- `analyze-july-history.mjs`: change-point scan over repository history.
- `compare-july-snapshots.mjs`: exact comparison of the July peak, deletion waves, and current state.

The repository is authoritative for this diagnostic. Browser-local edits that were never published cannot be reconstructed from Git.

## Verified diagnostic spine

- Current dashboard result: 262 occupied facility-hours / 4,433 configured facility-hours = 5.91%, displayed as 6%.
- Historical peak on commit `8981db9` (2026-07-29 08:32): 29 records, 111 schedule-days, 646.5 occupied facility-hours, displayed rate 15%.
- Current state: 4 records, 20 schedule-days, 262 occupied facility-hours, displayed rate 6%.
- Peak-to-current difference: -25 exact records, -91 schedule-days, -384.5 occupied facility-hours, -9 percentage points.
- Deletion-wave commits `c50c11c`, `3d6b196`, and `6084947` changed only `events.json`; the removed July records were not added to `archived_events.json` in those commits.
- Manual delete in `admin/admin.js` removes records from `events` without adding an archive or tombstone. This mechanism is consistent with the observed Git history, but the actor and intent cannot be proved from the repository.
- Archived July records currently contribute 231 of 262 facility-hours (88.2%). Archive exclusion would reduce the displayed rate to roughly 1%, so archive omission is not the reason for the current 6% when loading succeeds.

## Chart map

| Report section | Analytical question | Family / type | Fields | Supported claim | Palette policy |
|---|---|---|---|---|---|
| July history | When and how far did July utilization fall? | Comparison / bar | `snapshot_label`, `occupied_facility_hours` | Occupied hours fell from 646.5 to 262 after three event-only update waves | Single-root blue with direct values; no grouping legend |

The chart uses six ordered repository snapshots rather than a line because the evidence is a small set of discrete change points, not a continuous time series. The source dataset also retains event counts, schedule-days, displayed rate, and commit identifiers for auditability.

## Data-quality checks

- Combined active/archive grain: 179 unique event signatures; no exact active/archive duplicates after current deduplication.
- July completeness: 4 current records; 25 exact records from the historical peak are absent from current July data.
- July time validity: 0 schedule-days with missing or invalid times.
- July facility validity: all July locations map to configured facilities.
- Global facility validity: `駐車場` and `外部` are not configured facilities and are excluded from utilization, but neither affects July.
- July usage classification: 2 of 4 events are unset; they account for 234 facility-hours (89.3%) and disappear from internal/external filtered views.

## Material caveats

- Git proves that records disappeared from the published JSON history; it does not prove whether deletion was accidental, a cancellation cleanup, or intentional deduplication.
- Do not restore all 25 records blindly. Some same-title records may be legitimate separate reservations, while others may be superseded duplicates. Review dates, facilities, and operational records first.
- The rate denominator assumes all 11 facilities are available every calendar day from 8:00 to 21:00. July uses only 5 facilities; excluding the 6 unused facilities would produce 13.0%, but that is a different KPI definition.
- The historical comparison applies the current overlap-union calculation to old snapshots, so it is comparable to the corrected current dashboard rather than the older additive implementation.
