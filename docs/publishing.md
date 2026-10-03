# GitHub portfolio publication

This project can be reviewed and run without the owner's AI keys, local database, deployment account or paid services. A public repository exposes its source code; it does not expose ignored local secrets unless they were already committed to history.

## Before the first push

1. Run `npm ci` and `npm run check`.
2. Read `SECURITY.md` and the dated [dependency review](dependency-security.md).
3. Run `git status --short` and review `git diff` plus `git diff --cached`.
4. Confirm `.dev.vars`, `.env`, `.wrangler`, `.local`, `node_modules`, `dist`, and `.openai/hosting.json` are excluded. Only safe example configuration belongs in the repository.
5. Inspect existing commit history before publishing it. A file removed today can still exist in earlier commits. Revoke any credential that was ever committed.
6. Create an empty GitHub repository named `CryptoWorld` without automatically generating conflicting starter files.

For the first public release, prefer the verified clean source ZIP in the workspace's `outputs` folder. Extract it to a new directory and run the following commands **inside that extracted project**. This publishes only the reviewed source files, without transferring the existing local Git history. The original working repository and private files remain unchanged.

The public portfolio repository is [`ManosTsagkos/CryptoWorld`](https://github.com/ManosTsagkos/CryptoWorld). The original working directory has no remote by design: publication uses a separate clean export so its old local history and private state stay local. For another copy, use the actual URL of the repository you intend to update:

```bash
git init
git add .
git diff --cached --stat
git commit -m "Prepare CryptoWorld portfolio release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/CryptoWorld.git
git push -u origin main
```

Do not paste that placeholder URL unchanged. If updating an existing public repository instead, inspect its remote with `git remote -v` and review its history before pushing; do not run `git init` or add another remote blindly.

## Repository presentation

- Description: **Full-stack crypto intelligence dashboard with resilient public APIs, interactive charts, D1 credits and optional AI-assisted analysis.**
- Suggested topics: `typescript`, `react`, `cloudflare-workers`, `threejs`, `crypto-dashboard`, `portfolio-project`.
- Keep the actual application screenshot and reviewer walkthrough linked from the README.
- Pin this repository beside the first portfolio project.
- Do not claim real subscription billing, authenticated accounts, verified trading returns or a public deployment until those capabilities exist.

The project intentionally leaves its license unselected. Choose an appropriate license before advertising it as an open-source project.
