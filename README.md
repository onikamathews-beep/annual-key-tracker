# Annual Key Tracker — Daily Email Report Update

This update adds a selected-day Excel + email workflow to the existing Key & Tally Tracker.

## New feature

- **Email Daily Report** now appears at the top of the Today view.
- It follows the date selected in the tracker instead of forcing the current date.
- The generated Excel workbook includes employee, date, tracking method, PPQ, interaction totals, outcome totals, and the detailed Key List or Tally List activity table.
- Report recipients, CC addresses, subject, and email message can be saved under **Settings → Daily Email Report**.
- Subject and message templates support `{date}`, `{date_short}`, `{employee}`, `{total}`, and `{ppq}`.
- The tracker downloads the workbook and opens the default email application with the saved recipients, subject, and message filled in.

### Attachment note

Web browsers do not allow an ordinary webpage to silently attach a local file to an Outlook draft. The tracker therefore downloads the Excel report first and opens the email draft immediately after. Attach the downloaded workbook before sending.

## Upload

1. Extract this ZIP.
2. Upload all files in the folder to the root of the existing `annual-key-tracker` GitHub repository.
3. Replace files with matching names.
4. Commit the update.
5. Reopen the GitHub Pages site and press **Ctrl + Shift + R** once if needed.
