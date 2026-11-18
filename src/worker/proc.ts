import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Taille max conservée par flux (on garde la fin, là où sont les erreurs) */
  maxBuffer?: number;
  signal?: AbortSignal;
  onStderrLine?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
}

/** Lance un binaire sans shell (aucune interpolation de commande) et capture ses sorties. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const max = opts.maxBuffer ?? 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;

    const append = (cur: string, chunk: string) => {
      const next = cur + chunk;
      return next.length > max ? next.slice(next.length - max) : next;
    };
    let pendingOut = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout = append(stdout, d);
      if (opts.onStdoutLine) {
        pendingOut += d;
        const lines = pendingOut.split(/\r|\n/);
        pendingOut = lines.pop() ?? "";
        for (const l of lines) if (l) opts.onStdoutLine(l);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr = append(stderr, d);
      if (opts.onStderrLine) {
        pendingLine += d;
        const lines = pendingLine.split(/\r|\n/);
        pendingLine = lines.pop() ?? "";
        for (const l of lines) if (l) opts.onStderrLine(l);
      }
    });

    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    };
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, opts.timeoutMs);
    }
    opts.signal?.addEventListener("abort", kill, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer ${cmd} : ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${cmd} a dépassé le délai de ${Math.round((opts.timeoutMs ?? 0) / 1000)} s`));
      resolve({ code, stdout, stderr });
    });
  });
}

/** Comme run(), mais lève une erreur lisible si le code de sortie n'est pas 0. */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    const tail = res.stderr.trim().split("\n").slice(-6).join("\n");
    throw new Error(`${cmd} a échoué (code ${res.code}) : ${tail || "aucune sortie"}`);
  }
  return res;
}

export function log(scope: string, message: string, extra?: unknown): void {
  const ts = new Date().toISOString().slice(11, 19);
  if (extra !== undefined) console.log(`${ts} [${scope}] ${message}`, extra);
  else console.log(`${ts} [${scope}] ${message}`);
}
