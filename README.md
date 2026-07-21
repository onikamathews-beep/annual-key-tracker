# Annual Key Tracker — Update v6

Upload every file in this folder to the root of your existing GitHub repository. Allow GitHub to replace the files with the same names.

## Included in this update

- Adds a compact active tracker that stays available while the agent scrolls.
- The compact tracker appears automatically after scrolling down in Daily view.
- It stays visible immediately in Weekly view so the agent can continue recording today’s work while reviewing the week.
- When a past or future daily date is being reviewed, the compact tracker remains available for today’s activity.
- Shows today’s Total Interactions, Contacted, Snoozed, and Unable to Contact counts.
- Keeps Outcomes, Result, Key entry or Tally controls, and Add buttons in the compact tracker.
- The performance bar can be made smaller without removing the active-entry controls.
- On narrow windows and phones, controls reorganize into smaller rows instead of being cut off.
- The sticky tracker always records activity to today, preventing new work from being added accidentally to a past week or date being reviewed.
- Preserves the existing Daily/Weekly selector, menu, reports, themes, holidays, time zone, notes, timelines, and local browser data.

## GitHub upload

1. Open the `annual-key-tracker` repository.
2. Choose **Add file → Upload files**.
3. Select all eight files from this folder.
4. Allow GitHub to replace the matching files.
5. Use the commit message: `Fix individual key counting and duplicate prompts`
6. Choose **Commit changes**.
7. Reopen `https://onikamathews-beep.github.io/annual-key-tracker/`.

The service-worker cache name was updated so the new layout should replace the older cached version. Tracker data remains in the browser’s local storage.


## Version 6 changes

- Every pasted key counts as one interaction, including legacy and imported records that previously stored several keys in one field.
- Keys submitted together remain visually grouped and share one timestamp.
- Each key appears on its own Activity History row and its own timeline line so its Outcomes workflow and Result remain independent.
- Duplicate keys are no longer silently removed. A warning offers Add Anyway, Skip Duplicates, View Existing, or Cancel.

- Every new calendar day starts with neither Key Tracker nor Tally Counter selected; the prior day’s method is not carried forward.
- Spreadsheet imports immediately create one stored interaction per key instead of a combined record.
- Versioned asset URLs and the version 6 service-worker cache force GitHub Pages to load the corrected files instead of an older cached build.
