---
name: preview
description: Open the Chicago 3D sandbox - serve the dev branch locally (source on http://127.0.0.1:8080, built docs/ on 8081). Local only.
---

# Preview the sandbox (local only)

1. Make sure `dev` is checked out: `& "C:\Program Files\Git\cmd\git.exe" branch --show-current`. If it's `main`, `git switch dev` (stash or ask if there are uncommitted changes).
2. Source: if port 8080 isn't already answering, run `node tools/serve.mjs 8080` in the background. It binds to 127.0.0.1, so only this computer can open it.
3. Open http://127.0.0.1:8080 (Start-Process). To see the public build, run `node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/`, serve on 8081 and open http://127.0.0.1:8081/docs/.
4. For phone sizing, landmark views and frame-time checks use `/tools/review.html`.
5. Never push `dev`.

Reply in one line: `🧪 Chicago sandbox running at http://127.0.0.1:8080 (this computer only)`.
