# Annual Key Tracker — Update v4

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
5. Use the commit message: `Add sticky performance entry bar`
6. Choose **Commit changes**.
7. Reopen `https://onikamathews-beep.github.io/annual-key-tracker/`.

The service-worker cache name was updated so the new layout should replace the older cached version. Tracker data remains in the browser’s local storage.
