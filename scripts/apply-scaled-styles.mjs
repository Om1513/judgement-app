// One-off codemod used while introducing src/utils/responsive.js.
//
// Every component kept its StyleSheet as a module-scope `StyleSheet.create({...})`
// of iPhone 17 Pro numbers. The responsive system wants that same object as a
// plain literal (`rawStyles`) so it can be scaled per viewport, plus a
// `useScaledStyles(rawStyles)` call at the top of the component. This performs
// exactly that rewrite; anything it cannot match confidently is left alone and
// reported so it can be done by hand.
//
// Kept in the repo rather than run and deleted: it documents the mechanical
// half of the migration, and re-running it is how a new component gets wired up.

import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);

for (const file of files) {
  let src = readFileSync(file, "utf8");
  const problems = [];

  if (src.includes("useScaledStyles")) {
    console.log(`skip   ${file} (already converted)`);
    continue;
  }

  // 1. StyleSheet.create({ ... }) at module scope -> plain object literal.
  const openMarker = "const styles = StyleSheet.create({";
  const open = src.indexOf(openMarker);
  if (open === -1) {
    console.log(`skip   ${file} (no module-scope StyleSheet.create)`);
    continue;
  }

  // Walk braces from the opening `{` to find the matching close, ignoring
  // braces inside strings and comments. Comments matter: these stylesheets are
  // heavily commented and an apostrophe in "doesn't" reads as an unterminated
  // string to a naive scanner.
  const bodyStart = open + openMarker.length - 1;
  let depth = 0;
  let end = -1;
  let quote = null;
  let comment = null; // "line" | "block"
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (comment === "line") {
      if (ch === "\n") comment = null;
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && next === "/") { comment = null; i++; }
      continue;
    }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") { comment = "line"; i++; }
    else if (ch === "/" && next === "*") { comment = "block"; i++; }
    else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1 || src.slice(end, end + 3) !== "});") {
    console.log(`SKIP   ${file} (could not find the closing "});")`);
    continue;
  }

  src =
    src.slice(0, open) +
    "const rawStyles = {" +
    src.slice(bodyStart + 1, end) +
    "};" +
    src.slice(end + 3);

  // 2. Import the hook, next to the existing relative imports.
  const importLine = `import { useScaledStyles } from "${file.includes("/screens/") ? "../utils/responsive" : "../utils/responsive"}";\n`;
  const lastImport = src.lastIndexOf("\nimport ");
  const lastImportEnd = src.indexOf("\n", src.indexOf(";", lastImport)) + 1;
  src = src.slice(0, lastImportEnd) + importLine + src.slice(lastImportEnd);

  // 3. `const styles = useScaledStyles(rawStyles);` as the first statement of
  //    the default-exported component.
  const fn = src.match(/export default function \w+\([^)]*\)\s*\{\n/);
  if (!fn) {
    problems.push("no `export default function` to insert the hook into");
  } else {
    const at = fn.index + fn[0].length;
    src = src.slice(0, at) + "  const styles = useScaledStyles(rawStyles);\n" + src.slice(at);
  }

  // 4. Drop a now-unused StyleSheet import.
  if (!/StyleSheet\./.test(src)) {
    src = src.replace(/^(import \{[^}]*)\bStyleSheet,\s*/m, "$1");
    src = src.replace(/^(import \{[^}]*),\s*StyleSheet(\s*\})/m, "$1$2");
  }

  writeFileSync(file, src);
  console.log(problems.length ? `PART   ${file}: ${problems.join("; ")}` : `ok     ${file}`);
}
