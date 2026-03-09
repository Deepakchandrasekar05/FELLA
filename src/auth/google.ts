// auth/google.ts — Google OAuth via Supabase + local HTTP callback server

import { createServer }              from 'node:http';
import { exec }                      from 'node:child_process';
import { readFileSync, existsSync }  from 'node:fs';
import { resolve, dirname }          from 'node:path';
import { fileURLToPath }             from 'node:url';
import { supabase, saveAuthToken }   from './client.js';

// ── Resolve page.png (works in both dev and caxa .exe) ────────────────────────
const _dir = dirname(fileURLToPath(import.meta.url));
const IMAGE_PATH = [
  resolve(_dir, 'assets', 'page.png'),            // dist/assets/  (bundled exe)
  resolve(_dir, '..', '..', 'assets', 'page.png'), // src/auth/ → project root (dev)
  resolve(process.cwd(), 'assets', 'page.png'),    // cwd fallback
].find(existsSync) ?? null;

const CALLBACK_PORT = 54321;
const CALLBACK_URL  = `http://localhost:${CALLBACK_PORT}`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>FELLA — Logged in</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: sans-serif; display: flex; flex-direction: column;
             justify-content: center; align-items: center; min-height: 100vh;
             background: #0d1117; color: #e6edf3; gap: 2rem; padding: 2rem; }
      img  { max-width: 480px; width: 100%; border-radius: 16px;
             box-shadow: 0 8px 32px rgba(0,0,0,0.6); border: 1px solid #30363d; }
      .card { text-align: center; padding: 2rem 3rem; border: 1px solid #30363d;
              border-radius: 12px; background: #161b22; }
      h1 { color: #3fa5d4; margin-bottom: 0.5rem; }
      p  { color: #8b949e; }
    </style>
  </head>
  <body>
    <img src="/page.png" alt="FELLA" />
    <div class="card">
      <h1>&#10003; Logged in to FELLA</h1>
      <p>You can close this tab and return to your terminal.</p>
    </div>
  </body>
</html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html>
  <head><title>FELLA — Login failed</title></head>
  <body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:flex;
               justify-content:center;align-items:center;height:100vh;margin:0;">
    <div style="text-align:center">
      <h1 style="color:#f85149">Login failed</h1>
      <p>${msg}</p>
      <p>You can close this tab and try again.</p>
    </div>
  </body>
</html>`;

/** Open a URL in the default browser cross-platform. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32'  ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd);
}

/**
 * Log in with Google OAuth.
 *
 * - Starts a local HTTP server on port 54321 to receive the OAuth callback.
 * - Opens the browser at the Supabase Google login URL.
 * - Exchanges the auth code for a session, persists it, and returns the email.
 *
 * @throws if the login times out (2 min) or the OAuth exchange fails.
 */
export async function loginWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    // ── 1. Local callback server ────────────────────────────────────────────
    const server = createServer(async (req, res) => {
      // Only handle the root callback path
      if (!req.url) {
        res.writeHead(400).end(ERROR_HTML('Missing request URL.'));
        return;
      }

      const reqUrl = new URL(req.url, CALLBACK_URL);

      // ── Serve the page image asset ────────────────────────────────────────
      if (reqUrl.pathname === '/page.png') {
        if (IMAGE_PATH) {
          const img = readFileSync(IMAGE_PATH);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': img.length }).end(img);
        } else {
          res.writeHead(404).end();
        }
        return;
      }

      // Supabase may send back an error directly
      const oauthError = reqUrl.searchParams.get('error');
      if (oauthError) {
        const desc = reqUrl.searchParams.get('error_description') ?? oauthError;
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML(desc));
        server.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML('No auth code received.'));
        server.close();
        reject(new Error('No auth code received from OAuth provider'));
        return;
      }

      // ── 2. Exchange code for session ──────────────────────────────────────
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.session) {
        const msg = error?.message ?? 'Session exchange failed';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML(msg));
        server.close();
        reject(new Error(msg));
        return;
      }

      // ── 3. Persist session & respond ──────────────────────────────────────
      saveAuthToken({
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token ?? '',
        email:        data.session.user?.email   ?? '',
        userId:       data.session.user?.id      ?? '',
        expiresAt:    Date.now() + (data.session.expires_in ?? 3600) * 1000,
      });
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
      // Delay close so the browser can fetch /page.png on the same server
      setTimeout(() => server.close(), 3000);
      resolve(data.session.user?.email ?? '(unknown)');
    });

    // ── 4. Start server, then open browser ──────────────────────────────────
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close the conflicting process and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options:  { redirectTo: CALLBACK_URL },
      });

      if (error || !data.url) {
        server.close();
        reject(new Error(error?.message ?? 'Failed to generate Google OAuth URL'));
        return;
      }

      console.log('\n  Opening browser for Google login…');
      console.log('  If the browser does not open automatically, visit:\n');
      console.log(' ', data.url, '\n');
      openBrowser(data.url);
    });

    // ── 5. Timeout guard ─────────────────────────────────────────────────────
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Google login timed out after 2 minutes'));
    }, 120_000);

    // Clear timeout if the server closes cleanly
    server.on('close', () => clearTimeout(timeout));
  });
}
