import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

export async function appendText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, content, 'utf8');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}-${crypto.randomBytes(4).toString('hex')}`;
}

export function createAttemptId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function resolveRelative(baseDir: string, value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

