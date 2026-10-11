import { api } from "./client";
import type { ApiSettings } from "$types/api";

export const getSettings = (): Promise<ApiSettings> => api.getSettings();
export const putSettings = (settings: ApiSettings): Promise<ApiSettings> => api.putSettings(settings);
