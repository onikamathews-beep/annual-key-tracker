# Annual Key Tracker — Daily Email Report Update

Upload every file in this folder to the root of the existing GitHub repository and allow GitHub to replace files with matching names.

## Daily Email Report changes

- Adds an **Email Daily Report** button at the top of the Today view.
- The report always uses the date currently selected in the tracker, including today, yesterday, or another historical workday.
- Generates an Excel workbook containing the selected day's summary and activity detail.
- Adds saved Daily Email Report settings for **To**, **CC**, **Subject**, and **Email Message**.
- Supports reusable subject/message placeholders: `{date}`, `{date_short}`, `{employee}`, `{total}`, and `{ppq}`.
- Clicking the report button downloads the `.xlsx` file and opens a new email draft using the saved email details.
- Because normal browser pages cannot silently attach a local file to Outlook, attach the downloaded workbook to the opened draft before sending.
- Updates the service-worker cache so GitHub Pages picks up the new tracker version.

## GitHub upload

1. Open the `annual-key-tracker` repository.
2. Choose **Add file → Upload files**.
3. Select every file from this folder.
4. Allow GitHub to replace matching files.
5. Commit the changes.
6. Reopen your GitHub Pages tracker.
7. Press **Ctrl + Shift + R** once if the older version remains cached.

Your existing tracker entries and settings remain stored in the browser and are preserved by this update.

- Outlook signature-safe email launch: To/CC/Subject are prefilled, the saved report message is copied to the clipboard, and the mail body is left untouched so Outlook can insert the normal automatic signature.
- The default email message no longer adds “Thank you” or the employee name.


Update: Daily email drafts now prefill the saved message. Default subject: Daily Key Reports - {employee} - {date}. Default message includes the employee name and does not add a Thank you/name signoff.
