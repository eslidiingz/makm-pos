<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product UI consistency — non-negotiable

MAKM POS must feel like one product across every surface. Login, password change,
Platform Owner dashboard, POS, future back-office pages, and all shared states
must use the same visual language and interaction patterns.

- Use one global typography family and hierarchy. Never introduce a page-level
  `font-family`; all form controls must inherit the global font.
- Reuse shared design tokens for color, spacing, radius, border, shadow,
  breakpoints, and motion instead of adding arbitrary values per page.
- Reuse shared components for buttons, inputs, cards, headers, account menus,
  loading, empty, error, and success states. The same component role must look
  and behave the same everywhere.
- Use `shadcn/ui` as the base layer for reusable UI components and keep the
  canonical customized components under `src/components/ui`. Treat shadcn as
  the accessibility and interaction foundation, not as the product's visual
  identity.
- Apply MAKM styling through shared tokens and centralized component variants.
  Do not ship default shadcn styling unchanged, duplicate a shadcn component
  per feature, or add one-off page variants when a shared variant is suitable.
- Prefer the shared `src/components/ui` component over raw form controls and
  ad-hoc cards/dialogs whenever an equivalent component exists.
- Preserve the MAKM visual identity: dark navy surfaces, warm red primary
  actions, amber emphasis, restrained motion, clear Thai typography, and
  mobile-first responsive behavior.
- Any UI change must be checked against the existing Login, Owner dashboard,
  and POS surfaces for typography, spacing rhythm, component consistency,
  responsive behavior, focus/hover/disabled states, and accessibility.
- If a new requirement conflicts with the established system, update the shared
  token/component first and apply the change consistently across all affected
  pages; do not create a one-off exception silently.

## Subagent delegation

The primary agent should proactively delegate to the project-local subagents in
`.codex/agents/` when the work matches one of the triggers below. Subagents do
not self-start; the primary agent remains responsible for choosing the smallest
useful set, integrating their findings, and delivering the final result.

- Use `code-mapper` before changing a cross-layer flow or an unfamiliar area.
- Use `api-designer` before designing or materially changing a public API
  contract.
- Use `ui-fixer` for a reproduced, localized UI defect. Use
  `browser-debugger` when browser evidence is needed to reproduce or diagnose a
  client-side problem.
- Use `accessibility-tester` after a material UI or interaction-flow change.
  Use `ux-researcher` when the task involves a new user flow, usability
  feedback, or information architecture—not for a purely cosmetic change.
- Use `security-auditor` before shipping changes to authentication,
  authorization, uploads, Supabase, Cloudflare/R2, secrets, or externally
  reachable APIs.
- Use `test-automator` after a bug fix or behavior change when targeted
  regression coverage is absent. Use `reviewer` before finishing a material
  feature, refactor, or security-sensitive change.
- Use `performance-engineer` for measured or reported performance problems,
  high-volume catalog/media work, or scalability decisions.
- Use `product-manager` for ambiguous feature scope, prioritization, or
  trade-off decisions.

Do not delegate for a trivial, single-file copy or styling edit unless the user
asks for review. Prefer one to three complementary subagents; run independent
read-only analysis in parallel where useful. Auditors and reviewers remain
read-only. Never delegate external deployment, data deletion, or other
irreversible actions without explicit user authorization.
