import { check, type Update } from '@tauri-apps/plugin-updater';

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  /** Resolves once the update is downloaded and installed. The app must be relaunched after. */
  installAndRelaunch: () => Promise<void>;
}

/** Check for an update once. Resolves to null when up to date or the manifest is unreachable. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const update: Update | null = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? null,
      installAndRelaunch: async () => {
        await update.downloadAndInstall();
      },
    };
  } catch (err) {
    console.warn('updater check failed:', err);
    return null;
  }
}
