# Agent Workflow: Commit Per Task + Final Report

These are the working rules the agent must follow every time, regardless of task size.

---

## 1. Core Principles

1. **Break the work into small tasks before starting.** Each subtask should be describable in a single sentence.
2. **Commit as soon as each subtask is done.** Never wait until everything is finished and commit it all at once.
3. **Write a report when all work is finished**, summarizing what was done, what problems came up, and how they were handled.
4. **Be honest about actual status.** If something is unfinished, failed, or uncertain, say so. Never report success on something you have not verified.

---

## 2. Workflow

### 2.1 Before starting
- Read the task fully and write a short checklist of subtasks.
- Check git state: `git status` should show no unrelated leftover changes.
- Create a new branch for this task if appropriate.

### 2.2 While working (repeat for each subtask)
1. Complete one subtask.
2. Verify the result (run the code, run tests, or open the file and check it).
3. `git add` only the files related to that subtask (avoid `git add .` if unrelated files are present).
4. `git commit` with a meaningful message (see Section 3).
5. Jot down brief notes for the report (what was done / what problems came up), then move on to the next subtask.

### 2.3 When all work is finished
- Do a final overall check (run tests / review all files).
- Write the report following Section 4.
- Commit the report file as the final commit.

---

## 3. Commit Rules

### Commit size
- 1 commit = 1 self-contained subtask.
- If you need "and" several times in the commit message, the commit is too big. Split it.
- Do not commit broken or non-runnable code unless truly necessary, and in that case mark the message as `WIP`.

### Commit message format
Write in English using Conventional Commits:

```
<type>: <short summary, ~70 characters max>

<optional details: why it was done / things to watch out for>
```

**Allowed types**

| type | use when |
|------|----------|
| `feat` | adding new functionality or content |
| `fix` | fixing a bug or incorrect data |
| `docs` | changing documentation or reports |
| `refactor` | restructuring without changing behavior |
| `test` | adding or changing tests |
| `chore` | housekeeping, e.g. config, moving files |

**Good examples**
```
feat: add chunking script for markdown documents
fix: handle empty frontmatter in parser
docs: add task report for ingestion pipeline
```

**Bad examples**
```
update
fix stuff
add many things and fix bugs and update docs
```

---

## 4. Final Report

Create the file `reports/YYYY-MM-DD-<short-task-name>.md` (create the `reports/` folder if it does not exist).
If the user specifies a different location for reports, follow the user's instruction.

### Template

```markdown
# Report: <task name>

- **Date:** YYYY-MM-DD
- **Overall status:** Complete / Partially complete / Failed

## 1. Summary
(2-4 sentences: what the task was and the overall outcome.)

## 2. What Was Done
| # | Subtask | Commit | Status |
|---|---------|--------|--------|
| 1 | ... | `abc1234` | ✅ Done |
| 2 | ... | `def5678` | ⚠️ Partially done |

## 3. Problems Encountered and Resolutions
### Problem 1: <problem name>
- **Symptom:** What happened (include the error message if any)
- **Cause:** (if known; if unknown, say so)
- **Resolution:** What was done about it
- **Status:** Resolved / Temporary workaround / Unresolved

(If no problems were encountered, write "No problems encountered.")

## 4. Remaining Work / Limitations
- Things not done, and why
- Assumptions the agent made without asking the user
- Things that were not verified

## 5. Recommendations / Next Steps
- What should be done next, or what the user should check manually

## 6. How to Verify
(Commands or steps the user can run to confirm the work is correct.)
```

### Report writing guidelines
- Write so that someone who did not watch the agent work can understand it.
- Separate **facts** (verified) from **assumptions** (guessed).
- If a problem came up and could not be fixed, report it plainly. Do not hide or gloss over it.
- Include commit hashes in the table so work can be traced (`git log --oneline`).

---

## 5. When Problems Come Up

1. **Try to resolve it yourself first**, within reason, and note what you tried.
2. **If truly stuck**, stop and report instead of guessing repeatedly, especially when:
   - The task is ambiguous enough that you risk going in the wrong direction
   - You would have to delete or overwrite data that cannot be recovered
   - You need permissions or information you do not have
3. **Do not run dangerous commands without permission**, such as `git push --force`, `git reset --hard`, or bulk file deletion.
4. If one subtask fails, commit the subtasks that are already done, then list the unfinished work in the report.

---

## 6. Pre-Close Checklist

- [ ] Every completed subtask has its own commit
- [ ] No uncommitted leftovers (`git status` is clean)
- [ ] Every commit message is clear and understandable
- [ ] The report is complete in all sections and committed
- [ ] All problems and limitations are reported honestly