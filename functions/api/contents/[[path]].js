// 管理画面からのデータ読み書きを GitHub に中継する Cloudflare Pages Function。
// GitHub トークンはサーバー側（環境変数 GITHUB_TOKEN）だけに置き、利用者のブラウザには渡さない。
// 呼び出し元は Cloudflare Access のログイン済みユーザーに限る（JWT を検証する）。
//
// 必要な環境変数（Cloudflare Pages の「変数とシークレット」で設定）:
//   GITHUB_TOKEN        … ag-events リポジトリの Contents に Read and write 権限を持つトークン（シークレット）
//   ACCESS_TEAM_DOMAIN  … Zero Trust のチームドメイン（例: example.cloudflareaccess.com）
//   ACCESS_AUD          … Access アプリケーションの AUD タグ
// 任意:
//   GITHUB_REPO         … 既定 "OMEGAAA/ag-events"
//   GITHUB_BRANCH       … 既定 "main"

const ALLOWED_FILES = new Set(['events.json', 'archived_events.json', 'reports.json']);
const GITHUB_API = 'https://api.github.com';
const CERTS_TTL_MS = 60 * 60 * 1000;

let certCache = { domain: '', keys: null, fetchedAt: 0 };

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

function b64urlToBytes(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function b64urlToJson(s) {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getAccessKeys(teamDomain, force = false) {
    const fresh = certCache.domain === teamDomain && certCache.keys && Date.now() - certCache.fetchedAt < CERTS_TTL_MS;
    if (fresh && !force) return certCache.keys;
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access certs ${res.status}`);
    const { keys } = await res.json();
    certCache = { domain: teamDomain, keys: keys || [], fetchedAt: Date.now() };
    return certCache.keys;
}

function getCookie(request, name) {
    const cookie = request.headers.get('Cookie') || '';
    for (const part of cookie.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return '';
}

// 検証できたら JWT のペイロードを、できなければ null を返す
export async function verifyAccessJwt(token, env) {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    let header, payload;
    try {
        header = b64urlToJson(parts[0]);
        payload = b64urlToJson(parts[1]);
    } catch {
        return null;
    }
    if (header.alg !== 'RS256' || !header.kid) return null;

    let keys = await getAccessKeys(env.ACCESS_TEAM_DOMAIN);
    let jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) {
        keys = await getAccessKeys(env.ACCESS_TEAM_DOMAIN, true);
        jwk = keys.find(k => k.kid === header.kid);
    }
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
        'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
    return payload;
}

// 共通の前処理: 設定・ログイン・対象ファイルを確認する。問題があれば Response を返す
async function prepare(context) {
    const { request, env, params } = context;
    if (!env.GITHUB_TOKEN || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
        return { error: json({ message: 'サーバーの設定（GITHUB_TOKEN / ACCESS_TEAM_DOMAIN / ACCESS_AUD）が未完了です。管理者に連絡してください。' }, 500) };
    }

    const token = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
    let user = null;
    try {
        user = await verifyAccessJwt(token, env);
    } catch {
        return { error: json({ message: 'ログイン情報を確認できませんでした。時間をおいて再試行してください。' }, 503) };
    }
    if (!user || !user.email) {
        return { error: json({ message: 'ログインの有効期限が切れています。ページを再読み込みしてログインし直してください。' }, 401) };
    }

    const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
    if (!ALLOWED_FILES.has(path)) {
        return { error: json({ message: 'このファイルは扱えません。' }, 404) };
    }

    const repo = env.GITHUB_REPO || 'OMEGAAA/ag-events';
    const branch = env.GITHUB_BRANCH || 'main';
    return {
        user,
        path,
        branch,
        url: `${GITHUB_API}/repos/${repo}/contents/${path}`,
        headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'ag-events-admin',
        },
    };
}

// GitHub 側のエラーを、管理画面向けの状態コードとメッセージに変換する
async function githubError(res) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
        return json({ message: 'サーバーのGitHubトークンが無効か、権限が足りません。管理者に連絡してください。' }, 502);
    }
    if (res.status === 404 || res.status === 409 || res.status === 422) {
        return json({ message: err.message || '' }, res.status);
    }
    return json({ message: `GitHubとの通信に失敗しました（${res.status}）` }, 502);
}

export async function onRequestGet(context) {
    const ctx = await prepare(context);
    if (ctx.error) return ctx.error;

    const res = await fetch(`${ctx.url}?ref=${encodeURIComponent(ctx.branch)}`, { headers: ctx.headers });
    if (!res.ok) return githubError(res);
    const data = await res.json();
    return json({ sha: data.sha, content: data.content, encoding: data.encoding });
}

export async function onRequestPut(context) {
    const ctx = await prepare(context);
    if (ctx.error) return ctx.error;

    let body;
    try {
        body = await context.request.json();
    } catch {
        return json({ message: '送信データの形式が正しくありません。' }, 400);
    }
    if (typeof body.content !== 'string' || !body.content) {
        return json({ message: '送信データの形式が正しくありません。' }, 400);
    }
    const baseMessage = typeof body.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, 200)
        : `${ctx.path} 更新`;

    const payload = {
        // リポジトリが公開でもメールアドレス全体が出ないよう、@より前だけを記録する
        message: `${baseMessage}（${ctx.user.email.split('@')[0]}）`,
        content: body.content,
        branch: ctx.branch,
    };
    if (typeof body.sha === 'string' && body.sha) payload.sha = body.sha;

    const res = await fetch(ctx.url, {
        method: 'PUT',
        headers: { ...ctx.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) return githubError(res);
    const data = await res.json();
    return json({ content: { sha: data.content.sha } });
}
