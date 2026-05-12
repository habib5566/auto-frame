/**
 * Shared scan logic for local Node server and Vercel serverless (`api/scan.js`).
 * @see scripts/go-live-audit-server.js — static file server + this core
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

/** Corporate proxy / MITM: set GO_LIVE_AUDIT_TLS_INSECURE=1 only if you accept MITM risk for outbound scans. */
const HTTPS_AGENT =
  process.env.GO_LIVE_AUDIT_TLS_INSECURE === '1'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true;
  if (h === '::1') return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.endsWith('.internal')) return true;
  return false;
}

function fetchUrl(targetUrl, maxRedirects = 5, opts = {}) {
  const timeoutMs =
    opts && typeof opts === 'object' && opts.timeoutMs != null ? Number(opts.timeoutMs) : 18_000;
  return new Promise((resolve, reject) => {
    const tryOnce = (urlStr, redirectsLeft) => {
      let u;
      try {
        u = new URL(urlStr);
      } catch (e) {
        reject(new Error('Invalid URL'));
        return;
      }
      if (!/^https?:$/i.test(u.protocol)) {
        reject(new Error('Only http and https URLs are allowed'));
        return;
      }
      if (isBlockedHost(u.hostname)) {
        reject(new Error('That host is not allowed for scan (private/local).'));
        return;
      }

      const lib = u.protocol === 'https:' ? https : http;
      const requestOpts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Automation-Framework-GoLiveAudit/1.0',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
        timeout: timeoutMs,
      };
      if (u.protocol === 'https:' && HTTPS_AGENT) requestOpts.agent = HTTPS_AGENT;

      const req = lib.request(requestOpts, (res) => {
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && redirectsLeft > 0) {
          const next = new URL(loc, u).href;
          res.resume();
          tryOnce(next, redirectsLeft - 1);
          return;
        }

        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const maxBytes = 1_500_000;
          const body = buf.slice(0, maxBytes).toString('utf8');
          const ct = String(res.headers['content-type'] || '').split(';')[0].trim();
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            finalUrl: u.href,
            body,
            contentType: ct,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', reject);
      req.end();
    };

    tryOnce(targetUrl, maxRedirects);
  });
}

/**
 * When fetchUrl throws — classify for UI (DNS down vs refused vs timeout vs TLS).
 */
function classifyAvailabilityError(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || err || '');
  const lower = msg.toLowerCase();

  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    lower.includes('getaddrinfo') ||
    lower.includes('enotfound')
  ) {
    return {
      state: 'dns_failed',
      headline: 'Hostname does not resolve (DNS)',
      detail:
        'The domain name could not be resolved. The site may be misconfigured, expired, or offline.',
      code,
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      state: 'connection_refused',
      headline: 'Connection refused — server likely down or port closed',
      detail:
        'Nothing accepted the connection. The web server may be stopped, or a firewall is blocking access.',
      code,
    };
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    lower.includes('timeout') ||
    msg === 'Request timeout'
  ) {
    return {
      state: 'timeout',
      headline: 'Timed out — site may be down or overloaded',
      detail:
        'No response before the deadline. The origin may be offline, saturated, or blocking this scanner.',
      code,
    };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return {
      state: 'connection_reset',
      headline: 'Connection reset by remote host',
      detail: 'The other side closed the connection — unstable network or protective edge device.',
      code,
    };
  }
  if (/certificate|ssl|tls|unable to verify|cert/i.test(msg)) {
    return {
      state: 'tls_error',
      headline: 'TLS / certificate verification failed',
      detail:
        msg +
        ' On trusted networks you may try GO_LIVE_AUDIT_TLS_INSECURE=1 (understand MITM risk first).',
      code,
    };
  }

  return {
    state: 'unreachable',
    headline: 'Cannot reach this URL',
    detail: msg || 'Unknown network error.',
    code,
  };
}

/** After a response is received — interpret HTTP status for “up vs server error”. */
function summarizeHttpAvailability(statusCode, finalUrl) {
  const sc = Number(statusCode) || 0;
  const urlShort = finalUrl || '';

  if (sc >= 200 && sc < 300) {
    return {
      state: 'up',
      headline: 'Site is up — response received',
      detail: `HTTP ${sc} from ${urlShort}`,
    };
  }
  if (sc >= 500) {
    return {
      state: 'server_error',
      headline: 'Remote server error (site may be down or broken)',
      detail: `HTTP ${sc} — the origin returned a server error. Users may see errors or downtime.`,
    };
  }
  if (sc === 404) {
    return {
      state: 'page_not_found',
      headline: 'Host responded — this page was not found',
      detail: `HTTP 404 — server is reachable but this path does not exist.`,
    };
  }
  if (sc >= 400) {
    return {
      state: 'client_error',
      headline: 'HTTP error (request rejected)',
      detail: `HTTP ${sc} — the server rejected this request (check URL, auth, or redirects).`,
    };
  }
  if (sc >= 300 && sc < 400) {
    return {
      state: 'redirect_only',
      headline: 'Unusual final HTTP status after redirects',
      detail: `HTTP ${sc} — verify redirect configuration.`,
    };
  }
  return {
    state: 'unknown_http',
    headline: 'Unexpected HTTP status',
    detail: `HTTP ${sc}`,
  };
}

