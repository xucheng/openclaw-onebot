# Release Runbook

This runbook covers the `openclaw-onebot` npm publication flow, GitHub releases, the `openclaw-onebot-plugin` ClawHub package/plugin listing, and the ClawHub skill.

## Release Target

- npm package: `openclaw-onebot`
- ClawHub package: `openclaw-onebot-plugin`
- OpenClaw runtime manifest id: `openclaw-onebot`
- OpenClaw channel id: `onebot`
- ClawHub skill slug: `openclaw-onebot`
- Current release line: `1.2.13`

Keep the distribution names and runtime id distinct. The npm package stays `openclaw-onebot` so users installed from `openclaw-onebot@1.2.x` can upgrade normally. The ClawHub package payload is `openclaw-onebot-plugin`. The runtime id is used by existing OpenClaw config keys such as `plugins.allow` and `plugins.entries`.

The ClawHub package staging script inlines JSON Schema references in `openclaw.plugin.json` because the ClawHub registry metadata store rejects `$`-prefixed object keys such as `$defs` and `$ref`.

## Preflight

Verify credentials before cutting a release:

```bash
gh auth status
clawhub whoami
npm whoami
```

Expected posture for a publish-capable environment:

- GitHub authenticated with `repo` scope
- ClawHub authenticated as the package and skill owner
- npm authenticated to the target publisher account

## Release Validation

Run the full local release gate:

```bash
npm ci --ignore-scripts
npm run release:check
```

That covers:

- `npm run build`
- `npm test`
- `npm pack --dry-run`
- `npm publish --dry-run`
- `npm run prepare:clawhub:package`
- `npm run prepare:clawhub:skill`

Staged outputs:

```text
.clawhub-plugin/openclaw-onebot-plugin/
.clawhub-skill/openclaw-onebot/
```

## npm Publish

The npm owner publishes first from the repository root:

```bash
npm publish --access public
```

Post-publish verification:

```bash
npm view openclaw-onebot version
```

## GitHub Release

After npm is published and the release commit is on `main`:

```bash
VERSION="$(node -p 'require("./package.json").version')"
TAG="v${VERSION}"
git tag "${TAG}"
git push origin main "${TAG}"
gh release create "${TAG}" --title "${TAG}" --notes-file "docs/releases/${TAG}.md"
```

Recommended release notes source: `docs/releases/v${VERSION}.md`.

## ClawHub Package Publish

Stage the package first:

```bash
npm run prepare:clawhub:package
```

Publish the staged package from the same Git tag:

```bash
VERSION="$(node -p 'require("./package.json").version')"
SHA="$(git rev-parse HEAD)"
clawhub package publish .clawhub-plugin/openclaw-onebot-plugin \
  --family code-plugin \
  --name openclaw-onebot-plugin \
  --display-name "OpenClaw OneBot Plugin" \
  --version "${VERSION}" \
  --source-repo xucheng/openclaw-onebot \
  --source-ref "v${VERSION}" \
  --source-commit "${SHA}" \
  --tags latest,openclaw,onebot,qq,napcat \
  --changelog "Require explicit allowFrom authorization for OneBot text commands, make CLI sync opt-in, disable group auto reactions by default, harden staged media permissions, and remove legacy peer dependency auto-installs."
```

## ClawHub Skill Publish

Stage the skill first:

```bash
npm run prepare:clawhub:skill
```

Publish the staged skill:

```bash
VERSION="$(node -p 'require("./package.json").version')"
clawhub publish .clawhub-skill/openclaw-onebot \
  --slug openclaw-onebot \
  --name "OpenClaw OneBot" \
  --version "${VERSION}" \
  --tags latest,openclaw,onebot,qq,napcat \
  --changelog "Document safer OneBot setup defaults, allowFrom command authorization, opt-in CLI sync, and the v1.2.13 verification flow."
```

## Post-Publish Checks

Verify the published artifacts resolve correctly:

```bash
npm view openclaw-onebot version
clawhub package inspect openclaw-onebot-plugin
clawhub inspect openclaw-onebot
openclaw --profile release-smoke plugins install clawhub:openclaw-onebot-plugin
openclaw --profile release-smoke skills install openclaw-onebot
```

## Release Notes Checklist

- `package.json`, `package-lock.json`, and `openclaw.plugin.json` carry the same version
- npm package name is `openclaw-onebot`
- ClawHub package payload name is `openclaw-onebot-plugin`
- runtime manifest id stays `openclaw-onebot`
- README and SKILL mention the current OpenClaw target version
- `channelConfigs` and `channelEnvVars` are present in `openclaw.plugin.json`
- local tests, npm dry-run, ClawHub staging, and mini smoke are green
