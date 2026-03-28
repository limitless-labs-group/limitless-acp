import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "..");
export const CONFIG_JSON_PATH = path.resolve(ROOT, "config.json");

export interface ConfigJson {
  SESSION_TOKEN?: { token: string };
  LITE_AGENT_API_KEY?: string;
  SELLER_PID?: number;
  ACP_BUILDER_CODE?: string;
}

export function readConfig(): ConfigJson {
  if (!fs.existsSync(CONFIG_JSON_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function writeConfig(config: ConfigJson): void {
  try {
    fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    console.error(`Failed to write config.json: ${err}`);
  }
}

export function loadApiKey(): string | undefined {
  if (process.env.LITE_AGENT_API_KEY?.trim()) {
    return process.env.LITE_AGENT_API_KEY.trim();
  }
  const config = readConfig();
  const key = config.LITE_AGENT_API_KEY;
  if (typeof key === "string" && key.trim()) {
    process.env.LITE_AGENT_API_KEY = key;
    return key;
  }
  return undefined;
}

export function loadBuilderCode(): string | undefined {
  if (process.env.ACP_BUILDER_CODE?.trim()) {
    return process.env.ACP_BUILDER_CODE.trim();
  }
  const config = readConfig();
  const code = config.ACP_BUILDER_CODE;
  if (typeof code === "string" && code.trim()) {
    process.env.ACP_BUILDER_CODE = code;
    return code;
  }
  return undefined;
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function writePidToConfig(pid: number): void {
  const config = readConfig();
  config.SELLER_PID = pid;
  writeConfig(config);
}

export function removePidFromConfig(): void {
  try {
    const config = readConfig();
    if (config.SELLER_PID !== undefined) {
      delete config.SELLER_PID;
      writeConfig(config);
    }
  } catch {
    // best-effort cleanup
  }
}

export function checkForExistingProcess(): void {
  const config = readConfig();
  if (config.SELLER_PID !== undefined) {
    if (isProcessRunning(config.SELLER_PID)) {
      console.error(
        `Seller process already running with PID: ${config.SELLER_PID}`,
      );
      console.error("Stop the existing process before starting a new one.");
      process.exit(1);
    } else {
      removePidFromConfig();
    }
  }
}
