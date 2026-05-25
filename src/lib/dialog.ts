import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

export async function pickFileToOpen(): Promise<string | null> {
  const choice = await openDialog({
    multiple: false,
    directory: false,
  });
  if (typeof choice === 'string') return choice;
  // For multiple: false the API can also return null when the user cancels.
  return null;
}

export async function pickFileToSave(defaultPath?: string | null): Promise<string | null> {
  const choice = await saveDialog({
    defaultPath: defaultPath ?? undefined,
  });
  return typeof choice === 'string' ? choice : null;
}
