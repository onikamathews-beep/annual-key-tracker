# Annual Key Tracker update

Upload all files in this folder to the root of the existing GitHub repository and allow GitHub to replace matching files.

## Corrected previous-workbook import

The importer now reads the older workbook exactly as structured:

- dates are read from Excel row 2;
- each day is a fixed three-column block;
- A:C, D:F, G:I, J:L, and M:O are checked;
- the first column contains Keys;
- the second column contains Contact?;
- the third column contains Snoozed?;
- the importer finds the Keys / Contact? / Snoozed? header row and reads the key rows beneath it;
- every key counts as one separate interaction;
- blank Contact? and Snoozed? values import as Unable to Contact;
- old entries do not receive artificial timestamps;
- the same source row is not imported twice.

The update also removes visible app-version labels. The internal schema number is used only for data compatibility and browser cache refreshes.

## Upload

1. Extract the ZIP.
2. Open the `annual-key-tracker` repository.
3. Choose **Add file → Upload files**.
4. Select all eight files from the extracted folder.
5. Allow GitHub to replace matching files.
6. Commit with: `Fix previous tracker import layout`
7. Close the tracker tab completely and reopen the site after GitHub Pages publishes the change.
