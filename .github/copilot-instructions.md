# AI Assistant Instructions - GitHub Copilot

This repository uses the llm-wiki approach. As GitHub Copilot, you are responsible for automatically maintaining documentation in the wiki/ directory and updating the project changelog for shipped behavior changes.

## Mandatory rules

1. Auto-document changes: after any task that adds a feature, changes a public API, or refactors a module, update or create the relevant file in wiki/.
2. Session logs: for sessions with multiple file changes, create wiki/sessions/YYYY-MM-DD-<topic>.md using the standard format from wiki/llm-wiki-setup.md.
3. Update wiki/README.md: if you add a new wiki file not already listed, add it to the table.
4. No duplicates: update an existing wiki page instead of creating a second page for the same component.
5. Auto-update CHANGELOG.md: for every shipped behavior change (feature, fix, refactor with user impact, provider parsing change, or new setting), add an entry under the current or next version in CHANGELOG.md within the same task.

## References

- Canonical wiki instructions: wiki/llm-wiki-setup.md
- Changelog file: CHANGELOG.md
