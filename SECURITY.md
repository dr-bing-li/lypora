# Security Policy

## Scope

Lypora is a local-first editor: it has no backend, no accounts, and it does not send your documents anywhere.
The realistic attack surface is therefore small, and limited to:

- the Electron shell (`desktop/`) — `preload` bridge, IPC handlers, file dialogs, the close-guard protocol;
- what the renderer does with untrusted input — rendering a `.md` file, a pasted image, an imported theme `.css`,
  a Mermaid diagram, or an HTML file produced by "export HTML";
- the build/packaging path (`tools/pack-win.mjs`) if you consume a release built by someone else.

Exported HTML is **not** sanitised for hostile content beyond what the editor itself needs; treat exported files
as you would treat the source document.

## Reporting

Please **do not** open a public issue for a vulnerability. Use either:

- GitHub's private reporting: **Security → Report a vulnerability** on this repository, or
- the email address listed on the maintainer's GitHub profile (`dr-bing-li`).

Include the version (Help → About shows it), the platform/build, and the smallest reproduction you can manage.
A proof-of-concept file is more useful than a description.

## What to expect

This is a hobby project maintained in someone's spare time, so there is no SLA. Realistic expectations:

| Stage | Typical timing |
|---|---|
| Acknowledgement | within ~7 days |
| Triage and a public note in the issue tracker | after the fix ships |
| Fix | best effort; trivial fixes are usually fast |

If a report is valid, the fix will be released and you will be credited in the release notes unless you ask not
to be.

## Out of scope

- Anything that requires an already-compromised machine, a malicious local Electron binary, or physical access.
- Missing hardening headers on a static host you configured yourself.
- Bugs that are merely crashes on malformed Markdown — send those as a normal [bug report](.github/ISSUE_TEMPLATE/bug_report.yml).
- Vulnerabilities in upstream dependencies (`electron`, `codemirror`, `katex`, …): please report them upstream and
  open an issue here only if this project needs to pin, patch or work around them.

---

# 安全策略（中文）

Lypora 是本地优先的编辑器：没有后端、没有账号，也不上传文档。真实攻击面很小，基本限于 Electron 外壳
（`preload` 桥、IPC、文件对话框、关窗协议）、渲染器对不可信输入的处理（打开 `.md`、粘贴图片、导入主题
`.css`、Mermaid、打开导出的 HTML），以及打包链路。导出的 HTML **不做**面向恶意内容的安全处理，请像对待
源文档一样对待导出物。

**报告方式**：不要开公开 issue。走仓库的 **Security → Report a vulnerability**，或发维护者（`dr-bing-li`）
GitHub 主页上的邮箱。请附版本（帮助 → 关于）、平台与最小复现；能跑的文件比文字描述有用。

**处理节奏**：业余项目，没有 SLA。大致是 7 天内确认、修复后公开说明、修复尽力而为；有效报告会在 release
notes 里署名（除非你要求匿名）。不在范围内：需要已失陷主机、被替换的 Electron 二进制或物理接触的问题；
你自己配置的静态托管缺安全头；畸形 Markdown 导致的崩溃（请按普通 bug 报告）；上游依赖的漏洞（请报给上游，
只有在需要本仓库 pin/绕过时再在这里开 issue）。
