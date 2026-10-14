/** Match the initial xterm grid to the native PTY before any view is mounted.
 * Visible terminals still resize normally through their fit addon. */
export const INITIAL_TERMINAL_SIZE = { cols: 100, rows: 30 } as const;
