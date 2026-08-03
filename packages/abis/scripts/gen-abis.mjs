// Regenerates src/*Abi.ts from the compiled Hardhat artifacts in
// packages/contracts. Run `pnpm gen:abis` (root) after changing the
// contracts — `pnpm --filter @lcai/contracts compile` first if needed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts → abis → packages → repo root
const repoRoot = path.resolve(here, "../../..");
const artifacts = path.join(repoRoot, "contracts/artifacts/contracts");
const out = path.resolve(here, "../src");

const map = {
  launchpad: path.join(artifacts, "Launchpad.sol/Launchpad.json"),
  token: path.join(artifacts, "Token.sol/Token.json"),
};

if (!fs.existsSync(artifacts)) {
  console.error(`Artifacts not found at ${artifacts}. Run \`pnpm --filter @lcai/contracts compile\` first.`);
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const names = [];
for (const [name, file] of Object.entries(map)) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const abiName = `${name}Abi`;
  names.push(abiName);
  fs.writeFileSync(
    path.join(out, `${abiName}.ts`),
    `// Auto-generated from contracts/artifacts by \`pnpm gen:abis\`. Do not edit.\n` +
    `export const ${abiName} = ${JSON.stringify(json.abi, null, 2)} as const;\n`,
  );
}
const manualExports = [
  "uniswapV2Router02Abi",
  "uniswapV2PairAbi",
];
fs.writeFileSync(
  path.join(out, "index.ts"),
  [
    ...names.map((a) => `export { ${a} } from "./${a}.js";`),
    ...manualExports.map((a) => `export { ${a} } from "./${a}.js";`),
  ].join("\n") + "\n",
);
console.log(`Wrote ${names.join(", ")} to ${out}`);
