# Annual Key Tracker — Update v7

Upload every file in this folder to the root of the existing GitHub repository and allow GitHub to replace matching files.

## Previous Key Tracker import

This update recognizes the older monthly workbook layout used by files such as:

`Decarria Smith 2026 Key Tracker.xlsx`

It:

- scans every monthly worksheet;
- locates each repeating Date / Keys / Contact? / Snoozed? section;
- imports every key cell as one separate interaction;
- keeps duplicate keys that appear on separate workbook rows;
- uses Contact and Snoozed marks to assign the result;
- treats blank Contact?/Snoozed? cells as Unable to Contact after showing one confirmation;
- carries the selected PA PPQ or Appeals PPQ workflow when the workbook contains one;
- imports older keys without timestamps, excluding them from the hourly chart;
- reads the employee name from the filename when possible;
- prevents the same workbook source rows from being imported twice;
- processes the workbook locally in the browser.

Standard row-based Excel and CSV imports remain supported.

## GitHub upload

1. Extract `Annual_Key_Tracker_Update_v7.zip`.
2. Open the `annual-key-tracker` repository.
3. Choose **Add file → Upload files**.
4. Upload all eight files from the extracted folder.
5. Allow GitHub to replace the matching files.
6. Commit with: `Add previous Key Tracker workbook import`
7. Reopen the website after GitHub Pages finishes publishing.

Website:

`https://onikamathews-beep.github.io/annual-key-tracker/`
