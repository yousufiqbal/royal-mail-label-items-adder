<script lang="ts">
	type Variant = {
		asin: string;
		attrs: Record<string, string>;
		price: string;
		delivery: string;
		yourPrice: string;
		qty: number;
		sku: string;
		include: boolean;
	};

	const MARKETPLACES = [
		{ label: 'Amazon UK', domain: 'www.amazon.co.uk', flag: '🇬🇧' },
		{ label: 'Amazon US', domain: 'www.amazon.com', flag: '🇺🇸' },
		{ label: 'Amazon DE', domain: 'www.amazon.de', flag: '🇩🇪' },
		{ label: 'Amazon FR', domain: 'www.amazon.fr', flag: '🇫🇷' },
		{ label: 'Amazon IT', domain: 'www.amazon.it', flag: '🇮🇹' },
		{ label: 'Amazon ES', domain: 'www.amazon.es', flag: '🇪🇸' },
		{ label: 'Amazon CA', domain: 'www.amazon.ca', flag: '🇨🇦' }
	];

	let asin = $state('');
	let marketplace = $state('www.amazon.co.uk');
	let loading = $state(false);
	let error = $state('');
	let title = $state('');
	let variants: Variant[] = $state([]);

	let condition = $state('11');
	let fulfillment = $state('DEFAULT');
	let defaultQty = $state(100);
	let skuPrefix = $state('RES-');
	let markupPct = $state(0);
	let markupFlat = $state(0);

	const cleanAsin = $derived(asin.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
	const isValidAsin = $derived(/^[A-Z0-9]{10}$/.test(cleanAsin));
	const productUrl = $derived(`https://${marketplace}/dp/${cleanAsin}`);
	const selectedCount = $derived(variants.filter((v) => v.include).length);
	const activeMarket = $derived(MARKETPLACES.find((m) => m.domain === marketplace));

	const FLAT_COLS =
		'sku\tproduct-id\tproduct-id-type\tprice\tminimum-seller-allowed-price\tmaximum-seller-allowed-price\titem-condition\tquantity\tadd-delete\twill-ship-internationally\texpedited-shipping\titem-note\tfulfillment-center-id\tproduct-tax-code\thandling-time\tmerchant_shipping_group_name';

	const flatFileContent = $derived(buildFlatContent());

	function buildFlatContent(): string {
		const rows = variants.filter((v) => v.include);
		if (!rows.length) return '';
		const data = rows
			.map((r) =>
				[r.sku, r.asin, '1', r.yourPrice, '', '', condition, r.qty, 'a', '', '', '', fulfillment, '', '', 'FDS - Manual'].join('\t')
			)
			.join('\r\n');
		return [FLAT_COLS, data].join('\r\n');
	}

	function calcPrice(sourcePrice: string, delivery = '0'): string {
		const p = parseFloat(sourcePrice) || 0;
		const d = parseFloat(delivery) || 0;
		return Math.max(0, (p + d) * (1 + markupPct / 100) + markupFlat).toFixed(2);
	}

	function applyMarkup() {
		for (const v of variants) {
			v.yourPrice = calcPrice(v.price, v.delivery);
			v.qty = defaultQty;
		}
		variants = [...variants];
	}

	function toggleAll(val: boolean) {
		for (const v of variants) v.include = val;
		variants = [...variants];
	}

	async function fetchVariants() {
		if (!isValidAsin) return;
		loading = true;
		error = '';
		variants = [];
		title = '';
		try {
			const res = await fetch(`/reseller/api/variants?url=${encodeURIComponent(productUrl)}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Unknown error');
			title = data.title ?? '';
			variants = data.variants.map(
				(v: { asin: string; attrs: Record<string, string>; price: string; delivery: string }) => ({
					asin: v.asin,
					attrs: v.attrs,
					price: v.price,
					delivery: v.delivery ?? '0',
					yourPrice: calcPrice(v.price, v.delivery),
					qty: defaultQty,
					sku: `${skuPrefix}${v.asin}`,
					include: true
				})
			);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function downloadFlatFile() {
		if (!flatFileContent) return;
		const blob = new Blob([flatFileContent], { type: 'text/plain;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `inventory_loader_${cleanAsin}.txt`;
		a.click();
	}
</script>

<svelte:head><title>Reseller Helper — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Reseller Helper — Flat File Generator</h2>
		<p>
			Enter a parent ASIN, select marketplace, fetch all variants with prices, and download a
			ready-to-upload inventory flat file.
		</p>
	</div>

	<section class="fields-section">
		<div class="fields-header">
			<h3>Product Lookup</h3>
			{#if isValidAsin}
				<a href={productUrl} target="_blank" rel="noopener" class="upload-hint">{productUrl} ↗</a>
			{/if}
		</div>

		<div class="fields-grid">
			<div class="field-group">
				<label class="field-label" for="marketplace">Marketplace</label>
				<select class="field-input" id="marketplace" bind:value={marketplace}>
					{#each MARKETPLACES as m (m.domain)}
						<option value={m.domain}>{m.flag} {m.label}</option>
					{/each}
				</select>
			</div>
			<div class="field-group">
				<label class="field-label" for="asin">ASIN</label>
				<input
					class="field-input"
					id="asin"
					bind:value={asin}
					placeholder="B0XXXXXXXXX"
					maxlength={10}
					spellcheck={false}
					autocomplete="off"
					disabled={loading}
					onkeydown={(e) => e.key === 'Enter' && fetchVariants()}
				/>
			</div>
		</div>

		<div class="action-row" style="justify-content: flex-start">
			<button class="process-btn" class:loading disabled={loading || !isValidAsin} onclick={fetchVariants}>
				<span class="btn-text">{loading ? 'Fetching…' : 'Fetch Variants'}</span>
			</button>
		</div>

		{#if error}
			<p class="error">{error}</p>
		{:else if variants.length > 0}
			<p class="summary">Found {variants.length} variant{variants.length !== 1 ? 's' : ''}</p>
		{/if}
	</section>

	{#if variants.length > 0}
		<section class="fields-section">
			<div class="fields-header">
				<h3>Listing Settings</h3>
				<span class="upload-hint">Applied when downloading flat file</span>
			</div>
			<div class="fields-grid">
				<div class="field-group">
					<label class="field-label" for="condition">Condition</label>
					<select class="field-input" id="condition" bind:value={condition}>
						<option value="11">New</option>
						<option value="1">Used — Like New</option>
						<option value="2">Used — Very Good</option>
						<option value="3">Used — Good</option>
						<option value="4">Used — Acceptable</option>
						<option value="10">Refurbished</option>
					</select>
				</div>
				<div class="field-group">
					<label class="field-label" for="fulfillment">Fulfillment</label>
					<select class="field-input" id="fulfillment" bind:value={fulfillment}>
						<option value="DEFAULT">FBM — Merchant (DEFAULT)</option>
						<option value="AMAZON_UK">FBA — Amazon UK</option>
					</select>
				</div>
				<div class="field-group">
					<label class="field-label" for="defaultQty">Default Qty</label>
					<input class="field-input" type="number" id="defaultQty" bind:value={defaultQty} min={0} max={9999} />
				</div>
				<div class="field-group">
					<label class="field-label" for="skuPrefix">SKU Prefix</label>
					<input class="field-input" id="skuPrefix" bind:value={skuPrefix} placeholder="RES-" />
				</div>
				<div class="field-group">
					<label class="field-label" for="markupPct">Markup %</label>
					<input class="field-input" type="number" id="markupPct" bind:value={markupPct} min={-50} max={200} step={0.5} />
				</div>
				<div class="field-group">
					<label class="field-label" for="markupFlat">Markup £ flat</label>
					<input class="field-input" type="number" id="markupFlat" bind:value={markupFlat} min={-999} max={9999} step={0.01} />
				</div>
			</div>
			<div class="action-row">
				<span class="upload-hint">% applied first, then flat £ added. Both 0 = match source price.</span>
				<button class="download-btn small" onclick={applyMarkup}>Re-apply to table →</button>
			</div>
		</section>

		<section class="log-section">
			<div class="log-header">
				<h3>Variants</h3>
				<div style="display:flex; align-items:center; gap:8px;">
					<span class="badge success">{selectedCount} / {variants.length}</span>
					<button class="download-btn small" onclick={() => toggleAll(true)}>All</button>
					<button class="download-btn small" onclick={() => toggleAll(false)}>None</button>
					<button class="download-btn small" onclick={downloadFlatFile} disabled={selectedCount === 0}>↓ Download .txt</button>
				</div>
			</div>
			{#if title}
				<p class="upload-hint" style="padding: 0 20px;">{title}</p>
			{/if}
			<div class="table-wrap variants-table">
				<table>
					<thead>
						<tr>
							<th></th>
							<th>ASIN</th>
							<th>Attributes</th>
							<th>Source £</th>
							<th>Delivery £</th>
							<th>Your Price (£)</th>
							<th>Qty</th>
							<th>SKU</th>
						</tr>
					</thead>
					<tbody>
						{#each variants as v (v.asin)}
							<tr style={v.include ? '' : 'opacity:0.35'}>
								<td><input type="checkbox" bind:checked={v.include} /></td>
								<td><span class="file-name">{v.asin}</span></td>
								<td>
									{#each Object.entries(v.attrs) as [k, val] (k)}
										<span class="badge">{k}: {val}</span>
									{:else}
										<span class="upload-hint">—</span>
									{/each}
								</td>
								<td>{v.price ? `£${v.price}` : '—'}</td>
								<td>{v.delivery === '0' ? 'FREE' : v.delivery ? `£${v.delivery}` : '—'}</td>
								<td><input type="number" bind:value={v.yourPrice} min={0} step={0.01} /></td>
								<td><input type="number" bind:value={v.qty} min={0} max={9999} /></td>
								<td><input type="text" bind:value={v.sku} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		{#if flatFileContent}
			{@const previewRows = flatFileContent.split('\r\n').map((r) => r.split('\t'))}
			{@const previewHead = previewRows[0]}
			{@const previewBody = previewRows.slice(1)}
			<section class="log-section">
				<div class="log-header">
					<h3>File Preview</h3>
					<span class="log-status">{previewBody.length} row{previewBody.length !== 1 ? 's' : ''} · TSV</span>
				</div>
				<div class="table-wrap" style="max-height: 300px; overflow-y: auto;">
					<table>
						<thead>
							<tr>
								{#each previewHead as col}
									<th>{col}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each previewBody as row}
								<tr>
									{#each row as cell}
										<td>{cell || '—'}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	{/if}
</main>
