import { findHeaderIdx, parseNumber, splitTitle, toHeaderMapLower } from './shared';

export interface FbmRecord {
	sku: string;
	asin: string;
	name: string;
	description: string;
	color: string;
	stock: number;
	status: string;
	price: string | null;
	condition: string;
	isOos: boolean;
}

export interface FbmGroup {
	key: string;
	name: string;
	rows: FbmRecord[];
}

const COLOR_WORDS = [
	'sky blue',
	'royal blue',
	'bottle green',
	'jade green',
	'sage green',
	'silver grey',
	'light grey',
	'dark grey',
	'baby pink',
	'dusty pink',
	'neon pink',
	'neon green',
	'neon yellow',
	'neon orange',
	'army green',
	'army grey',
	'tartan green',
	'tartan blue',
	'tartan red',
	'tartan white',
	'red leopard',
	'brown leopard',
	'multi leopard',
	'wet look',
	'big aztec',
	'small aztec',
	'love letters',
	'love paris',
	'dog tooth',
	'skull rose',
	'vertical strips',
	'multi-colour',
	'multi colour',
	'black/white',
	'blue/grey',
	'red/black',
	'pink/grey',
	'brown copper',
	'light green',
	'light royal',
	'dark navy',
	'cerise pink',
	'apple green',
	'beige/stone',
	'rose pink',
	'black',
	'white',
	'red',
	'blue',
	'navy',
	'green',
	'yellow',
	'pink',
	'purple',
	'orange',
	'grey',
	'gray',
	'brown',
	'beige',
	'cream',
	'khaki',
	'teal',
	'turquoise',
	'maroon',
	'burgundy',
	'wine',
	'stone',
	'charcoal',
	'silver',
	'gold',
	'golden',
	'lilac',
	'fuchsia',
	'coral',
	'mustard',
	'olive',
	'camel',
	'rust',
	'denim',
	'indigo',
	'magenta',
	'mocha',
	'peach',
	'aqua'
].sort((a, b) => b.length - a.length);

export function extractColor(description: string): string {
	if (!description) return '';
	const lower = description.toLowerCase();
	for (const word of COLOR_WORDS) {
		const idx = lower.indexOf(word);
		if (idx > -1) return description.slice(idx, idx + word.length);
	}
	return '';
}

export function buildRecords(rows: string[][]): FbmRecord[] {
	if (rows.length < 2) throw new Error('Inventory file appears empty or unreadable.');
	const headerMap = toHeaderMapLower(rows[0]);

	const skuIdx = findHeaderIdx(headerMap, ['seller-sku', 'sku']);
	const asinIdx = findHeaderIdx(headerMap, ['asin1', 'asin']);
	const nameIdx = findHeaderIdx(headerMap, ['item-name', 'title']);
	const qtyIdx = findHeaderIdx(headerMap, ['quantity', 'quantity available']);
	const statusIdx = findHeaderIdx(headerMap, ['status']);
	const channelIdx = findHeaderIdx(headerMap, ['fulfillment-channel', 'fulfillment-channel-sku']);
	const priceIdx = findHeaderIdx(headerMap, ['price', 'your-price', 'standard-price', 'sale-price']);
	const conditionIdx = findHeaderIdx(headerMap, ['item-condition']);

	if (skuIdx === undefined || nameIdx === undefined) {
		throw new Error('Could not find "seller-sku" / "item-name" columns in the inventory file.');
	}

	const records: FbmRecord[] = [];
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		if (!r || r.length <= nameIdx) continue;

		const channel = channelIdx !== undefined ? (r[channelIdx] || '').trim() : 'DEFAULT';
		// Only merchant-fulfilled (FBM) rows. Amazon-fulfilled rows use AMAZON_EU / AMAZON.
		if (channel && channel !== 'DEFAULT') continue;

		const sku = r[skuIdx] || '';
		const asin = asinIdx !== undefined ? r[asinIdx] || '' : '';
		const rawTitle = r[nameIdx] || '';
		const { name, description } = splitTitle(rawTitle);
		const color = extractColor(description);
		const stock = qtyIdx !== undefined ? parseNumber(r[qtyIdx]) : 0;
		const status = statusIdx !== undefined ? r[statusIdx] || '' : '';
		const price = priceIdx !== undefined ? r[priceIdx] : null;
		const condition = conditionIdx !== undefined ? r[conditionIdx] || '' : '';
		const isOos = stock <= 0;

		records.push({ sku, asin, name, description, color, stock, status, price, condition, isOos });
	}
	return records;
}

export function groupByName(records: FbmRecord[]): FbmGroup[] {
	const order: string[] = [];
	const map = new Map<string, FbmRecord[]>();
	records.forEach((rec) => {
		const key = rec.name || rec.sku;
		if (!map.has(key)) {
			map.set(key, []);
			order.push(key);
		}
		map.get(key)!.push(rec);
	});
	return order.map((key) => {
		const groupRows = map
			.get(key)!
			.slice()
			.sort((a, b) => {
				const c = a.color.localeCompare(b.color);
				if (c !== 0) return c;
				return a.description.localeCompare(b.description);
			});
		return { key, name: key, rows: groupRows };
	});
}

export function formatPrice(price: string | null): string {
	if (price === null || price === undefined || price === '') return '—';
	const n = parseNumber(price);
	return isNaN(n) ? String(price) : `£${n.toFixed(2)}`;
}

export function countOos(rows: FbmRecord[]): number {
	return rows.filter((r) => r.isOos).length;
}
