import { spawn, ChildProcess } from "child_process";

class TunnelManager {
  private process: ChildProcess | null = null;
  private url: string | null = null;
  private startingPromise: Promise<string> | null = null;
  private shouldRestart = true;
  private targetPort = parseInt(process.env.TUNNEL_PORT || "5173", 10);

  constructor() {
    process.on("exit", () => this.stopTunnel());
    process.on("SIGINT", () => this.stopTunnel());
    process.on("SIGTERM", () => this.stopTunnel());
  }

  public getTunnelUrl(): string | null {
    return this.url;
  }

  public isTunnelActive(): boolean {
    return Boolean(this.url && this.process && !this.process.killed);
  }

  public async startTunnel(port?: number): Promise<string> {
    if (port) this.targetPort = port;

    if (this.url && this.process && !this.process.killed) {
      return this.url;
    }

    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.shouldRestart = true;

    this.startingPromise = new Promise<string>((resolve, reject) => {
      console.log(`[TeleCloud Tunnel] Launching automated Cloudflare tunnel for http://localhost:${this.targetPort}...`);

      const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${this.targetPort}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.process = proc;

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.startingPromise = null;
          reject(new Error("Timeout waiting for Cloudflare tunnel URL"));
        }
      }, 25000);

      const onData = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          this.url = match[0];
          resolved = true;
          clearTimeout(timeout);
          this.startingPromise = null;
          console.log(`[TeleCloud Tunnel] Active public online URL: ${this.url}`);
          resolve(this.url);
        }
      };

      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);

      proc.on("error", (err) => {
        console.error("[TeleCloud Tunnel] Process error:", err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.startingPromise = null;
          reject(err);
        }
      });

      proc.on("exit", (code) => {
        console.log(`[TeleCloud Tunnel] Process exited with code ${code}`);
        this.url = null;
        this.process = null;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.startingPromise = null;
          reject(new Error(`Tunnel process exited with code ${code}`));
        } else if (this.shouldRestart) {
          console.log("[TeleCloud Tunnel] Reconnecting tunnel in 5 seconds...");
          setTimeout(() => {
            if (this.shouldRestart) {
              this.startTunnel().catch((e) => console.error("[TeleCloud Tunnel] Reconnect failed:", e));
            }
          }, 5000);
        }
      });
    });

    return this.startingPromise;
  }

  public stopTunnel(): void {
    this.shouldRestart = false;
    this.url = null;
    if (this.process) {
      try {
        this.process.kill();
      } catch {}
      this.process = null;
    }
    console.log("[TeleCloud Tunnel] Tunnel stopped.");
  }
}

export const tunnelManager = new TunnelManager();
