<script lang="ts">
	import { readFileAsArrayBuffer, formatFileDate } from '$lib/csv';
	import { runTracking, autoFillShipDate, buildTrackingFilename, type ShipFields } from '$lib/tracking/tracking';

	function todayIso() {
		const t = new Date();
		return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
	}

	let pdfFile: File | null = $state(null);

	let shipDate = $state(todayIso());
	let senderName = $state('MH-House');
	let addr1 = $state('828, Stockport Road');
	let city = $state('Manchester');
	let county = $state('Lancashire');
	let postcode = $state('M19 3AW');
	let country = $state('GB');

	let logLines: { type: string; icon: string; msg: string }[] = $state([]);
	let logStatus = $state('');
	let showLog = $state(false);
	let showDownload = $state(false);
	let processing = $state(false);
	let outputBytes: Uint8Array | null = $state(null);

	function log(type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) {
		const icons = { info: '·', ok: '✓', warn: '⚠', err: '✗', head: '▸' };
		logLines = [...logLines, { type, icon: icons[type], msg }];
	}

	function onPdfChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0] ?? null;
		pdfFile = file;
		if (file) shipDate = autoFillShipDate(file.name);
	}

	async function process() {
		if (!pdfFile) return;
		outputBytes = null;
		showDownload = false;
		logLines = [];
		showLog = true;
		logStatus = '';
		processing = true;

		try {
			if (!shipDate) {
				log('err', 'Please enter a ship date.');
				return;
			}
			const fields: ShipFields = {
				shipDate,
				senderName,
				addr1,
				city,
				county,
				postcode,
				country: country.toUpperCase()
			};
			const pdfBytes = await readFileAsArrayBuffer(pdfFile);
			const result = await runTracking(pdfBytes, fields, log);
			outputBytes = result.outputBytes;
			logStatus = `${result.okCount} labels`;
			showDownload = true;
		} catch (err) {
			log('err', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
			console.error(err);
		} finally {
			processing = false;
		}
	}

	function download() {
		if (!outputBytes) return;
		const blob = new Blob([outputBytes as BlobPart], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildTrackingFilename(shipDate);
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}
</script>

<svelte:head><title>Tracking Export — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Tracking Export</h2>
		<p>
			Upload your shipping labels PDF — the app reads every order ID and tracking number, then
			builds the Amazon shipment confirmation file ready to upload.
		</p>
	</div>

	<section class="upload-grid single">
		<div class="upload-card" class:has-file={!!pdfFile}>
			<h3>Shipping Labels PDF</h3>
			<p class="upload-hint">Same multi-page labels PDF — one label per page</p>
			<label class="file-btn" for="trk-pdf-input">
				Choose PDF
				<input type="file" id="trk-pdf-input" accept=".pdf" hidden onchange={onPdfChange} />
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
	</section>

	<section class="fields-section">
		<div class="fields-header">
			<h3>Shipment Details</h3>
			<p class="upload-hint">These values fill every row of the file. Edit any field before generating.</p>
		</div>
		<div class="fields-grid">
			<div class="field-group">
				<label class="field-label" for="f-ship-date">Ship Date <span class="req">required</span></label>
				<input class="field-input" type="date" id="f-ship-date" bind:value={shipDate} />
				<span class="field-hint">YYYY-MM-DD</span>
			</div>
			<div class="field-group">
				<label class="field-label" for="f-sender-name">Sender Name <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-sender-name" bind:value={senderName} />
			</div>
			<div class="field-group">
				<label class="field-label" for="f-addr1">Address Line 1 <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-addr1" bind:value={addr1} />
			</div>
			<div class="field-group">
				<label class="field-label" for="f-city">City <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-city" bind:value={city} />
			</div>
			<div class="field-group">
				<label class="field-label" for="f-county">County <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-county" bind:value={county} />
			</div>
			<div class="field-group">
				<label class="field-label" for="f-postcode">Postcode <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-postcode" bind:value={postcode} />
			</div>
			<div class="field-group">
				<label class="field-label" for="f-country">Country Code <span class="req">required</span></label>
				<input class="field-input" type="text" id="f-country" maxlength="2" bind:value={country} />
			</div>
		</div>
	</section>

	<div class="action-row">
		<button class="process-btn" class:loading={processing} disabled={!pdfFile || processing} onclick={process}>
			<span class="btn-text">{processing ? 'Processing…' : 'Generate File'}</span>
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
					<button class="download-btn" onclick={download}>↓ Download ShippingConfirmation (.txt)</button>
				</div>
			{/if}
		</section>
	{/if}
</main>
