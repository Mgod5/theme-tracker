import { ReplitConnectors } from "@replit/connectors-sdk";
import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";
import { log } from "./index";

const WORKSPACE = process.cwd();
const OWNER = "Mgod5";
const REPO = "theme-tracker";
const BRANCH = "main";

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".local", "dist", ".cache",
  "scripts", "attached_assets",
]);

let syncInProgress = false;
let lastSyncAt: Date | null = null;
let lastSyncStatus: "success" | "error" | null = null;

function collectFiles(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    if (entry.startsWith(".") && entry !== ".env.example") continue;
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      collectFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function ghApi(connectors: ReplitConnectors, path: string, options: RequestInit = {}) {
  const res = await connectors.proxy("github", path, options);
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (res.status >= 400) {
    throw new Error(`GitHub API ${res.status} for ${path}: ${JSON.stringify(body)}`);
  }
  return body;
}

export function getSyncStatus() {
  return { syncInProgress, lastSyncAt, lastSyncStatus };
}

export async function syncToGitHub(): Promise<{ files: number }> {
  if (syncInProgress) {
    log("GitHub sync already in progress, skipping", "github");
    return { files: 0 };
  }
  syncInProgress = true;
  log("Starting GitHub sync...", "github");

  try {
    const connectors = new ReplitConnectors();

    // Get current HEAD SHA and tree SHA
    const refData = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    const headSha: string = refData.object.sha;
    const commitData = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
    const baseTreeSha: string = commitData.tree.sha;

    // Collect all project files
    const allFiles = collectFiles(WORKSPACE);
    log(`Syncing ${allFiles.length} files to GitHub...`, "github");

    // Create blobs for each file
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

    for (const filePath of allFiles) {
      const relPath = relative(WORKSPACE, filePath);
      let blob: any;
      try {
        const content = readFileSync(filePath, "utf8");
        blob = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/blobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, encoding: "utf-8" }),
        });
      } catch {
        const content = readFileSync(filePath).toString("base64");
        blob = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/blobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, encoding: "base64" }),
        });
      }
      treeItems.push({ path: relPath, mode: "100644", type: "blob", sha: blob.sha });
    }

    // Create new tree based on existing one
    const tree = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });

    // Create commit
    const now = new Date().toISOString();
    const commit = await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `sync: auto-update ${now}`,
        tree: tree.sha,
        parents: [headSha],
      }),
    });

    // Update branch ref
    await ghApi(connectors, `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.sha }),
    });

    lastSyncAt = new Date();
    lastSyncStatus = "success";
    log(`GitHub sync complete: ${allFiles.length} files → commit ${commit.sha.slice(0, 7)}`, "github");
    return { files: allFiles.length };
  } catch (err: any) {
    lastSyncStatus = "error";
    log(`GitHub sync failed: ${err.message}`, "github");
    throw err;
  } finally {
    syncInProgress = false;
  }
}
