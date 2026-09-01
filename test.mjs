import fs from "fs/promises";
import path from "path";

async function run() {
  const elaraRoot = process.cwd();
  const fullPath = path.join(elaraRoot, "skills");
  const files = await fs.readdir(fullPath, { withFileTypes: true, recursive: true });
  console.log(files);
}
run();
