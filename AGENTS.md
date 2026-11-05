# Repository maintenance

- Read the relevant README and `personal-station/WORKFLOW.md` before changes.
- Canonical local checkout: `D:\Git\automation-portfolio`. The old `D:\Projects\personal-station` is a legacy local copy; do not develop both independently.
- Keep each change focused. Run the existing Python and Node checks and build before pushing; inspect GitHub Actions after pushing.
- Never commit databases, `.env`, subscriptions, tokens, private keys, personal server addresses or downloaded runtime binaries.
- Production deployment is separate from Git push. Upload to the incoming directory, then use the reviewed upgrade script. Preserve the live volume, proxy state and `.env`.
- Never claim a release is deployed until the live health version and data checks pass.
