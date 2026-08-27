Generated sample datasets land here.

Nothing in this folder is authored by hand and nothing in it describes a real person. `fixtures/`
holds a generator script; running it writes synthetic CSVs into this directory, and those are the only
CSVs `.gitignore` will let past. See `fixtures/README.md`.

If you are about to drop your own spreadsheet in here to try the app: don't. Load it through the file
picker in the UI instead. The picker never writes it to disk, and this directory is inside the repo.
