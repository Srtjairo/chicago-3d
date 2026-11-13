---
name: ship
description: Publish the Chicago 3D model - build, check, and (only after the user says "ship it") merge dev into main and push, which redeploys GitHub Pages.
---

# Ship sandbox → live 🚀

The only way changes reach https://srtjairo.github.io/chicago-3d/. Never skip a step.

## 1. What's going out
- `git fetch origin`, then `git log --oneline origin/main..dev` and `git diff --stat origin/main..dev`. Nothing differs → say so and stop.
- Uncommitted changes on `dev`? Ask whether they belong in this release.

## 2. Build + checks (all must pass, on `dev`)
- `node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/` regenerates `docs/` (never hand-edit it). Commit the rebuilt `docs/` on `dev`: `Build site for release`.
- `node tools/check.mjs`, `node tools/check-city.mjs`, `node tools/check-waterfront.mjs`, `node tools/check-sites.mjs`.
- Quick look at the built copy (http://127.0.0.1:8081/docs/) at desktop and phone size (`/tools/review.html`): it loads, no console errors.
Report as a short checklist. If anything fails, stop and say what to fix.

## 3. Approval
Summarize (commits, files, check results) and ask: **"Ship these changes to the live Chicago model?"** Continue only on a clear yes for this batch. Approval from earlier or for a different batch doesn't count.

## 4. Release
Create `.claude\ship-approved` in its **own** command (the guard hook checks before each command runs), then:
```
$git = "C:\Program Files\Git\cmd\git.exe"
& $git switch main
& $git pull --ff-only origin main
& $git merge --no-ff dev -m "Release: <short summary>"
& $git push origin main
& $git switch dev
& $git merge --ff-only main
Remove-Item ".claude\ship-approved"   # ALWAYS, even if a step failed
```
Any failure: stop, remove `.claude\ship-approved`, switch back to `dev`, and explain exactly what happened. Never force.

## 5. After
- Wait ~1 min, then check https://srtjairo.github.io/chicago-3d/revision.json matches the new `docs/revision.json`.
- Confirm: `🚀 Shipped the Chicago model: <summary>`. If the jairomora.com "Now" card or project text should change, say so (that is done from the website folder, not here).
- Rollback: `git revert -m 1 <release merge>` on dev, then ship again.
