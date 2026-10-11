import type { ApiSettings } from "$types/api";
import { api } from "./client";

export const getSettings = (): Promise<ApiSettings> => api.getSettings();
export const putSettings = (settings: ApiSettings): Promise<ApiSettings> => api.putSettings(settings);
