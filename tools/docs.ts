import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

for (const [name, title] of [
  ["AGENT-PROTOCOL", "Agent protocol"],
  ["ARCHITECTURE", "Architecture"],
  ["REPORT", "Design report"],
  ["VERIFICATION", "Verification"],
]) {
  const output = `public/docs/${name.toLowerCase()}.html`;
  execFileSync("pandoc", [
    `docs/${name}.md`,
    "--standalone",
    "--no-highlight",
    "--template",
    "tools/docs.template",
    "--metadata",
    `title=${title}`,
    "-o",
    output,
  ]);
  const html = (await readFile(output, "utf8"))
    .replaceAll('href="VERIFICATION.md"', 'href="verification.html"')
    .replaceAll(
      'href="evidence/',
      'href="https://github.com/michaelcrosato/gpt61sol2daige/blob/main/docs/evidence/',
    );
  await writeFile(output, html);
}
console.log("Built four static documentation pages.");
