import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const DOMAIN_CONFIG: Record<string, { lang: string }> = {
	'www.amazon.co.uk': { lang: 'en-GB,en;q=0.9' },
	'www.amazon.com':   { lang: 'en-US,en;q=0.9' },
	'www.amazon.de':    { lang: 'de-DE,de;q=0.9' },
	'www.amazon.fr':    { lang: 'fr-FR,fr;q=0.9' },
	'www.amazon.it':    { lang: 'it-IT,it;q=0.9' },
	'www.amazon.es':    { lang: 'es-ES,es;q=0.9' },
	'www.amazon.ca':    { lang: 'en-CA,en;q=0.9' },
};

function extractAsin(url: string): string | null {
	const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
	return m ? m[1] : null;
}

// Bracket-counting JSON extractor — handles nested objects correctly
function extractJsonAfterKey(html: string, key: string): Record<string, unknown> | null {
	const idx = html.indexOf(`"${key}"`);
	if (idx === -1) return null;
	const start = html.indexOf('{', idx + key.length + 2);
	if (start === -1) return null;

	let depth = 0, inStr = false, escape = false;
	for (let i = start; i < html.length; i++) {
		const ch = html[i];
		if (escape) { escape = false; continue; }
		if (ch === '\\' && inStr) { escape = true; continue; }
		if (ch === '"') { inStr = !inStr; continue; }
		if (inStr) continue;
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) {
				try { return JSON.parse(html.slice(start, i + 1)); }
				catch { return null; }
			}
		}
	}
	return null;
}

async function fetchPage(url: string): Promise<string> {
	const domain = new URL(url).hostname;
	const cfg = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG['www.amazon.co.uk'];

	// Build fetch options — optionally route through PROXY_URL
	const proxyUrl = env.PROXY_URL;

	// If proxy set, use it via undici (Node built-in fetch doesn't support proxies)
	if (proxyUrl) {
		const { ProxyAgent, fetch: undiciFetch } = await import('undici');
		const dispatcher = new ProxyAgent(proxyUrl);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const resp = await (undiciFetch as any)(url, {
			dispatcher,
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
				'Accept-Language': cfg.lang,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Encoding': 'gzip, deflate, br',
				'Cache-Control': 'no-cache',
			},
			redirect: 'follow',
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		return resp.text();
	}

	const resp = await fetch(url, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
			'Accept-Language': cfg.lang,
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Encoding': 'gzip, deflate, br',
			'Cache-Control': 'no-cache',
		},
		redirect: 'follow',
	});
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	return resp.text();
}

function extractPriceFromHtml(html: string): string | null {
	const patterns = [
		/priceAmount(?:\\?&quot;|\\?")\s*:\s*([\d.]+)/,
		/buyingPrice(?:\\?&quot;|\\?")\s*:\s*([\d.]+)/,
		/"priceAmount"\s*:\s*([\d.]+)/,
		/"price"\s*:\s*([\d.]+)/,
	];
	for (const p of patterns) {
		const m = html.match(p);
		if (m) {
			const val = parseFloat(m[1]);
			if (!isNaN(val) && val > 0.5 && val < 99999) return val.toFixed(2);
		}
	}
	return null;
}

// Returns delivery cost as string (e.g. "2.99") or "0" if free, null if unknown
function extractDeliveryFromHtml(html: string): string | null {
	// Free delivery signals
	if (/FREE delivery/i.test(html)) return '0';
	// Paid delivery: "£2.99 delivery" or "£2.99 postage"
	const m = html.match(/£([\d.]+)\s*(?:delivery|postage)/i);
	if (m) {
		const val = parseFloat(m[1]);
		if (!isNaN(val) && val > 0 && val < 50) return val.toFixed(2);
	}
	return null;
}

function extractTitle(html: string): string {
	const m = html.match(/<span[^>]+id="productTitle"[^>]*>\s*([\s\S]*?)\s*<\/span>/);
	return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

export const GET: RequestHandler = async ({ url }) => {
	const productUrl = url.searchParams.get('url');
	if (!productUrl) return json({ error: 'url param required' }, { status: 400 });

	const parentAsin = extractAsin(productUrl);
	if (!parentAsin) return json({ error: 'Could not extract ASIN from URL' }, { status: 400 });

	let html: string;
	try {
		html = await fetchPage(productUrl);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ error: 'Failed to fetch page: ' + msg }, { status: 502 });
	}

	if (html.includes('captchacharacters') || html.includes('Enter the characters you see below')) {
		return json({ error: 'Amazon returned a CAPTCHA — wait a few minutes and retry.' }, { status: 429 });
	}

	const title = extractTitle(html);
	const parentPrice = extractPriceFromHtml(html);

	const dimData = extractJsonAfterKey(html, 'dimensionValuesDisplayData') as Record<string, string[]> | null;
	const dimLabels = extractJsonAfterKey(html, 'variationDisplayLabels') as Record<string, string> | null;
	const varValues = extractJsonAfterKey(html, 'variationValues') as Record<string, string[]> | null;

	let asinMap: Record<string, Record<string, string>> = {};

	if (dimData && Object.keys(dimData).length > 0) {
		const dimKeys = varValues ? Object.keys(varValues) : [];
		const labelFor = (i: number) => {
			const key = dimKeys[i];
			if (!key) return `Attr${i + 1}`;
			return dimLabels?.[key] ?? key;
		};
		for (const [asin, vals] of Object.entries(dimData)) {
			const attrs: Record<string, string> = {};
			(Array.isArray(vals) ? vals : [vals]).forEach((v, i) => { attrs[labelFor(i)] = v; });
			asinMap[asin] = attrs;
		}
	} else {
		const found = [...html.matchAll(/"ASIN"\s*:\s*"([A-Z0-9]{10})"/g)].map((m) => m[1]);
		const unique = [...new Set(found)];
		if (!unique.includes(parentAsin)) unique.unshift(parentAsin);
		asinMap = Object.fromEntries(unique.map((a) => [a, {}]));
	}

	const asinList = Object.keys(asinMap);
	const domain = new URL(productUrl).hostname;

	const parentDelivery = extractDeliveryFromHtml(html);

	// Fetch per-variant prices + delivery in parallel
	const results = await Promise.all(
		asinList.map(async (asin) => {
			if (asin === parentAsin) return { price: parentPrice, delivery: parentDelivery };
			try {
				const vHtml = await fetchPage(`https://${domain}/dp/${asin}`);
				return { price: extractPriceFromHtml(vHtml), delivery: extractDeliveryFromHtml(vHtml) };
			} catch {
				return { price: null, delivery: null };
			}
		})
	);

	const variants = asinList.map((asin, i) => ({
		asin,
		attrs: asinMap[asin],
		price: results[i].price ?? parentPrice ?? '',
		delivery: results[i].delivery ?? parentDelivery ?? ''
	}));

	return json({ parentAsin, title, variants });
};
