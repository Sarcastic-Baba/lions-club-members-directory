# Agent Operating Rules

## Planning And Delegation

- Use `gpt-5.5` as the Codex planning/default model for this repository.
- Keep the main Codex thread focused on planning, task decomposition, coordination, review, and verification.
- Use `opencode run` as the coding sub-agent path for implementation work whenever a task requires code changes.
- Give each `opencode run` coding sub-agent a narrow prompt with the intended files, constraints, expected output, and verification command.
- Wait for sub-agent runs to finish, inspect their diffs, and run the relevant project verification before reporting back.
- If `opencode run` is unavailable, blocked, or unsuitable for a tiny edit, state that explicitly before coding directly.

Example coding delegation command from the repository root:

```powershell
opencode run --dir "C:\Users\ujjwa\OneDrive\Documents\codes\lions club website" "Implement the requested change. Keep edits scoped, do not touch unrelated files, and summarize the diff and verification."
```
