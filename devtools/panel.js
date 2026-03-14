let currentTabId = null;
let session = createEmptySession();
let selectedStepId = null;
let activeTab = 'network';
const SUMMARY_STEP_ID = '__session_summary__';

const stepListEl = document.getElementById('step-list');
const stepsEmptyEl = document.getElementById('steps-empty');
const detailsEmptyEl = document.getElementById('details-empty');
const detailsViewEl = document.getElementById('details-view');
const recordingIndicatorEl = document.getElementById('recording-indicator');
const stepCountEl = document.getElementById('step-count');
const metricRecordedEl = document.getElementById('metric-recorded');
const metricErrorsEl = document.getElementById('metric-errors');
const metricShotsEl = document.getElementById('metric-shots');
const exportBtnEl = document.getElementById('export-btn');

document.getElementById('start-btn').addEventListener('click', startRecording);
document.getElementById('stop-btn').addEventListener('click', stopRecording);
document.getElementById('clear-btn').addEventListener('click', clearSession);
document.getElementById('export-btn').addEventListener('click', exportSummary);

document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        renderTabs();
    });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'session_updated') return;
    if (message.tabId !== currentTabId) return;

    session = message.session || createEmptySession();
    syncSelection();
    render();
});

init();

async function init() {
    currentTabId = await resolveTabId();
    await refreshSession();
    render();
}

async function resolveTabId() {
    if (chrome.devtools?.inspectedWindow?.tabId) {
        return chrome.devtools.inspectedWindow.tabId;
    }
    return null;
}

async function refreshSession() {
    if (currentTabId == null) return;

    const response = await sendBackgroundMessage('get_session');
    if (response?.ok) {
        session = response.session || createEmptySession();
        syncSelection();
    }
}

async function startRecording() {
    if (currentTabId == null) return;

    const response = await sendBackgroundMessage('start_recording');
    if (response?.ok) {
        session = response.session;
        selectedStepId = null;
        activeTab = 'network';
        render();
    }
}

async function stopRecording() {
    if (currentTabId == null) return;

    const response = await sendBackgroundMessage('stop_recording');
    if (response?.ok) {
        session = response.session;
        selectedStepId = SUMMARY_STEP_ID;
        render();
    }
}

async function clearSession() {
    if (currentTabId == null) return;

    const response = await sendBackgroundMessage('clear_session');
    if (response?.ok) {
        session = createEmptySession();
        selectedStepId = null;
        activeTab = 'network';
        render();
    }
}

