# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains only `報修需求筆記.txt`, the Traditional Chinese requirements for a demonstration repair and issue registration system. There is no application source, test suite, dependency manifest, or build configuration yet. Read this note before implementing features.

As implementation begins, keep application code in `src/`, automated tests in `tests/`, static assets in `public/`, and Supabase schema migrations and access policies in `supabase/`. Store the planned spreadsheet, six-slide proposal, and operating guide in `docs/`. These are proposed locations; create them only when needed.

## Build, Test, and Development Commands

No build, development, lint, or test commands are currently configured. Do not assume commands such as `npm test` work. When choosing a framework, add its dependency manifest and document the exact installation, local development, build, and test commands in a root `README.md`. Commit the corresponding lockfile for reproducible installation.

## Coding Style & Naming Conventions

Use Traditional Chinese for user-facing labels and documentation, matching the requirements note. Use consistent English identifiers in code and descriptive filenames. Follow the selected language's standard formatter and linter; configure them before expanding the application. Until a stack is selected, no indentation or language-specific convention is established.

Preserve the specified categories, urgency levels, and statuses. Generate registration timestamps automatically rather than asking users to enter them.

## Testing Guidelines

No testing framework or coverage threshold exists yet. Add tests alongside implementation and document how to run them. Cover required-field validation, successful submission, list rendering, automatic timestamps, and database access restrictions. Name tests after observable behavior, such as `rejects_missing_description`.

## Commit & Pull Request Guidelines

This directory has no Git history, so no existing commit convention can be inferred. Use concise, imperative messages, such as `Add repair submission form`. Keep changes focused.

Pull requests should explain the change, reference applicable requirements, list verification performed, and include screenshots for interface changes. Explicitly identify schema or access-policy changes.

## Security & Scope

Use fictional names and locations only. Enable Supabase row-level security: the demo permits public inserts and reads but prohibits updates and deletes. Keep privileged keys out of frontend code and version control. Status editing, authentication, and notifications require further decisions; do not implement unrestricted status updates based on the broader administrator description.
