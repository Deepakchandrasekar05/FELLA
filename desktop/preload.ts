// desktop/preload.ts — Secure IPC bridge between renderer and main process
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fella', {
  /** Send a command to the FELLA engine and get a response. */
  command: (text: string): Promise<{ success: boolean; response: string; steps?: unknown[] }> =>
    ipcRenderer.invoke('fella:command', text),

  /** Toggle the input window visibility. */
  toggleInput: (): Promise<void> => ipcRenderer.invoke('fella:toggle-input'),

  /** Close the input window. */
  closeInput: (): Promise<void> => ipcRenderer.invoke('fella:close-input'),

  /** Get current engine state. */
  getState: (): Promise<{ engineReady: boolean }> => ipcRenderer.invoke('fella:get-state'),

  /** Listen for state changes from the main process. */
  onState: (cb: (state: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: string) => cb(state);
    ipcRenderer.on('fella:state', handler);
    return () => { ipcRenderer.removeListener('fella:state', handler); };
  },

  /** Listen for step updates during command execution. */
  onStep: (cb: (step: { tool: string; success: boolean }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, step: { tool: string; success: boolean }) => cb(step);
    ipcRenderer.on('fella:step', handler);
    return () => { ipcRenderer.removeListener('fella:step', handler); };
  },
});
