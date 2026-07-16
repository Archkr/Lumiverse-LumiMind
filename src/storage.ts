declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import { DEFAULT_SETTINGS, normalizeSettings, normalizeTimeline } from "./engine";
import type { ChatTimelineV1, LumiMindSettings } from "./types";

const SETTINGS_PATH = "global/settings.json";
const TIMELINE_DIR = "timelines";

function timelinePath(chatId: string): string {
  return `${TIMELINE_DIR}/${encodeURIComponent(chatId)}.json`;
}

export async function loadSettings(userId: string): Promise<LumiMindSettings> {
  const stored = await spindle.userStorage.getJson<unknown>(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS, userId });
  return normalizeSettings(stored);
}

export async function saveSettings(userId: string, patch: Partial<LumiMindSettings>): Promise<LumiMindSettings> {
  const current = await loadSettings(userId);
  const next = normalizeSettings({ ...current, ...patch });
  await spindle.userStorage.setJson(SETTINGS_PATH, next, { indent: 2, userId });
  return next;
}

export async function loadTimeline(chatId: string, userId: string): Promise<ChatTimelineV1> {
  const stored = await spindle.userStorage.getJson<unknown>(timelinePath(chatId), { fallback: null, userId });
  return normalizeTimeline(stored, chatId);
}

export async function saveTimeline(timeline: ChatTimelineV1, userId: string): Promise<void> {
  timeline.updatedAt = Date.now();
  await spindle.userStorage.setJson(timelinePath(timeline.chatId), timeline, { indent: 2, userId });
}

export async function deleteTimeline(chatId: string, userId: string): Promise<void> {
  await spindle.userStorage.delete(timelinePath(chatId), userId).catch(() => undefined);
}
