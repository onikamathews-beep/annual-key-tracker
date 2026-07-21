# Annual Key Tracker — Update v7

Upload every file in this folder to the root of the existing GitHub repository and allow GitHub to replace files with matching names.

## Version 8 changes

- Adds the seven 2026 company fixed holidays as built-in, nonremovable excluded dates.
- Uses Friday, July 3, 2026 for Independence Day exactly as listed on the company calendar.
- Fixed holidays automatically show as Holiday and are excluded from weekly/custom workday calculations.
- Keeps the option to add and remove separate custom excluded dates in Settings.
- Updates application and service-worker cache versions to Version 8.

## Version 7 changes

- Moves **Daily Timeline** out of the Tracker page and into its own left-menu view.
- Moves **Interactions Recorded by Hour** out of the Tracker page and into its own left-menu view.
- Keeps the date selector and previous/next date controls available in both new views.
- Keeps today’s compact active tracker available while viewing the Timeline or hourly chart.
- Displays the newest key group at the top of **Entries for This Date** and the oldest group at the bottom.
- Displays the newest timestamped activity at the top of **Daily Timeline** and the oldest activity at the bottom.
- Preserves the order of keys within a pasted group while moving the complete newest group above older groups.
- Preserves the Version 6 behavior where every key counts as one interaction and receives its own editable row.
- Keeps the existing browser storage key, so replacing the site files does not intentionally erase locally saved tracker data.
- Updates the service-worker cache and asset versions to Version 7 so GitHub Pages loads the new layout.

## GitHub upload

1. Open the `annual-key-tracker` repository.
2. Choose **Add file → Upload files**.
3. Select every file from this folder.
4. Allow GitHub to replace the matching files.
5. Use the commit message: `Move tracker insights to menu and sort newest first`
6. Choose **Commit changes**.
7. Reopen `https://onikamathews-beep.github.io/annual-key-tracker/`.
8. If the old layout remains, press **Ctrl + Shift + R** once.

Tracker data remains in the browser’s local storage unless the browser data is cleared or the site address changes.
