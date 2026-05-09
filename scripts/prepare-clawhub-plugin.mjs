import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const basePackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(repoRoot, "openclaw.plugin.json"), "utf8"));
const outputRoot = join(repoRoot, ".clawhub-plugin", "openclaw-onebot-plugin");

function dereferenceJsonSchema(schema) {
  const root = JSON.parse(JSON.stringify(schema));
  const definitions = root.$defs ?? root.definitions ?? {};

  const resolveRef = (ref) => {
    const defsPrefix = "#/$defs/";
    const definitionsPrefix = "#/definitions/";
    if (typeof ref !== "string") return undefined;
    if (ref.startsWith(defsPrefix)) return definitions[ref.slice(defsPrefix.length)];
    if (ref.startsWith(definitionsPrefix)) return definitions[ref.slice(definitionsPrefix.length)];
    return undefined;
  };

  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    if (value.$ref) {
      const target = resolveRef(value.$ref);
      const { $ref, ...rest } = value;
      if (target) return visit({ ...target, ...rest });
    }

    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$schema" || key === "$defs" || key === "definitions" || key.startsWith("$")) continue;
      output[key] = visit(child);
    }
    return output;
  };

  return visit(root);
}

function prepareClawHubManifest(sourceManifest) {
  const prepared = JSON.parse(JSON.stringify(sourceManifest));
  for (const config of Object.values(prepared.channelConfigs ?? {})) {
    if (config?.schema) config.schema = dereferenceJsonSchema(config.schema);
  }
  return prepared;
}

const releasePackage = {
  name: "openclaw-onebot-plugin",
  displayName: "OpenClaw OneBot Plugin",
  version: basePackage.version,
  description: basePackage.description,
  type: basePackage.type,
  main: basePackage.main,
  types: basePackage.types,
  repository: basePackage.repository,
  homepage: basePackage.homepage,
  bugs: basePackage.bugs,
  author: basePackage.author,
  license: basePackage.license,
  openclaw: basePackage.openclaw,
  dependencies: basePackage.dependencies,
  bundledDependencies: basePackage.bundledDependencies,
  bundleDependencies: basePackage.bundleDependencies,
  peerDependencies: basePackage.peerDependencies,
  peerDependenciesMeta: basePackage.peerDependenciesMeta,
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await cp(join(repoRoot, "dist"), join(outputRoot, "dist"), { recursive: true });
await cp(join(repoRoot, "scripts"), join(outputRoot, "scripts"), { recursive: true });
await cp(join(repoRoot, "LICENSE"), join(outputRoot, "LICENSE"));
await cp(join(repoRoot, "README.md"), join(outputRoot, "README.md"));

await writeFile(join(outputRoot, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`);
await writeFile(join(outputRoot, "openclaw.plugin.json"), `${JSON.stringify(prepareClawHubManifest(manifest), null, 2)}\n`);

const summary = {
  output: outputRoot,
  packageName: releasePackage.name,
  displayName: releasePackage.displayName,
  runtimeId: manifest.id,
  version: releasePackage.version,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
