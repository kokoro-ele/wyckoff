import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface PersistedLlmSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  webSearch?: boolean;
}

export interface RuntimeSettingsFile {
  version: 1;
  llm?: PersistedLlmSettings;
}

const persistedLlmSettingsSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(8192).optional(),
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      })
      .optional(),
    model: z.string().trim().min(1).max(200).optional(),
    webSearch: z.boolean().optional(),
  })
  .strict();

const runtimeSettingsFileSchema = z
  .object({
    version: z.literal(1),
    llm: persistedLlmSettingsSchema.optional(),
  })
  .strict();

export function loadRuntimeSettings(filePath: string): RuntimeSettingsFile {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw error;
  }
  return runtimeSettingsFileSchema.parse(JSON.parse(text) as unknown);
}

/**
 * 以同目录临时文件 + rename 原子替换，避免进程中断留下半截 JSON。
 * 文件无论首次创建还是覆盖，最终权限都强制为仅当前用户可读写。
 */
export function saveRuntimeSettings(filePath: string, settings: RuntimeSettingsFile): void {
  const parsed = runtimeSettingsFileSchema.parse(settings);
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, filePath);
    chmodSync(filePath, 0o600);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // rename 成功后临时路径本就不存在；失败路径上的清理也仅做 best effort。
    }
  }
}
