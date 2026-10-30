# Contributing

Short version: **small, self-contained fixes are welcome; large rewrites are not.** This codebase was built by
iterating on AI output, so it is consistent in behaviour and inconsistent in structure. Pulling one thread
usually reveals three others, and a "proper" rewrite is a different project.

## Good pull requests / 受欢迎的 PR

- A reproducible bug fix, with a sentence on how you verified it (`core/verify.mjs` has 15 scripted steps —
  adding one is often the cheapest proof).
- Export fidelity, KaTeX/Mermaid rendering, table or list editing edge cases, IME handling.
- Documentation that is wrong, unclear, or out of date (bilingual: `README.md` carries both languages).
- Small performance wins with numbers attached.

## Please do not submit / 请不要提交

- **Typora theme files, icons, fonts, screenshots or code snippets.** Third-party themes may carry their own
  licences; we have no right to redistribute them. See `docs/05-开源合规说明.md`.
- Vendored dependencies or generated bundles (`release/`, `artifacts/`, `core/dist/`, `core/src/io/katex-inline.ts`).
- Wholesale reformatting of a file (it makes review impossible and hides real changes).
- Feature-parity arguments of the form "Typora does X, so Lypora must". Lypora is deliberately a smaller,
  temporary tool; scope creep is the main way projects like this die.

## Before opening a PR / 提 PR 前

```bash
cd core
npm run typecheck                 # tsc --noEmit
npm run build
npx vite preview --port 4173 &    # then:
node verify.mjs                   # 15 assertions, should end with errors: []
```

If your change touches export or printing, also run `node export-check.mjs`.
Windows shell changes: `node tools/closetest.mjs --exe`.

Commit messages: a one-line summary in the imperative mood, then why (not what). Chinese or English both fine.

## Licence of contributions / 贡献的许可证

By submitting a pull request you agree that your contribution is licensed under the project's
[MIT licence](LICENSE), and that you have the right to submit it — i.e. it is your own work, or it comes from a
source whose licence permits this use and is recorded in `THIRD-PARTY-NOTICES.md`.
