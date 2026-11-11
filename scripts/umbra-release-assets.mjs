// Package a signed Apple silicon build for Umbra's GitHub release.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [bundle, output] = process.argv.slice(2);
if (!bundle || !output) throw new Error("Usage: node scripts/umbra-release-assets.mjs <macOS bundle dir> <release output dir>");
const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const app = join(bundle, "Umbra.app");
const tar = join(bundle, "Umbra.app.tar.gz");
const plist = join(app, "Contents", "Info.plist");
for (const [key, expected] of Object.entries({
  CFBundleIdentifier: "com.raphaelbenjamin.umbra",
  CFBundleExecutable: "umbra",
  CFBundleShortVersionString: config.version,
})) {
  const actual = execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" }).trim();
  if (actual !== expected) throw new Error(`${key} is ${actual}, expected ${expected}`);
}
const signature = readFileSync(tar + ".sig", "utf8").trim();
if (!signature) throw new Error("The Umbra updater archive has no signature.");
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
mkdirSync(output, { recursive: true });
const tag = `v${config.version}`;
const archive = "Umbra_aarch64.app.tar.gz";
copyFileSync(tar, join(output, archive));
copyFileSync(tar + ".sig", join(output, archive + ".sig"));
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(output, "Umbra-for-Apple-Silicon.zip")], { stdio: "inherit" });
const manifest = {
  version: config.version,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature,
      url: `https://github.com/raphaelbenjamin/umbra/releases/download/${tag}/${archive}`,
    },
  },
};
writeFileSync(join(output, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
