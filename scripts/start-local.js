const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

console.log("\n==========================================");
console.log("   🚀 Launching TeleCloud Locally");
console.log("   Permanent SSD Database & 0 Bandwidth Caps");
console.log("==========================================\n");

// 1. Start Backend
console.log("[1/2] Starting backend on http://localhost:4000...");
const backend = spawn("npm", ["run", "dev"], {
  cwd: backendDir,
  stdio: "inherit",
  shell: true,
});

// 2. Start Frontend
console.log("[2/2] Starting frontend on http://localhost:5173...");
const frontend = spawn("npm", ["run", "dev"], {
  cwd: frontendDir,
  stdio: "inherit",
  shell: true,
});

// Helper to open browser automatically
function openBrowser() {
  const url = "http://localhost:5173";
  const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(start, [url], { shell: true });
}

// Check when frontend is ready, then open browser
let opened = false;
const checkInterval = setInterval(() => {
  const req = http.get("http://localhost:5173", () => {
    if (!opened) {
      opened = true;
      clearInterval(checkInterval);
      console.log("\n✨ TeleCloud is live! Opening browser...");
      console.log("👉 Laptop Web UI: http://localhost:5173");
      openBrowser();
    }
  });
  req.on("error", () => {});
}, 800);

// Graceful cleanup on Ctrl+C / exit
function cleanup() {
  console.log("\nStopping TeleCloud...");
  clearInterval(checkInterval);
  try { backend.kill("SIGTERM"); } catch {}
  try { frontend.kill("SIGTERM"); } catch {}
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