/**
 * Plain-language rollup for the UI: is this URL broadly OK or problematic from one-page scan + checklist counts.
 */
function buildOverallSummary({
  reachable,
  availability,
  statusCode,
  autoChecks,
  scanWarnings,
  html,
}) {
  const counts = { pass: 0, fail: 0, pending: 0, notScored: 0 };
  for (const ac of autoChecks || []) {
    if (!ac || !ac.status) continue;
    if (ac.status === 'pass') counts.pass += 1;
    else if (ac.status === 'fail') counts.fail += 1;
    else if (ac.status === 'na') counts.notScored += 1;
    else counts.pending += 1;
  }

  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';

  const contentFlags =
    html &&
    (html.loremIpsumDetected ||
      html.comingSoonDetected ||
      html.placeholderPhrasesDetected);

  if (!reachable) {
    return {
      level: 'bad',
      headline: 'Overall: scan could not finish',
      subline:
        'The site did not load like a normal visit — check DNS, TLS, firewall, or whether hosting is down.',
      counts,
    };
  }

  if (sc >= 500 || avState === 'server_error') {
    return {
      level: 'bad',
      headline: 'Overall: serious availability risk',
      subline: `HTTP ${sc || '5xx'} from the server — users may see errors until this is fixed.`,
      counts,
    };
  }

  if (sc === 404 || (sc >= 400 && sc < 500)) {
    return {
      level: 'concern',
      headline: 'Overall: URL or access problem',
      subline:
        sc === 404
          ? 'This exact path returned 404 — wrong link or page missing.'
          : `HTTP ${sc} — request was rejected (auth, blocking, or bad URL).`,
      counts,
    };
  }

  if (counts.fail >= 2) {
    return {
      level: 'concern',
      headline: 'Overall: multiple automated failures',
      subline: `${counts.fail} checklist rows failed — review Fail items before go-live.`,
      counts,
    };
  }

  if (counts.fail === 1) {
    return {
      level: 'caution',
      headline: 'Overall: one automated failure',
      subline: 'Fix or verify the failing row — do not treat the site as fully cleared yet.',
      counts,
    };
  }

  if (scanWarnings && scanWarnings.length > 0) {
    return {
      level: 'caution',
      headline: 'Overall: mostly OK — scan warnings',
      subline: 'No failing rows, but warnings below need a quick read before release.',
      counts,
    };
  }

  if (contentFlags) {
    return {
      level: 'caution',
      headline: 'Overall: quality flags on this page',
      subline:
        'Placeholder / “coming soon” / lorem-style text detected — clean up before customer-facing go-live.',
      counts,
    };
  }

  if (avState === 'redirect_only' || avState === 'unknown_http') {
    return {
      level: 'caution',
      headline: 'Overall: double-check HTTP behaviour',
      subline: availability && availability.detail ? availability.detail : 'Confirm redirects and final status.',
      counts,
    };
  }

  const pendingHint =
    counts.pending > 0
      ? ` About ${counts.pending} rows are “needs check” (manual QA) — normal for this automated pass.`
      : '';

  return {
    level: 'good',
    headline: 'Overall: site scan looks healthy',
    subline:
      `Page responded (${sc}), no automated checklist failures.${pendingHint}`.trim(),
    counts,
  };
}

