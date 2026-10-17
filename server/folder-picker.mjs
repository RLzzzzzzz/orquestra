import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const folderDialogScript = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = 'Escolha uma pasta de trabalho para o Orquestra'",
  '$dialog.ShowNewFolderButton = $false',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
].join('; ');

export async function pickDirectory(platform = process.platform, run = execute) {
  if (platform !== 'win32') throw new Error('O seletor de pasta nativo está disponível somente no Windows.');
  // This is an explicitly user-invoked interactive dialog. Hiding the host process
  // can place the Windows picker behind the browser and leave the request pending.
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', folderDialogScript], { windowsHide: false, timeout: 60000, maxBuffer: 8192 });
  const path = String(stdout || '').trim();
  return { path: path || null };
}
