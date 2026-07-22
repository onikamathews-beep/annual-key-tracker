# Annual Key Tracker update

This update corrects the date controls and browser persistence.

## Corrections

- **Go to Today** is hidden whenever today is already selected.
- Tapping the visible date field opens the device's native calendar.
- The tracker no longer relies on the small `localStorage` limit for large imports.
- Full tracker data is saved in IndexedDB, the browser's larger on-device database.
- Small trackers still keep a local fallback when space allows.
- Import completion now waits for the on-device save to finish.
- If a browser blocks both storage methods, the message explains that the file was opened but not stored for the next visit.
- Reset All Data clears both browser storage locations.
- Existing locally saved data is migrated automatically.

## Upload

1. Extract the ZIP.
2. Upload all eight files to the root of the `annual-key-tracker` GitHub repository.
3. Allow GitHub to replace matching files.
4. Commit with: `Fix calendar and browser saving`
5. After GitHub Pages publishes, completely close the old tracker tab and reopen the site.
