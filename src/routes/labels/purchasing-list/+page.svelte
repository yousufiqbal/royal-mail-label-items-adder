<script lang="ts">
	import { parseCSV, readFileAsText, formatFileDate } from '$lib/csv';
	import { aggregatePacking, buildPackingCsv, buildPackingPdf, buildPackingFilename, type PkgGroup } from '$lib/packing';

	function todayIso() {
		const t = new Date();
		return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
	}

	let files: File[] = $state([]);
	let listDate = $state(todayIso());
	let cleanVariants = $state(true);

	let logLines: { type: string; icon: string; msg: string }[] = $state([]);
	let logStatus = $state('');
	let showLog = $state(false);
	let showPreview = $state(false);
	let processing = $state(false);
	let groups: PkgGroup[] = $state([]);

	function log(type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) {
		const icons = { info: '·', ok: '✓', warn: '⚠', err: '✗', head: '▸' };
		logLines = [...logLines, { type, icon: icons[type], msg }];
	}

	function onFilesChange(e: Event) {
		files = Array.from((e.target as HTMLInputElement).files ?? []);
	}

	async function runPacking() {
		groups = [];
		showPreview = false;
		logLines = [];
		showLog = true;
		logStatus = '';
		processing = true;

		try {
			log('head', files.length > 1 ? `Reading ${files.length} orders files…` : 'Reading orders file…');
			let rows: { orderId: string; name: string; qty: string }[] = [];
			for (const file of files) {
				const text = await readFileAsText(file);
				let fileRows;
				try {
					fileRows = parseCSV(text);
				} catch (e) {
					log('err', `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
					return;
				}
				log('ok', `${file.name} — ${fileRows.length} rows`);
				rows = rows.concat(fileRows);
			}
			log('ok', `${rows.length} rows total across ${files.length} file(s)`);

			log('head', 'Grouping by product + variant…');
			groups = aggregatePacking(rows, cleanVariants);

			const totalQty = groups.reduce((s, g) => s + g.total, 0);
			const lineCount = groups.reduce((s, g) => s + g.variants.length, 0);
			log('ok', `${groups.length} products, ${lineCount} variant lines, ${totalQty} units total`);

			logStatus = `${groups.length} products, ${totalQty} units`;
			showPreview = true;
		} catch (err) {
			log('err', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
			console.error(err);
		} finally {
			processing = false;
		}
	}

	function recalcStatus() {
		const totalQty = groups.reduce((s, g) => s + g.total, 0);
		logStatus = `${groups.length} products, ${totalQty} units`;
	}

	function addParent() {
		groups = [...groups, { product: 'New Product', total: 0, variants: [{ variant: '', qty: 1 }] }];
	}
	function removeParent(gi: number) {
		groups = groups.filter((_, i) => i !== gi);
		recalcStatus();
	}
	function addChild(gi: number) {
		groups[gi].variants.push({ variant: '', qty: 1 });
		groups = [...groups];
	}
	function removeChild(gi: number, vi: number) {
		groups[gi].variants.splice(vi, 1);
		groups[gi].total = groups[gi].variants.reduce((s, v) => s + v.qty, 0);
		groups = [...groups];
		recalcStatus();
	}
	function changeQty(gi: number, vi: number, delta: number) {
		const v = groups[gi].variants[vi];
		v.qty = Math.max(1, v.qty + delta);
		groups[gi].total = groups[gi].variants.reduce((s, x) => s + x.qty, 0);
		groups = [...groups];
		recalcStatus();
	}

	function downloadCsv() {
		if (!groups.length) return;
		const csv = buildPackingCsv(groups, listDate);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildPackingFilename(listDate, 'csv');
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	async function downloadPdf() {
		if (!groups.length) return;
		const bytes = await buildPackingPdf(groups, listDate);
		const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildPackingFilename(listDate, 'pdf');
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}
</script>

<svelte:head><title>Purchasing List — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Purchasing List</h2>
		<p>
			Upload the same orders TXT (multiple files supported) — the app totals every product +
			variant across all rows so your purchaser knows exactly what and how much to buy.
		</p>
	</div>

	<section class="fields-section">
		<div class="fields-grid">
			<div class="field-group">
				<label class="field-label" for="pkg-date">List Date</label>
				<input class="field-input" type="date" id="pkg-date" bind:value={listDate} />
				<span class="field-hint">Printed on the exported list</span>
			</div>
			<div class="field-group">
				<label class="field-label" for="pkg-clean-variant">Variant Cleanup</label>
				<label class="checkbox-row" for="pkg-clean-variant">
					<input type="checkbox" id="pkg-clean-variant" bind:checked={cleanVariants} />
					<span>Strip UK/Numeric and simplify Regular/Fit tokens</span>
				</label>
				<span class="field-hint">Uncheck to keep the variant text exactly as extracted</span>
			</div>
		</div>
	</section>

	<section class="upload-grid single">
		<div class="upload-card" class:has-file={!!files.length}>
			<h3>Orders TXT (multiple supported)</h3>
			<p class="upload-hint">
				Same tab-delimited file(s) — must have <code>order-id</code>, <code>product-name</code>,
				<code>quantity-purchased</code> columns. Pick multiple to combine into one list.
			</p>
			<label class="file-btn" for="pkg-input">
				Choose TXT
				<input type="file" id="pkg-input" accept=".txt,.tsv,.tab" multiple hidden onchange={onFilesChange} />
			</label>
			{#if files.length}
				{#each files as file (file.name + file.lastModified)}
					<div class="file-name-row">
						<span class="file-name ready">{file.name}</span>
						<span class="file-name-date">{formatFileDate(file)}</span>
					</div>
				{/each}
			{:else}
				<div class="file-name">No file chosen</div>
			{/if}
		</div>
	</section>

	<div class="action-row">
		<button class="process-btn" class:loading={processing} disabled={!files.length || processing} onclick={runPacking}>
			<span class="btn-text">{processing ? 'Processing…' : 'Generate List'}</span>
			<span class="btn-icon">{processing ? '' : '→'}</span>
		</button>
	</div>

	{#if showLog}
		<section class="log-section">
			<div class="log-header">
				<h3>Processing Log</h3>
				<div class="log-status">{logStatus}</div>
			</div>
			<div class="log-body">
				{#each logLines as line, i (i)}
					<div class="log-line {line.type}">
						<span class="icon">{line.icon}</span><span class="msg">{line.msg}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if showPreview}
		<div class="download-row standalone">
			<button class="download-btn" onclick={downloadPdf}>↓ Download PDF</button>
			<button class="download-btn" onclick={downloadCsv}>↓ Download CSV</button>
		</div>

		<section class="log-section pkg-preview-section">
			<div class="log-header">
				<h3>Preview — edit before export</h3>
				<button class="download-btn small" onclick={addParent}>+ Add Product</button>
			</div>

			<div class="pkg-preview-list">
				{#if !groups.length}
					<div class="pkg-empty-hint">No products — use "Add Product" to start one.</div>
				{/if}
				{#each groups as group, gi (gi)}
					<div class="pkg-parent">
						<div class="pkg-parent-header">
							<input class="pkg-parent-name" bind:value={group.product} />
							<span class="pkg-parent-total">{group.total} total</span>
							<button class="pkg-icon-btn" title="Add variant" onclick={() => addChild(gi)}>+</button>
							<button class="pkg-icon-btn danger" title="Remove product" onclick={() => removeParent(gi)}>&times;</button>
						</div>
						<div class="pkg-children">
							{#each group.variants as v, vi (vi)}
								<div class="pkg-child">
									<input class="pkg-child-variant" placeholder="variant" bind:value={v.variant} />
									<div class="pkg-qty-stepper">
										<button class="pkg-icon-btn" title="Decrease" onclick={() => changeQty(gi, vi, -1)}>&minus;</button>
										<span class="pkg-qty-value">{v.qty}</span>
										<button class="pkg-icon-btn" title="Increase" onclick={() => changeQty(gi, vi, 1)}>+</button>
									</div>
									<button class="pkg-icon-btn danger" title="Remove variant" onclick={() => removeChild(gi, vi)}>&times;</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</main>