async function sendBackgroundMessage(type, extra = {}) {
    try {
        return await chrome.runtime.sendMessage({
            type,
            tabId: currentTabId,
            ...extra
        });
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function render() {
    renderHeader();
    renderStepList();
    renderDetails();
}

function renderHeader() {
    const isRecording = Boolean(session.isRecording);
    const steps = session.steps || [];
    const errorSteps = steps.filter((step) => step.network.length || step.console.length || step.screenshots.length).length;
    const totalShots = steps.reduce((count, step) => count + step.screenshots.length, 0);

    recordingIndicatorEl.textContent = isRecording ? 'Recording' : 'Idle';
    recordingIndicatorEl.className = `recording-indicator ${isRecording ? 'recording' : 'idle'}`;
    stepCountEl.textContent = String(steps.length);
    metricRecordedEl.textContent = String(steps.length);
    metricErrorsEl.textContent = String(errorSteps);
    metricShotsEl.textContent = String(totalShots);
    exportBtnEl.disabled = isRecording || steps.length === 0;
}

function renderStepList() {
    const steps = session.steps || [];
    const items = getStepListItems();
    stepListEl.innerHTML = '';

    stepsEmptyEl.classList.toggle('hidden', items.length > 0);

    items.forEach((step) => {
        const item = document.createElement('li');
        item.className = `step-item${step.id === selectedStepId ? ' selected' : ''}`;

        const button = document.createElement('button');
        button.className = 'step-button';
        button.type = 'button';
        button.innerHTML = `
            <div class="step-topline">
                <span class="step-title">${escapeHtml(step.title || 'Untitled action')}</span>
                <span class="step-time">${escapeHtml(step.timeLabel || formatTime(step.timestamp))}</span>
            </div>
            <div class="step-selector mono">${escapeHtml(step.selector || step.url || step.subtitle || '')}</div>
            <div class="step-stats">
                <span class="stat-pill network">Network ${step.network.length}</span>
                <span class="stat-pill console">Console ${step.console.length}</span>
                <span class="stat-pill screenshot">SS ${step.screenshots.length}</span>
            </div>
        `;

        button.addEventListener('click', () => {
            selectedStepId = step.id;
            render();
        });

        item.appendChild(button);
        stepListEl.appendChild(item);
    });
}

function renderDetails() {
    const step = getSelectedStep();

    if (!step) {
        detailsEmptyEl.classList.remove('hidden');
        detailsViewEl.classList.add('hidden');
        return;
    }

    detailsEmptyEl.classList.add('hidden');
    detailsViewEl.classList.remove('hidden');

    const isSummary = step.id === SUMMARY_STEP_ID;
    document.getElementById('details-kicker').textContent = isSummary ? 'Recording Summary' : 'Selected Step';
    document.getElementById('step-title').textContent = step.title || 'Untitled action';
    document.getElementById('details-subtitle').textContent = isSummary
        ? 'A consolidated view of the recorded QA journey.'
        : 'Focused inspection for the selected QA event.';
    document.getElementById('step-time').textContent = isSummary
        ? `${session.steps.length} steps`
        : formatDateTime(step.timestamp);
    document.getElementById('step-selector').textContent = isSummary
        ? 'All recorded clicks in order'
        : (step.selector || step.url || 'No selector');
    document.getElementById('network-count').textContent = String(step.network.length);
    document.getElementById('console-count').textContent = String(step.console.length);
    document.getElementById('screenshot-count').textContent = String(step.screenshots.length);
    document.getElementById('flow-count').textContent = String((session.steps || []).length);

    renderTabs();
}

function renderTabs() {
    const step = getSelectedStep();
    if (!step) return;
    const isSummary = step.id === SUMMARY_STEP_ID;

    document.querySelectorAll('.tab-btn').forEach((button) => {
        const allowed = isSummary ? button.dataset.tab === 'steps' : true;
        button.classList.toggle('hidden', !allowed);
        button.classList.toggle('active', allowed && button.dataset.tab === activeTab);
    });

    if (isSummary && activeTab !== 'steps') {
        activeTab = 'steps';
    }

    document.getElementById('tab-network').classList.toggle('hidden', activeTab !== 'network');
    document.getElementById('tab-console').classList.toggle('hidden', activeTab !== 'console');
    document.getElementById('tab-screenshots').classList.toggle('hidden', activeTab !== 'screenshots');
    document.getElementById('tab-steps').classList.toggle('hidden', activeTab !== 'steps');

    document.getElementById('tab-network').innerHTML = renderNetworkTab(step);
    document.getElementById('tab-console').innerHTML = renderConsoleTab(step);
    document.getElementById('tab-screenshots').innerHTML = renderScreenshotsTab(step);
    document.getElementById('tab-steps').innerHTML = renderStepsTab();
}

function renderNetworkTab(step) {
    if (!step.network.length) {
        return `<div class="panel-empty">This action has no captured network requests yet.</div>`;
    }

    return `
        <table class="list-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Host</th>
                    <th>URL</th>
                    <th>Response</th>
                    <th>Duration</th>
                </tr>
            </thead>
            <tbody>
                ${step.network.map((entry) => `
                    <tr>
                        <td>${escapeHtml(formatTime(entry.timestamp))}</td>
                        <td><span class="request-pill">${escapeHtml(entry.method || '')}</span></td>
                        <td class="status-code ${entry.status >= 400 ? 'error-text' : ''}">${escapeHtml(formatStatus(entry))}</td>
                        <td>${escapeHtml(entry.type || '-')}</td>
                        <td class="mono">${escapeHtml(getHost(entry.url))}</td>
                        <td class="mono">${escapeHtml(entry.url || '')}</td>
                        <td class="mono response-cell">${escapeHtml(entry.responseBody || '-')}</td>
                        <td>${entry.duration != null ? `${entry.duration} ms` : '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderConsoleTab(step) {
    if (!step.console.length) {
        return `<div class="panel-empty">No frontend console signal was captured for this step.</div>`;
    }

    return `
        <table class="list-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Component</th>
                    <th>Level</th>
                    <th>Title</th>
                    <th>Message</th>
                    <th>Source</th>
                    <th>Stack</th>
                </tr>
            </thead>
            <tbody>
                ${step.console.map((entry) => `
                    <tr>
                        <td>${escapeHtml(formatTime(entry.timestamp))}</td>
                        <td>
                            <div>${escapeHtml(entry.componentLabel || '-')}</div>
                            <div class="mono">${escapeHtml(entry.component || '-')}</div>
                        </td>
                        <td class="console-level ${entry.level === 'error' ? 'error-text' : entry.level === 'warn' ? 'warn-text' : ''}">${escapeHtml((entry.level || '').toUpperCase())}</td>
                        <td>${escapeHtml(entry.title || '')}</td>
                        <td class="mono">${escapeHtml(entry.message || '')}</td>
                        <td class="mono">${escapeHtml(entry.source || '-')}</td>
                        <td class="mono">${escapeHtml(entry.stack || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderScreenshotsTab(step) {
    if (!step.screenshots.length) {
        return `<div class="panel-empty">If this step throws an error, the captured screenshot will appear here.</div>`;
    }

    return `
        <div class="screenshot-grid">
            ${step.screenshots.map((shot) => `
                <article class="screenshot-card">
                    <img src="${escapeAttribute(shot.url)}" alt="${escapeAttribute(shot.title || 'Screenshot')}">
                    <div class="caption">
                        <strong>${escapeHtml(shot.title || 'Screenshot')}</strong>
                        <div>${escapeHtml(shot.message || '')}</div>
                        <div class="step-time">${escapeHtml(formatDateTime(shot.timestamp))}</div>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderStepsTab() {
    const steps = session.steps || [];
    if (!steps.length) {
        return `<div class="panel-empty">The click flow will appear here in the exact order of the recording.</div>`;
    }

    return `
        <div class="flow-list">
            ${steps.map((step, index) => `
                <button class="flow-step${step.id === selectedStepId ? ' active' : ''}" type="button" data-step-id="${escapeAttribute(step.id)}">
                    <span class="flow-order">${index + 1}</span>
                    <span class="flow-content">
                        <strong>${escapeHtml(step.title || 'Untitled action')}</strong>
                        <span class="mono">${escapeHtml(step.selector || step.url || '')}</span>
                    </span>
                    <span class="flow-time">${escapeHtml(formatTime(step.timestamp))}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function getSelectedStep() {
    if (selectedStepId === SUMMARY_STEP_ID) {
        return buildSummaryItem();
    }
    return (session.steps || []).find((step) => step.id === selectedStepId) || null;
}

function syncSelection() {
    const items = getStepListItems();
    if (!items.length) {
        selectedStepId = null;
        return;
    }

    const exists = items.some((step) => step.id === selectedStepId);
    if (!exists) {
        selectedStepId = items[items.length - 1].id;
    }
}

function createEmptySession() {
    return {
        isRecording: false,
        steps: []
    };
}

function formatTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleTimeString();
}

function formatDateTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
}

function formatStatus(entry) {
    if (entry.status == null) return '-';
    return `${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''}`;
}

function escapeHtml(value) {
    return (value || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function getHost(url) {
    if (!url) return '-';
    try {
        return new URL(url).host || '-';
    } catch (error) {
        return '-';
    }
}

function exportSummary() {
    if (session.isRecording || !(session.steps || []).length) return;

    const html = buildExportHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qa-recording-${Date.now()}.html`;
    link.click();
    URL.revokeObjectURL(url);
    exportScreenshots();
}

function buildExportHtml() {
    const steps = session.steps || [];
    const startedAt = session.startedAt ? formatDateTime(session.startedAt) : '-';
    const stoppedAt = session.stoppedAt ? formatDateTime(session.stoppedAt) : '-';
    const errorSteps = steps.filter((step) => step.network.length || step.console.length || step.screenshots.length).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>QA Recording Summary</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #122033; }
        h1, h2, h3 { margin-bottom: 8px; }
        .meta { margin-bottom: 24px; padding: 16px; background: #f3f7fb; border-radius: 12px; }
        .step { margin-bottom: 24px; padding: 16px; border: 1px solid #d7e3f0; border-radius: 12px; }
        .block { margin-top: 14px; }
        .pill { display: inline-block; margin-right: 8px; padding: 4px 8px; border-radius: 999px; background: #eef6ff; color: #1263a9; font-size: 12px; }
        pre { white-space: pre-wrap; word-break: break-word; background: #0f1720; color: #e8eef5; padding: 12px; border-radius: 8px; overflow: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e1e8f0; vertical-align: top; }
        th { background: #f8fbff; }
    </style>
</head>
<body>
    <h1>QA Recording Summary</h1>
    <div class="meta">
        <div><strong>Started:</strong> ${escapeHtml(startedAt)}</div>
        <div><strong>Stopped:</strong> ${escapeHtml(stoppedAt)}</div>
        <div><strong>Total steps:</strong> ${steps.length}</div>
        <div><strong>Error steps:</strong> ${errorSteps}</div>
    </div>
    ${steps.map((step, index) => `
        <section class="step">
            <h2>${index + 1}. ${escapeHtml(step.title || 'Untitled action')}</h2>
            <div class="pill">Time ${escapeHtml(formatDateTime(step.timestamp))}</div>
            <div class="pill">Selector ${escapeHtml(step.selector || '-')}</div>
            <div class="pill">Network ${step.network.length}</div>
            <div class="pill">Console ${step.console.length}</div>
            <div class="pill">SS ${step.screenshots.length}</div>

            ${step.network.length ? `
                <div class="block">
                    <h3>Network Errors</h3>
                    <table>
                        <thead>
                            <tr><th>Method</th><th>Status</th><th>URL</th><th>Response</th></tr>
                        </thead>
                        <tbody>
                            ${step.network.map((entry) => `
                                <tr>
                                    <td>${escapeHtml(entry.method || '-')}</td>
                                    <td>${escapeHtml(formatStatus(entry))}</td>
                                    <td>${escapeHtml(entry.url || '-')}</td>
                                    <td><pre>${escapeHtml(entry.responseBody || '-')}</pre></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${step.console.length ? `
                <div class="block">
                    <h3>Console Errors</h3>
                    <table>
                        <thead>
                            <tr><th>Component</th><th>Message</th><th>Source</th><th>Stack</th></tr>
                        </thead>
                        <tbody>
                            ${step.console.map((entry) => `
                                <tr>
                                    <td>${escapeHtml(entry.componentLabel || '-')}<br><small>${escapeHtml(entry.component || '-')}</small></td>
                                    <td>${escapeHtml(entry.message || '-')}</td>
                                    <td>${escapeHtml(entry.source || '-')}</td>
                                    <td><pre>${escapeHtml(entry.stack || '-')}</pre></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
        </section>
    `).join('')}
</body>
</html>`;
}

function exportScreenshots() {
    const screenshots = [];
    (session.steps || []).forEach((step, stepIndex) => {
        (step.screenshots || []).forEach((shot, shotIndex) => {
            screenshots.push({
                ...shot,
                name: `qa-step-${stepIndex + 1}-shot-${shotIndex + 1}.png`
            });
        });
    });

    screenshots.forEach((shot, index) => {
        setTimeout(() => {
            const link = document.createElement('a');
            link.href = shot.url;
            link.download = shot.name;
            link.click();
        }, index * 120);
    });
}

function getStepListItems() {
    const steps = session.steps || [];
    if (!steps.length) return [];

    const items = [...steps];
    if (!session.isRecording) {
        items.push(buildSummaryItem());
    }
    return items;
}

function buildSummaryItem() {
    const steps = session.steps || [];
    const startedAt = session.startedAt ? formatTime(session.startedAt) : '-';
    const stoppedAt = session.stoppedAt ? formatTime(session.stoppedAt) : '-';

    return {
        id: SUMMARY_STEP_ID,
        title: 'Recording Summary',
        subtitle: `Start ${startedAt} / Stop ${stoppedAt}`,
        selector: 'All recorded clicks in order',
        timeLabel: 'Summary',
        network: [],
        console: [],
        screenshots: [],
        timestamp: session.stoppedAt || Date.now()
    };
}

document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const flowStep = target.closest('.flow-step');
    if (!flowStep) return;

    selectedStepId = flowStep.getAttribute('data-step-id');
    activeTab = selectedStepId === SUMMARY_STEP_ID ? 'steps' : 'network';
    render();
});
