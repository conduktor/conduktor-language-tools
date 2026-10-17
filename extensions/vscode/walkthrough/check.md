## Check it before anything changes

Every Conduktor YAML file you open or save is dry-run against the Console. The Console says what applying it would do:

- **Created**, **Updated** or **NotChanged**, in the CodeLens above the resource and at the end of its first line;
- or why it would fail, in Problems on the resource's first line, one per policy rule.

To check on demand:

- **Dry run** in the CodeLens above a resource, or **Dry Run File** in the editor's title bar for the whole file.
- **Diff with Live**, in the CodeLens or the editor's title bar, shows the document side by side with the Console's
  version: what applying it would change.

Some resources cannot pass a dry run before another one exists: an Application before the Group that owns it, for
example. When that other resource is defined in the same file, the same folder or your other files, the waiting one
reads **pending** ("checked when applied") rather than failed.

`${VAR}` placeholders are filled from the nearest `.env` above the file, with the CLI's rules. **Conduktor: Show
Output** prints the matching `conduktor apply -f … --dry-run` for each workspace file, ready for CI.

A dry run never changes the Console, in prod or in dev. To stop the automatic one on open and save, set
`conduktor.validation.onOpenAndSave` to `false`.
