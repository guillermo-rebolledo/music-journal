# Issue tracker

Issues and specs live in GitHub Issues for guillermo-rebolledo/music-journal.
Use the `gh` CLI from this clone.

## Operations

- Create an issue with `gh issue create --title "..." --body-file <file>`.
- Read an issue with `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list --state open --json number,title,body,labels`.
- Comment with `gh issue comment <number> --body-file <file>`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close an issue with `gh issue close <number>`.

Write multiline bodies to a temporary file and pass it with `--body-file`.

When a skill says to publish to the issue tracker, create a GitHub issue.
When it says to fetch a relevant ticket, read the GitHub issue.

## Related work

Use GitHub sub-issues for parent-child relationships. If unavailable, add
`Part of #<parent>` to the child and a task-list entry to the parent.

Use GitHub issue dependencies for blockers. If unavailable, add
`Blocked by #<number>` to the issue body. Work is unblocked when every
blocking issue is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**
