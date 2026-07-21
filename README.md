# Annual Key Tracker — GitHub Pages Version

This folder is ready to upload to a GitHub repository and publish with GitHub Pages.

## What is included

- Daily **Key Tracker** or **Tally Counter** selection
- Each date starts unselected
- The tracking choice locks only for that selected day
- Key groups pasted together share the same alternating interaction color
- Tally buttons for **+1 through +5** and a custom **× Number** option
- Daily summary, activity history, week view, dashboard, and reports
- Color themes and dashboard settings
- JSON backup and restore
- Optional Excel/CSV import and Excel/CSV report export
- Installable home-screen web app support
- Local browser storage; no database is connected

## Upload it to GitHub

1. On GitHub, create a new repository. A name such as `annual-key-tracker` works well.
2. Open the new repository and choose **Add file → Upload files**.
3. Upload the **contents of this folder**, including:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.webmanifest`
   - `service-worker.js`
   - the `icons` folder
   - the `vendor` folder
4. Select **Commit changes**.
5. Open the repository’s **Settings**.
6. Select **Pages**.
7. Under **Build and deployment**, choose **Deploy from a branch**.
8. Select the `main` branch and `/ (root)` folder, then save.
9. GitHub will show the website address after publishing.

The website address will normally look like:

`https://YOUR-USERNAME.github.io/annual-key-tracker/`

## Data privacy

The GitHub repository contains only the blank application. Tracker activity is saved in the browser’s local storage and is not committed to GitHub.

Do not place employee names, IDs, member details, keys, backups, or imported spreadsheets directly in the repository.

Each browser/device has its own separate saved data. Use **Settings → Download Backup** before clearing browser data or moving to a different device.

## Excel library

The app loads SheetJS Community Edition only when an Excel import or export is requested. This keeps the tracker itself fast. If the library is blocked, the tracker still works and CSV export remains available.

For a fully self-contained version, download `xlsx.full.min.js` version 0.20.3 from the official SheetJS CDN into the `vendor` folder and change the final library script in `index.html` to:

```html
<script src="vendor/xlsx.full.min.js"></script>
```

## Updating the app later

Replace only the changed files in the repository and commit them. Saved tracker data remains in each user’s browser because code updates do not normally remove local storage.

Before a major update, download a JSON backup from Settings.
