"use strict";

const fs = require("node:fs");
const path = require("node:path");

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function transformEsmToCommonJs(source, filename) {
  let code = String(source || "");
  const appendedExports = [];
  code = code.replace(
    /import\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["'];?/g,
    (_match, names, specifier) => `const { ${names.trim()} } = require(${JSON.stringify(specifier)});`,
  );
  code = code.replace(
    /export\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["'];?/g,
    (_match, names, specifier) => `Object.assign(exports, (({ ${names.trim()} }) => ({ ${names.trim()} }))(require(${JSON.stringify(specifier)})));`,
  );
  code = code.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, "const $1 = exports.$1 =");
  code = code.replace(/export\s+let\s+([A-Za-z_$][\w$]*)\s*=/g, "let $1 = exports.$1 =");
  code = code.replace(/export\s+var\s+([A-Za-z_$][\w$]*)\s*=/g, "var $1 = exports.$1 =");
  code = code.replace(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_match, name) => {
    appendedExports.push(`exports.${name} = ${name};`);
    return `async function ${name}(`;
  });
  code = code.replace(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_match, name) => {
    appendedExports.push(`exports.${name} = ${name};`);
    return `function ${name}(`;
  });
  code = code.replace(/export\s*\{\s*([^}]+?)\s*\};?/g, (_match, names) => {
    const assignments = names
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!match) throw new Error(`Unsupported export syntax in ${filename}: ${part}`);
        return `exports.${match[2] || match[1]} = ${match[1]};`;
      });
    return assignments.join("\n");
  });
  if (appendedExports.length > 0) {
    code += `\n${appendedExports.join("\n")}\n`;
  }
  if (String(filename || "").replace(/\\/g, "/").endsWith("portable-host-request-compat.js")) {
    code = code.replace(
      "return globalThis.window?.electronBridge ?? null;",
      "return globalThis.window?.__codexppPortableElectronBridge ?? globalThis.window?.electronBridge ?? null;",
    );
    code = code.replace(
      "const bridge = globalThis.window?.electronBridge;",
      "const bridge = globalThis.window?.__codexppPortableElectronBridge ?? globalThis.window?.electronBridge;",
    );
  }
  return code;
}

function createPortableModuleRuntime(options = {}) {
  const rootDir = path.resolve(options.rootDir || "");
  if (!rootDir) throw new Error("portable module rootDir is required.");
  const externals = options.externals || {};
  const cache = new Map();

  function resolveModule(specifier, parentFilename = "") {
    const normalized = trimString(specifier);
    if (!normalized) throw new Error("Empty portable module specifier.");
    if (!normalized.startsWith(".")) return normalized;
    const baseDir = parentFilename ? path.dirname(parentFilename) : rootDir;
    const resolved = path.resolve(baseDir, normalized);
    return path.extname(resolved) ? resolved : `${resolved}.js`;
  }

  function requirePortable(specifier, parentFilename = "") {
    const resolved = resolveModule(specifier, parentFilename);
    if (Object.prototype.hasOwnProperty.call(externals, resolved)) return externals[resolved];
    if (Object.prototype.hasOwnProperty.call(externals, specifier)) return externals[specifier];
    const relativeToRoot = path.relative(rootDir, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Portable module outside root: ${specifier}`);
    }
    if (cache.has(resolved)) return cache.get(resolved).exports;

    const module = { exports: {} };
    cache.set(resolved, module);
    const source = fs.readFileSync(resolved, "utf8");
    const code = transformEsmToCommonJs(source, resolved);
    const localRequire = (nextSpecifier) => requirePortable(nextSpecifier, resolved);
    const fn = new Function("module", "exports", "require", `${code}\n//# sourceURL=${resolved.replace(/\\/g, "/")}`);
    fn(module, module.exports, localRequire);
    return module.exports;
  }

  return {
    require: (specifier) => requirePortable(specifier, ""),
    requireFile: (filename) => requirePortable(path.resolve(rootDir, filename), ""),
    clear() {
      cache.clear();
    },
  };
}

module.exports = {
  createPortableModuleRuntime,
  transformEsmToCommonJs,
};