function analyzeHtml(body, finalUrl, contentTypeHeader) {
  const lower = body.toLowerCase();
  const telCount = (body.match(/\bhref\s*=\s*["']tel:/gi) || []).length;
  const mailtoCount = (body.match(/\bhref\s*=\s*["']mailto:/gi) || []).length;
  const formCount = (body.match(/<form\b/gi) || []).length;
  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(body);
  const hasCharset =
    /<meta[^>]+charset\s*=/i.test(body) || /charset\s*=\s*["'][^"']+["']/i.test(body);
  const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
  const ogTitleMatch = body.match(
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i
  );
  const title = (titleMatch ? titleMatch[1].trim() : '') || (ogTitleMatch ? ogTitleMatch[1].trim() : '');
  const metaDesc =
    (body.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] ||
    (body.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] ||
    '';
  const favicon =
    /<link[^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["']/i.test(body) ||
    /<link[^>]+href\s*=\s*["'][^"']*favicon/i.test(body);
  const robotsMeta =
    /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*(noindex|nofollow)/i.test(body) ||
    /<meta[^>]+content\s*=\s*["'][^"']*(noindex|nofollow)[^"']*["'][^>]+name\s*=\s*["']robots["']/i.test(body);
  const zendesk =
    /zendesk/i.test(body) && (/zdassets|ekr\.zendesk|static\.zdassets/i.test(body) || /zendesk.*widget/i.test(lower));
  const lorem = /\blorem\s+ipsum\b/i.test(body);
  const comingSoon = /\bcoming\s+soon\b/i.test(lower);
  const placeholderText =
    /\bplaceholder\s+text\b/i.test(lower) ||
    /\btodo:\b/i.test(lower) ||
    /\bdummy\s+content\b/i.test(lower);
  const imgTags = body.match(/<img\b[^>]*>/gi) || [];
  let emptyAlt = 0;
  for (const t of imgTags) {
    if (/\salt\s*=\s*["']["']/i.test(t) || !/\salt\s*=/i.test(t)) emptyAlt += 1;
  }
  const hasHttps = /^https:/i.test(finalUrl);
  const isHtmlish =
    /html|text\/plain/i.test(String(contentTypeHeader || '')) || /<html[\s>]/i.test(body.slice(0, 2000));

  const mailtoEmails = new Set();
  const mailtoRe = /\bhref\s*=\s*["']mailto:([^"'>\s]+)/gi;
  let mm;
  while ((mm = mailtoRe.exec(body)) !== null) {
    try {
      mailtoEmails.add(decodeURIComponent(mm[1].split('?')[0]).toLowerCase());
    } catch {
      mailtoEmails.add(mm[1].split('?')[0].toLowerCase());
    }
  }
  const mailtoUniqueCount = mailtoEmails.size;

  const formHasRequiredAttr = /<(?:input|textarea|select)[^>]+\brequired\b/i.test(body);

  let internalLinkCount = 0;
  try {
    const originHost = new URL(finalUrl).hostname;
    const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let hm;
    while ((hm = hrefRe.exec(body)) !== null) {
      const href = hm[1].trim();
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
      try {
        const u = new URL(href, finalUrl);
        if (u.hostname === originHost) internalLinkCount++;
      } catch {
        if (/^\//.test(href) || /^\.\.?\//.test(href)) internalLinkCount++;
      }
    }
  } catch {
    internalLinkCount = 0;
  }

  const logoLikely =
    /<header[^>]*>[\s\S]{0,15000}<img[^>]+>/i.test(body) ||
    /role\s*=\s*["']banner["'][\s\S]{0,15000}<img[^>]+>/i.test(body);

  const modernImageExt = /\.(webp|avif)(\?|#|"|'|$)/i.test(body);

  const legalLinkHints = /href\s*=\s*["'][^"']*(privacy|terms|legal|cookie-policy|cookies)[^"']*["']/i.test(
    body
  );

  const ssrHints =
    /__NEXT_DATA__|data-server-rendered|ng-version|data-reactroot|hydrateRoot/i.test(body);

  const buttonCount = (body.match(/<button\b/gi) || []).length;
  const anchorHrefCount = (body.match(/<a\s[^>]*href\s*=/gi) || []).length;
  const interactiveApprox = buttonCount + anchorHrefCount;

  return {
    isHtmlDocument: isHtmlish,
    hasHttps,
    telCount,
    mailtoCount,
    mailtoUniqueCount,
    formCount,
    formHasRequiredAttr,
    internalLinkCount,
    logoLikely,
    modernImageExt,
    legalLinkHints,
    ssrHints,
    interactiveApprox,
    hasViewport,
    hasCharset,
    titleLength: title.length,
    hasTitle: title.length > 0,
    metaDescriptionLength: metaDesc.trim().length,
    hasMetaDescription: metaDesc.trim().length > 0,
    hasFaviconLink: favicon,
    robotsMetaNoindex: robotsMeta,
    zendeskSnippetDetected: zendesk,
    loremIpsumDetected: lorem,
    comingSoonDetected: comingSoon,
    placeholderPhrasesDetected: placeholderText,
    imageTags: imgTags.length,
    imagesMissingOrEmptyAlt: emptyAlt,
  };
}

/** Must stay in sync with go-live-audit/public/index.html ITEMS[].id order. */
const CHECKLIST_IDS = [
  'C01',
  'F01',
  'F02',
  'F03',
  'F04',
  'E01',
  'E02',
  'E03',
  'S01',
  'S02',
  'SEO1',
  'R01',
  'U01',
  'U02',
  'U03',
  'U04',
  'Z01',
  'Z02',
  'C02',
  'C03',
  'M01',
  'M02',
  'P01',
  'P02',
  'P03',
  'B01',
  'L01',
  'L02',
  'L03',
  'L04',
  'L05',
  'I01',
  'I02',
  'I03',
  'I04',
];

function securityHeaderScore(headersLower) {
  let n = 0;
  if (headersLower['strict-transport-security']) n++;
  if (headersLower['x-content-type-options']) n++;
  if (headersLower['x-frame-options']) n++;
  if (headersLower['content-security-policy']) n++;
  if (headersLower['referrer-policy']) n++;
  return n;
}

function headersToLower(headers) {
  const hLow = {};
  for (const k of Object.keys(headers || {})) hLow[String(k).toLowerCase()] = headers[k];
  return hLow;
}

function normalizeUrlForCompare(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    let p = x.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    x.pathname = p || '/';
    return x.href;
  } catch {
    return u;
  }
}

function buildAutoChecks(requestedUrl, finalUrl, statusCode, headers, html, robotsInfo, bodySlice) {
  const hLow = headersToLower(headers);
  const secScore = securityHeaderScore(hLow);
  const xRobots = String(hLow['x-robots-tag'] || '').toLowerCase();
  const xRobotsNoindex = xRobots.includes('noindex');
  const headerNofollow = xRobots.includes('nofollow');
  const indexSignal = xRobotsNoindex || headerNofollow || html.robotsMetaNoindex;

  const trackHit = /googletagmanager|gtag\(|google-analytics|facebook\.net\/tr|clarity\.ms/i.test(
    bodySlice || ''
  );

  const scanWarnings = [];
  if (!html.isHtmlDocument && statusCode === 200) {
    scanWarnings.push({
      message: `Response may not be HTML (Content-Type: ${html._contentType || 'unknown'}). Might be an SPA or empty shell — automated signals are limited.`,
    });
  }

  const dummy =
    html.loremIpsumDetected || html.comingSoonDetected || html.placeholderPhrasesDetected;

  const mParts = [];
  if (html.hasTitle) mParts.push('title OK');
  else mParts.push('title missing/empty');
  if (html.hasMetaDescription) mParts.push('meta description OK');
  else mParts.push('meta description missing');
  if (html.hasFaviconLink) mParts.push('favicon link OK');
  else mParts.push('favicon link not detected');
  let m01status = 'pending';
  if (!html.hasTitle) m01status = 'fail';
  else if (html.hasTitle && html.hasMetaDescription && html.hasFaviconLink) m01status = 'pass';

  const redirected = normalizeUrlForCompare(requestedUrl) !== normalizeUrlForCompare(finalUrl);

  /** @type {Map<string, { id: string, status: string, note: string }>} */
  const byId = new Map();

  byId.set('I01', {
    id: 'I01',
    status: html.hasHttps ? 'pass' : 'fail',
    note: html.hasHttps
      ? '[auto] Final URL uses HTTPS.'
      : '[auto] Final URL is not HTTPS — fix SSL / enforce HTTPS.',
  });

  byId.set('SEO1', {
    id: 'SEO1',
    status: indexSignal ? 'pass' : 'pending',
    note: indexSignal
      ? '[auto] noindex/nofollow signal found (meta robots and/or X-Robots-Tag). Confirm with your release policy / approver.'
      : '[auto] No clear noindex/nofollow on this page — confirm staging vs production policy.',
  });

  byId.set('M01', { id: 'M01', status: m01status, note: `[auto] ${mParts.join('; ')}.` });

  byId.set('E03', {
    id: 'E03',
    status: html.telCount > 0 ? 'pass' : 'pending',
    note:
      html.telCount > 0
        ? `[auto] Found ${html.telCount} tel: link(s).`
        : '[auto] No tel: links in this HTML — check contact/footer or other pages.',
  });

  const mailtoU = html.mailtoUniqueCount != null ? html.mailtoUniqueCount : 0;
  let e01status = 'pending';
  let e01note = `[auto] ~${mailtoU} unique mailto: target(s) — confirm one approved email is used sitewide.`;
  if (mailtoU === 1) {
    e01status = 'pass';
    e01note = '[auto] Single mailto: pattern on this page — likely consistent (verify other pages).';
  } else if (mailtoU === 0) {
    e01note = '[auto] No mailto: link in this HTML — check email CTAs on other pages.';
  }

  byId.set('E01', { id: 'E01', status: e01status, note: e01note });

  let e02status = 'pending';
  let e02note = `[auto] ${html.telCount} tel: link(s) — confirm one approved phone number is used sitewide.`;
  if (html.telCount === 1) {
    e02status = 'pass';
    e02note = '[auto] One tel: link on this page — likely consistent (verify other pages).';
  } else if (html.telCount === 0) {
    e02note = '[auto] No tel: link in this HTML — check phone in content/footer on other pages.';
  }

  byId.set('E02', { id: 'E02', status: e02status, note: e02note });

  byId.set('C01', {
    id: 'C01',
    status: dummy ? 'fail' : 'pass',
    note: dummy
      ? '[auto] Flagged lorem / “coming soon” / placeholder-style text (this page only).'
      : '[auto] No common dummy phrases on this page (full-site crawl not performed).',
  });

  let u03status = 'pending';
  let u03note =
    '[auto] No <img> tags in this HTML snapshot — confirm images render as expected (other routes / lazy load).';
  if (html.imageTags > 0) {
    if (html.imagesMissingOrEmptyAlt === 0) {
      u03status = 'pass';
      u03note = `[auto] ${html.imageTags} <img> tag(s); rough alt check passed (decorative images may false-positive).`;
    } else {
      u03status = 'fail';
      u03note = `[auto] ~${html.imagesMissingOrEmptyAlt}/${html.imageTags} images missing or empty alt — fix or mark decorative images appropriately.`;
    }
  }

  byId.set('U03', { id: 'U03', status: u03status, note: u03note });

  byId.set('Z01', {
    id: 'Z01',
    status: 'pending',
    note: html.zendeskSnippetDetected
      ? '[auto] Zendesk-like snippet detected — exercise the widget manually.'
      : '[auto] No Zendesk snippet in this HTML (may load lazily). Still verify chat on live site.',
  });

  byId.set('Z02', {
    id: 'Z02',
    status: 'pending',
    note: html.zendeskSnippetDetected
      ? '[auto] Popup/widget behaviour requires manual QA.'
      : '[auto] Popup/widget not confirmed from this scrape — verify on production.',
  });

  if (html.formCount > 0) {
    const formWhere =
      (html._deepPagesSampled || 0) > 0
        ? `across the start URL plus ${html._deepPagesSampled} linked same-origin page sample(s) (not exhaustive)`
        : 'on this URL';
    byId.set('F01', {
      id: 'F01',
      status: 'pending',
      note:
        `[auto] Found ${html.formCount} <form> element(s) ${formWhere} — the scanner does not submit forms.\n` +
        'Next: on staging or production, submit each form with realistic data; confirm thank-you/error behaviour; add Pass/Fail + evidence below.',
    });
    byId.set('F02', {
      id: 'F02',
      status: html.formHasRequiredAttr ? 'pass' : 'pending',
      note: html.formHasRequiredAttr
        ? '[auto] Some HTML5 “required” attributes present — review remaining validation rules manually.\nNext: try empty submit, wrong formats, max length — match behaviour to spec.'
        : '[auto] No obvious HTML5 required attributes — validation rules need manual review.\nNext: test required fields, formats, and error messages against requirements.',
    });
    byId.set('F03', {
      id: 'F03',
      status: 'pending',
      note:
        '[auto] Sanitization / abuse resistance — not fuzz-tested by this scan.\n' +
        'Next: in staging only, try invalid or unexpected input; confirm server rejects or escapes per policy.',
    });
    byId.set('F04', {
      id: 'F04',
      status: 'pending',
      note:
        '[auto] Delivery to inbox/CRM/API — not verified by this scan.\n' +
        'Next: send test submissions; confirm recipient, fields, and automation — then Pass/Fail with proof.',
    });
  } else {
    const nf =
      '[auto] No <form> on this URL — forms may exist on other routes only.';
    byId.set('F01', { id: 'F01', status: 'pending', note: nf });
    byId.set('F02', { id: 'F02', status: 'pending', note: nf });
    byId.set('F03', { id: 'F03', status: 'pending', note: nf });
    byId.set('F04', { id: 'F04', status: 'pending', note: nf });
  }

  byId.set('L05', {
    id: 'L05',
    status: 'pass',
    note: redirected
      ? `[auto] Redirect chain OK: ${requestedUrl} → ${finalUrl}`
      : '[auto] Request URL matches final URL (no extra redirect seen in this chain).',
  });

  if (robotsInfo.fetched && robotsInfo.status === 200) {
    byId.set('I02', {
      id: 'I02',
      status: robotsInfo.hasSitemapLine ? 'pass' : 'pending',
      note: robotsInfo.hasSitemapLine
        ? '[auto] robots.txt present with a Sitemap: line.'
        : '[auto] robots.txt returned 200 but Sitemap: line missing or unclear — verify.',
    });
  } else {
    byId.set('I02', {
      id: 'I02',
      status: 'pending',
      note: `[auto] robots.txt: ${robotsInfo.error || 'not fetched or non-OK HTTP status'}`,
    });
  }

  byId.set('I03', {
    id: 'I03',
    status: trackHit ? 'pass' : 'pending',
    note: trackHit
      ? '[auto] Common tracking strings (GTM/GA/Clarity-like) found — verify tags fire correctly in the browser.'
      : '[auto] No common tracking strings in this HTML slice — tags may load from another bundle; verify manually.',
  });

  let s01status = 'pending';
  let s01note = `[auto] ~${secScore}/5 common security headers seen (HSTS, XCTO, XFO, CSP, Referrer-Policy).`;
  if (secScore >= 3) {
    s01status = 'pass';
    s01note = `[auto] Strong security header coverage (${secScore}) — full penetration test still recommended separately.`;
  } else if (secScore === 0 && html.hasHttps) {
    s01status = 'fail';
    s01note = '[auto] HTTPS served but few or no common security headers detected — review server configuration.';
  }

  byId.set('S01', { id: 'S01', status: s01status, note: s01note });

  byId.set('S02', {
    id: 'S02',
    status: 'pending',
    note: html.ssrHints
      ? '[auto] SSR / framework markers detected — confirm rendering approach matches requirements.'
      : '[auto] No obvious SSR markers — confirm SPA vs SSR architecture with your team.',
  });

  byId.set('R01', {
    id: 'R01',
    status: html.hasViewport ? 'pass' : 'fail',
    note: html.hasViewport
      ? '[auto] viewport meta tag present — still test on real devices.'
      : '[auto] Missing viewport meta — high risk for mobile layout.',
  });

  byId.set('U01', {
    id: 'U01',
    status: html.interactiveApprox > 0 ? 'pending' : 'fail',
    note:
      html.interactiveApprox > 0
        ? `[auto] ~${html.interactiveApprox} buttons/links — exercise clicks and routing manually or with Playwright.`
        : '[auto] Very few interactive elements in HTML — verify content loaded as expected.',
  });

  byId.set('U02', {
    id: 'U02',
    status: 'pending',
    note:
      html.internalLinkCount > 0
        ? `[auto] ~${html.internalLinkCount} internal href hints — broken-link crawl not run.`
        : '[auto] Few or no internal links in this HTML — review navigation, mega-menus, or JS routing.',
  });

  byId.set('U04', {
    id: 'U04',
    status: 'pending',
    note: '[auto] Typography — design QA only; scan cannot measure type scale sitewide.',
  });

  byId.set('C02', {
    id: 'C02',
    status: 'pending',
    note: '[auto] CTA behaviour — exercise paths manually or with Playwright.',
  });

  const c03HasContact = mailtoU > 0 || html.telCount > 0;
  byId.set('C03', {
    id: 'C03',
    status: 'pending',
    note: c03HasContact
      ? '[auto] mailto/tel present — verify contact details match everywhere on the site.'
      : '[auto] No mailto/tel in this HTML — review contact sections on other pages.',
  });

  byId.set('M02', {
    id: 'M02',
    status: html.logoLikely ? 'pass' : 'pending',
    note: html.logoLikely
      ? '[auto] Image near header/banner region — confirm branding and link targets manually.'
      : '[auto] Logo/header image pattern not clear from this HTML — verify manually.',
  });

  byId.set('P01', {
    id: 'P01',
    status: 'pending',
    note: '[auto] Run Lighthouse/WebPageTest separately — not part of this automated site scan.',
  });

  byId.set('P02', {
    id: 'P02',
    status: html.modernImageExt ? 'pass' : 'pending',
    note: html.modernImageExt
      ? '[auto] webp/avif references found — review remaining assets separately.'
      : '[auto] No obvious webp/avif references — verify compression pipeline.',
  });

  byId.set('P03', {
    id: 'P03',
    status: 'pending',
    note: '[auto] Broken images / CLS — requires runtime QA or Playwright.',
  });

  byId.set('B01', {
    id: 'B01',
    status: 'pending',
    note: '[auto] Cross-browser matrix — Playwright projects or manual browsers.',
  });

  const layoutNa =
    '[auto] Layout / spacing — visual QA only (single-page snapshot).';
  byId.set('L01', { id: 'L01', status: 'pending', note: layoutNa });
  byId.set('L02', {
    id: 'L02',
    status: 'pending',
    note: '[auto] Header/footer across all templates — check multiple pages manually.',
  });
  byId.set('L03', {
    id: 'L03',
    status: 'pending',
    note: html.legalLinkHints
      ? '[auto] Privacy/terms/legal href hints found — confirm pages and copy.'
      : '[auto] No clear legal page links in this HTML — verify Privacy/Terms exist where required.',
  });
  byId.set('L04', {
    id: 'L04',
    status: 'pending',
    note: '[auto] Thank-you and error flows — manual testing.',
  });

  byId.set('I04', {
    id: 'I04',
    status: 'pending',
    note: '[auto] CRM / chat / email integrations — manual verification.',
  });

  const autoChecks = CHECKLIST_IDS.map((id) => {
    const row = byId.get(id);
    if (row) return row;
    return {
      id,
      status: 'pending',
      note: '[auto] No automated signal mapped — complete manually.',
    };
  });

  return { autoChecks, scanWarnings };
}

const DEEPSCAN_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|mp4|webm|json)(\?|#|$)/i;

/**
 * Collect up to `max` same-origin page URLs from HTML (excludes start URL, mailto/tel, obvious assets).
 * @param {string} finalUrl
 * @param {string} body
 * @param {number} max
 * @returns {string[]}
 */
function collectSameOriginPageUrls(finalUrl, body, max) {
  const out = [];
  const seen = new Set();
  try {
    const origin = new URL(finalUrl);
    const originHost = origin.hostname;
    const mainKey = origin.href.split('#')[0];
    seen.add(mainKey);

    const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let hm;
    while ((hm = hrefRe.exec(body)) !== null && out.length < max) {
      const href = hm[1].trim();
      if (
        !href ||
        href.startsWith('#') ||
        /^javascript:/i.test(href) ||
        /^mailto:/i.test(href) ||
        /^tel:/i.test(href)
      ) {
        continue;
      }
      if (DEEPSCAN_ASSET_EXT.test(href)) continue;
      let abs;
      try {
        abs = new URL(href, finalUrl);
      } catch {
        continue;
      }
      if (abs.hostname !== originHost) continue;
      if (!/^https?:$/i.test(abs.protocol)) continue;
      const key = abs.href.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  } catch {
    /* noop */
  }
  return out;
}

/**
 * @param {string[]} bodies
 * @returns {{ mailtoUniqueCount: number; mailtoCount: number }}
 */
function countMailtoAcrossBodies(bodies) {
  const mailtoEmails = new Set();
  let mailtoCount = 0;
  const mailtoRe = /\bhref\s*=\s*["']mailto:([^"'>\s]+)/gi;
  for (const raw of bodies) {
    const b = String(raw || '');
    mailtoCount += (b.match(/\bhref\s*=\s*["']mailto:/gi) || []).length;
    let mm;
    mailtoRe.lastIndex = 0;
    while ((mm = mailtoRe.exec(b)) !== null) {
      try {
        mailtoEmails.add(decodeURIComponent(mm[1].split('?')[0]).toLowerCase());
      } catch {
        mailtoEmails.add(mm[1].split('?')[0].toLowerCase());
      }
    }
  }
  return { mailtoUniqueCount: mailtoEmails.size, mailtoCount };
}

/**
 * Merge primary `analyzeHtml` result with additional same-origin pages (sampled GETs).
 * @param {Record<string, unknown>} primary
 * @param {string} mainBody
 * @param {Array<{ body: string; finalUrl: string; contentType: string }>} extras
 */
function mergeHtmlSignals(primary, mainBody, extras) {
  if (!extras.length) return primary;
  const analyzed = extras.map((e) => analyzeHtml(e.body, e.finalUrl, e.contentType));
  const m = { ...primary };
  let formCount = Number(primary.formCount) || 0;
  let telCount = Number(primary.telCount) || 0;
  let formHasRequiredAttr = !!primary.formHasRequiredAttr;
  let imageTags = Number(primary.imageTags) || 0;
  let imagesMissingOrEmptyAlt = Number(primary.imagesMissingOrEmptyAlt) || 0;
  let interactiveApprox = Number(primary.interactiveApprox) || 0;
  let internalLinkCount = Number(primary.internalLinkCount) || 0;

  for (const o of analyzed) {
    formCount += Number(o.formCount) || 0;
    telCount += Number(o.telCount) || 0;
    formHasRequiredAttr = formHasRequiredAttr || !!o.formHasRequiredAttr;
    imageTags += Number(o.imageTags) || 0;
    imagesMissingOrEmptyAlt += Number(o.imagesMissingOrEmptyAlt) || 0;
    interactiveApprox = Math.min(8000, interactiveApprox + (Number(o.interactiveApprox) || 0));
    internalLinkCount = Math.max(internalLinkCount, Number(o.internalLinkCount) || 0);
    m.loremIpsumDetected = m.loremIpsumDetected || o.loremIpsumDetected;
    m.comingSoonDetected = m.comingSoonDetected || o.comingSoonDetected;
    m.placeholderPhrasesDetected = m.placeholderPhrasesDetected || o.placeholderPhrasesDetected;
    m.zendeskSnippetDetected = m.zendeskSnippetDetected || o.zendeskSnippetDetected;
    m.modernImageExt = m.modernImageExt || o.modernImageExt;
    m.legalLinkHints = m.legalLinkHints || o.legalLinkHints;
    m.ssrHints = m.ssrHints || o.ssrHints;
    m.logoLikely = m.logoLikely || o.logoLikely;
    m.robotsMetaNoindex = m.robotsMetaNoindex || o.robotsMetaNoindex;
    m.hasViewport = m.hasViewport || o.hasViewport;
    m.hasCharset = m.hasCharset || o.hasCharset;
    m.hasTitle = m.hasTitle || o.hasTitle;
    m.hasMetaDescription = m.hasMetaDescription || o.hasMetaDescription;
    m.hasFaviconLink = m.hasFaviconLink || o.hasFaviconLink;
  }

  const mailAgg = countMailtoAcrossBodies([mainBody, ...extras.map((e) => e.body)]);
  m.formCount = formCount;
  m.telCount = telCount;
  m.mailtoCount = mailAgg.mailtoCount;
  m.mailtoUniqueCount = mailAgg.mailtoUniqueCount;
  m.formHasRequiredAttr = formHasRequiredAttr;
  m.imageTags = imageTags;
  m.imagesMissingOrEmptyAlt = imagesMissingOrEmptyAlt;
  m.interactiveApprox = interactiveApprox;
  m.internalLinkCount = internalLinkCount;
  m._deepPagesSampled = extras.length;
  return m;
}

/**
 * Fetch extra same-origin HTML pages (sequential, deadline-bounded) for a deeper signal pass.
 * @param {string} finalUrl
 * @param {string} mainBody
 * @param {{ maxPages?: number; maxTotalMs?: number }} opts
 */
async function fetchDeepSameOriginSamples(finalUrl, mainBody, opts = {}) {
  const maxPages = opts.maxPages != null ? opts.maxPages : 5;
  const maxTotalMs = opts.maxTotalMs != null ? opts.maxTotalMs : 36_000;
  const deadline = Date.now() + maxTotalMs;
  const urls = collectSameOriginPageUrls(finalUrl, mainBody, maxPages);
  /** @type {Array<{ body: string; finalUrl: string; contentType: string }>} */
  const samples = [];
  for (const href of urls) {
    if (Date.now() > deadline) break;
    try {
      const b = await fetchUrl(href, 4, { timeoutMs: 12_000 });
      if (b.statusCode >= 200 && b.statusCode < 400 && b.body) {
        const ct = String(b.contentType || '');
        if (/html|text\/plain/i.test(ct) || /<html[\s>]/i.test(b.body.slice(0, 2500))) {
          samples.push({
            body: b.body,
            finalUrl: b.finalUrl,
            contentType: ct,
          });
        }
      }
    } catch {
      /* skip unreachable child URLs */
    }
  }
  return { samples, queuedUrls: urls };
}

async function fetchRobotsTxt(originHref) {
  const out = { fetched: false, status: null, hasSitemapLine: false, error: '', preview: '' };
  try {
    const u = new URL('/robots.txt', originHref);
    const r = await fetchUrl(u.href, 3);
    out.fetched = true;
    out.status = r.statusCode;
    const b = r.body || '';
    out.preview = b.slice(0, 400).replace(/\r/g, '');
    out.hasSitemapLine = /^\s*sitemap\s*:/im.test(b);
    if (r.statusCode >= 400) out.error = `HTTP ${r.statusCode}`;
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

async function handleScan(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let requestedUrl = '';
  try {
    const raw = await readBody(req);
    let json;
    try {
      json = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }
    requestedUrl = String(json.url || '').trim();
    if (!requestedUrl) {
      sendJson(res, 400, { ok: false, error: 'Missing url' });
      return;
    }

    let bundle;
    try {
      bundle = await fetchUrl(requestedUrl);
    } catch (fetchErr) {
      const availability = classifyAvailabilityError(fetchErr);
      const overallSummary = buildOverallSummary({
        reachable: false,
        availability,
        statusCode: 0,
        autoChecks: [],
        scanWarnings: [],
        html: null,
      });
      sendJson(res, 200, {
        ok: false,
        requestedUrl,
        availability,
        error: String(fetchErr.message || fetchErr),
        autoChecks: [],
        overallSummary,
      });
      return;
    }

    const { statusCode, headers, finalUrl, body, contentType } = bundle;
    const availability = summarizeHttpAvailability(statusCode, finalUrl);

    const html = analyzeHtml(body, finalUrl, contentType);
    html._contentType = contentType;

    let deepQueuedUrls = [];
    /** @type {Array<{ body: string; finalUrl: string; contentType: string }>} */
    let deepSamples = [];

    const robotsPromise =
      statusCode && statusCode < 500
        ? fetchRobotsTxt(finalUrl)
        : Promise.resolve({
            fetched: false,
            status: null,
            hasSitemapLine: false,
            error: '',
            preview: '',
          });

    const deepPromise =
      statusCode >= 200 && statusCode < 500 && html.isHtmlDocument
        ? fetchDeepSameOriginSamples(finalUrl, body, { maxPages: 5, maxTotalMs: 36_000 })
        : Promise.resolve({ samples: [], queuedUrls: [] });

    const [robotsInfo, deepResult] = await Promise.all([robotsPromise, deepPromise]);
    deepSamples = deepResult.samples;
    deepQueuedUrls = deepResult.queuedUrls;

    const mergedHtml =
      deepSamples.length > 0 ? mergeHtmlSignals(html, body, deepSamples) : html;
    mergedHtml._contentType = contentType;

    const bodySlice = [body, ...deepSamples.map((s) => s.body)]
      .map((b) => String(b || '').slice(0, 90_000))
      .join('\n')
      .slice(0, 200_000);

    const xRobots = String(headers['x-robots-tag'] || '').toLowerCase();
    const xRobotsNoindex = xRobots.includes('noindex');

    const { autoChecks, scanWarnings } = buildAutoChecks(
      requestedUrl,
      finalUrl,
      statusCode,
      headers,
      mergedHtml,
      robotsInfo,
      bodySlice
    );

    if (statusCode >= 500) {
      scanWarnings.unshift({
        message: `HTTP ${statusCode}: origin server error — treat as possible downtime or misconfiguration.`,
      });
    }

    if (deepSamples.length > 0) {
      scanWarnings.push({
        message: `[auto] Deep sample: fetched ${deepSamples.length} extra same-origin page(s) from links on the start URL (capped; not a full crawl).`,
      });
    }

    const overallSummary = buildOverallSummary({
      reachable: true,
      availability,
      statusCode,
      autoChecks,
      scanWarnings,
      html: mergedHtml,
    });

    sendJson(res, 200, {
      ok: true,
      requestedUrl,
      availability,
      finalUrl,
      statusCode,
      contentType: contentType || null,
      xRobotsTag: headers['x-robots-tag'] || null,
      xRobotsNoindex,
      htmlSignals: mergedHtml,
      robotsTxt: robotsInfo,
      autoChecks,
      scanWarnings,
      overallSummary,
      deepScan: {
        extraPagesFetched: deepSamples.length,
        extraPageUrls: deepSamples.map((s) => s.finalUrl),
        sameOriginCandidates: deepQueuedUrls,
      },
      disclaimer:
        'Site scan: start URL + robots.txt + up to five linked same-origin HTML pages (time- and size-capped). Form delivery, approvals, Zendesk UX, CLS, and exhaustive crawling still need manual QA or Playwright.',
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e), requestedUrl });
  }
}

module.exports = { handleScan, sendJson };
