import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "../../web/node_modules/typescript/lib/typescript.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const webRoot = path.join(repoRoot, "web");
const cacheRoot = path.join(repoRoot, "tests", ".compiled-web-tests");

function ensureTsPath(sourcePath) {
  const candidates = [
    sourcePath,
    `${sourcePath}.ts`,
    `${sourcePath}.tsx`,
    path.join(sourcePath, "index.ts"),
    path.join(sourcePath, "index.tsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveSourceSpecifier(specifier, importerPath) {
  if (specifier.startsWith("@/")) {
    return ensureTsPath(path.join(webRoot, specifier.slice(2)));
  }
  if (specifier.startsWith(".")) {
    return ensureTsPath(path.resolve(path.dirname(importerPath), specifier));
  }
  return null;
}

async function compileModule(sourcePath, seen = new Map()) {
  const resolved = path.resolve(sourcePath);
  if (seen.has(resolved)) {
    return seen.get(resolved);
  }

  const relativePath = path.relative(webRoot, resolved).replace(/\.(ts|tsx)$/, ".mjs");
  const outputPath = path.join(cacheRoot, relativePath);
  seen.set(resolved, outputPath);

  const source = await fsp.readFile(resolved, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: resolved,
  }).outputText;

  let rewritten = transpiled;
  const importSpecifiers = [
    ...transpiled.matchAll(/from\s+["']([^"']+)["']/g),
    ...transpiled.matchAll(/import\(["']([^"']+)["']\)/g),
  ].map((match) => match[1]);

  for (const specifier of importSpecifiers) {
    const dependencySource = resolveSourceSpecifier(specifier, resolved);
    if (!dependencySource) {
      continue;
    }
    const dependencyOutput = await compileModule(dependencySource, seen);
    const relativeImport = path
      .relative(path.dirname(outputPath), dependencyOutput)
      .replace(/\\/g, "/");
    const normalized = relativeImport.startsWith(".") ? relativeImport : `./${relativeImport}`;
    rewritten = rewritten.replaceAll(specifier, normalized);
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, rewritten, "utf8");
  return outputPath;
}

export async function importWebModule(modulePathFromWebRoot) {
  const sourcePath = path.join(webRoot, modulePathFromWebRoot);
  const compiledPath = await compileModule(sourcePath);
  return import(pathToFileURL(compiledPath).href);
}
