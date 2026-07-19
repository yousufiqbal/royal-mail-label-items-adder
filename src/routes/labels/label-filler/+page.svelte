<script lang="ts">
	import { parseCSV, readFileAsText, readFileAsArrayBuffer, formatFileDate, type OrderRow } from '$lib/csv';
	import { runLabelFiller, buildOutputFilename } from '$lib/labelFiller';

	let pdfFile: File | null = $state(null);
	let csvFile: File | null = $state(null);
	let modifiedPdfBytes: Uint8Array | null = $state(null);

	let logLines: { type: string; icon: string; msg: string }[] = $state([]);
	let logStatus = $state('');
	let showLog = $state(false);
	let showDownload = $state(false);
	let processing = $state(false);

	const ready = $derived(!!pdfFile && !!csvFile);

	function log(type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) {
		const icons = { info: '·', ok: '✓', warn: '⚠', err: '✗', head: '▸' };
		logLines = [...logLines, { type, icon: icons[type], msg }];
	}

	function onPdfChange(e: Event) {
		pdfFile = (e.target as HTMLInputElement).files?.[0] ?? null;
	}
	function onCsvChange(e: Event) {
		csvFile = (e.target as HTMLInputElement).files?.[0] ?? null;
	}

	async function runProcess() {
		if (!pdfFile || !csvFile) return;
		modifiedPdfBytes = null;
		showDownload = false;
		logLines = [];
		showLog = true;
		logStatus = '';
		processing = true;

		try {
			log('head', 'Reading orders file…');
			const csvText = await readFileAsText(csvFile);
			let rows: OrderRow[];
			try {
				rows = parseCSV(csvText);
			} catch (e) {
				log('err', e instanceof Error ? e.message : String(e));
				return;
			}

			log('head', 'Reading PDF…');
			const pdfBytes = await readFileAsArrayBuffer(pdfFile);
			log('ok', `PDF loaded — ${(pdfBytes.byteLength / 1024).toFixed(0)} KB`);

			log('head', 'Processing pages…');
			const result = await runLabelFiller(pdfBytes, rows, log);

			log('head', 'Saving modified PDF…');
			modifiedPdfBytes = result.pdfBytes;
			log(
				'ok',
				`Done — ${result.matched} pages updated, ${result.notFound} order IDs not in file, ${result.noId} pages skipped`
			);
			logStatus = `${result.matched} labels filled`;
			showDownload = true;
		} catch (err) {
			log('err', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
			console.error(err);
		} finally {
			processing = false;
		}
	}

	function download() {
		if (!modifiedPdfBytes) return;
		const blob = new Blob([modifiedPdfBytes as BlobPart], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildOutputFilename(pdfFile ? pdfFile.name : '');
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}
</script>

<svelte:head><title>Label Details Filler — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Label Details Filler</h2>
		<p>
			Upload your shipping labels PDF and orders CSV — the app stamps order details onto each
			label and gives you a ready-to-send PDF.
		</p>
	</div>

	<section class="upload-grid">
		<div class="upload-card" class:has-file={!!pdfFile}>
			<h3>Shipping Labels PDF</h3>
			<p class="upload-hint">Multi-page PDF — one label per page</p>
			<label class="file-btn" for="pdf-input">
				Choose PDF
				<input type="file" id="pdf-input" accept=".pdf" hidden onchange={onPdfChange} />
			</label>
			{#if pdfFile}
				<div class="file-name-row">
					<span class="file-name ready">{pdfFile.name}</span>
					<span class="file-name-date">{formatFileDate(pdfFile)}</span>
				</div>
			{:else}
				<div class="file-name">No file chosen</div>
			{/if}
		</div>

		<div class="upload-card" class:has-file={!!csvFile}>
			<h3>Orders TXT</h3>
			<p class="upload-hint">
				Tab-delimited file — must have <code>order-id</code>, <code>product-name</code>,
				<code>quantity-purchased</code> columns
			</p>
			<label class="file-btn" for="csv-input">
				Choose TXT
				<input type="file" id="csv-input" accept=".txt,.tsv,.tab" hidden onchange={onCsvChange} />
			</label>
			{#if csvFile}
				<div class="file-name-row">
					<span class="file-name ready">{csvFile.name}</span>
					<span class="file-name-date">{formatFileDate(csvFile)}</span>
				</div>
			{:else}
				<div class="file-name">No file chosen</div>
			{/if}
		</div>
	</section>

	<div class="action-row">
		<button class="process-btn" class:loading={processing} disabled={!ready || processing} onclick={runProcess}>
			<span class="btn-text">{processing ? 'Processing…' : 'Process Labels'}</span>
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
			{#if showDownload}
				<div class="download-row">
					<button class="download-btn" onclick={download}>↓ Download Modified PDF</button>
				</div>
			{/if}
		</section>
	{/if}
</main>
