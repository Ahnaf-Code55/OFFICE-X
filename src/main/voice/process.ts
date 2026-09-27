import { spawn } from 'node:child_process';

/** Run a fixed local voice binary without a shell or inherited interactive stdin. */
export function runVoiceCommand(
  command: string,
  args: string[],
  options: { stdin?: string; timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let diagnostics = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('voice engine timed out'));
    }, options.timeoutMs ?? 120_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => {
        if (diagnostics.length < 8_192) diagnostics += chunk.toString('utf8').slice(0, 8_192 - diagnostics.length);
      });
    }
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`voice engine exited ${code ?? signal ?? 'unknown'}: ${diagnostics.slice(-500)}`));
    });
    child.stdin.on('error', () => { /* a failed child reports its own exit/error */ });
    child.stdin.end(options.stdin ?? '');
  });
}
