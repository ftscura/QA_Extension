let currentTabId = null;
let session = createEmptySession();
let selectedStepId = null;
let activeTab = 'network';

const stepListEl = document.getElementById('step-list');
const stepsEmptyEl = document.getElementById('steps-empty');
const detailsEmptyEl = document.getElementById('details-empty');
const detailsViewEl = document.getElementById('details-view');
const recordingIndicatorEl = document.getElementById('recording-indicator');
const stepCountEl = document.getElementById('step-count');
const metricRecordedEl = document.getElementById('metric-recorded');
const metricErrorsEl = document.getElementById('metric-errors');
const metricShotsEl = document.getElementById('metric-shots');
const summaryFailuresEl = document.getElementById('summary-failures');
const summaryOwnerEl = document.getElementById('summary-owner');
const summarySeverityEl = document.getElementById('summary-severity');

document.getElementById('start-btn').addEventListener('click', startRecording);
document.getElementById('stop-btn').addEventListener('click', stopRecording);
document.getElementById('clear-btn').addEventListener('click', clearSession);

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
        syncSelection();
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
    const errorSteps = steps.filter((step) => hasFailureSignal(step)).length;
    const totalShots = steps.reduce((count, step) => count + step.screenshots.length, 0);

    recordingIndicatorEl.textContent = isRecording ? 'Recording' : 'Idle';
    recordingIndicatorEl.className = `recording-indicator ${isRecording ? 'recording' : 'idle'}`;
    stepCountEl.textContent = String(steps.length);
    metricRecordedEl.textContent = String(steps.length);
    metricErrorsEl.textContent = String(errorSteps);
    metricShotsEl.textContent = String(totalShots);
}

function renderStepList() {
    const steps = session.steps || [];
    stepListEl.innerHTML = '';

    stepsEmptyEl.classList.toggle('hidden', steps.length > 0);

    steps.forEach((step) => {
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
                ${step.assessment && step.assessment.silentFailure ? '<span class="stat-pill silent">Silent</span>' : ''}
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

    document.getElementById('details-kicker').textContent = 'Selected Step';
    document.getElementById('step-title').textContent = step.title || 'Untitled action';
    document.getElementById('details-subtitle').textContent = 'Focused inspection for the selected QA event.';
    document.getElementById('step-time').textContent = formatDateTime(step.timestamp);
    document.getElementById('step-selector').textContent = step.selector || step.url || 'No selector';
    document.getElementById('network-count').textContent = String(step.network.length);
    document.getElementById('console-count').textContent = String(step.console.length);
    document.getElementById('screenshot-count').textContent = String(step.screenshots.length);
    document.getElementById('flow-count').textContent = String((session.steps || []).length);
    document.getElementById('bug-report-count').textContent = String(getSessionBugCount());
    summaryFailuresEl.textContent = String(getSessionBugCount());
    summaryOwnerEl.textContent = inferLikelyOwner(getFailedSteps());
    summarySeverityEl.textContent = inferSessionSeverity(getFailedSteps(), session.steps || []);
    document.getElementById('pinned-evidence').innerHTML = renderPinnedEvidence(step);
    document.getElementById('timeline-view').innerHTML = renderTimeline(step);

    renderTabs();
}

function renderTabs() {
    const step = getSelectedStep();
    if (!step) return;

    document.querySelectorAll('.tab-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === activeTab);
    });

    document.getElementById('tab-network').classList.toggle('hidden', activeTab !== 'network');
    document.getElementById('tab-console').classList.toggle('hidden', activeTab !== 'console');
    document.getElementById('tab-screenshots').classList.toggle('hidden', activeTab !== 'screenshots');
    document.getElementById('tab-steps').classList.toggle('hidden', activeTab !== 'steps');
    document.getElementById('tab-bug-report').classList.toggle('hidden', activeTab !== 'bug-report');

    document.getElementById('tab-network').innerHTML = renderNetworkTab(step);
    document.getElementById('tab-console').innerHTML = renderConsoleTab(step);
    document.getElementById('tab-screenshots').innerHTML = renderScreenshotsTab(step);
    document.getElementById('tab-steps').innerHTML = renderStepsTab();
    document.getElementById('tab-bug-report').innerHTML = renderBugReportTab(step);
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
                        ${step.assessment && step.assessment.silentFailure ? '<span class="silent-note">No visible follow-up was detected after this action.</span>' : ''}
                    </span>
                    <span class="flow-time">${escapeHtml(formatTime(step.timestamp))}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderBugReportTab(step) {
    if (!getSessionBugCount()) {
        return `<div class="panel-empty">The bug report will appear here once the session captures failure evidence.</div>`;
    }

    const report = buildSessionBugReport();
    return `
        <div class="bug-report-shell">
            <div class="bug-report-actions">
                <button type="button" id="copy-bug-report-btn">Copy Report</button>
                <button type="button" id="download-bug-package-btn" class="primary-btn">Download Package</button>
            </div>
            <div class="bug-report-meta">
                <div><span>Likely Owner</span><strong>${escapeHtml(inferLikelyOwner(getFailedSteps()))}</strong></div>
                <div><span>Severity</span><strong>${escapeHtml(inferSessionSeverity(getFailedSteps(), session.steps || []))}</strong></div>
            </div>
            <pre class="bug-report-output">${escapeHtml(report)}</pre>
        </div>
    `;
}

function renderPinnedEvidence(step) {
    const pinnedItems = [];
    const firstConsole = step.console[0];
    const firstNetwork = step.network[0];
    const firstShot = step.screenshots[0];

    if (firstNetwork) {
        pinnedItems.push(`
            <div class="pinned-item danger">
                <span class="pinned-label">Top Network Failure</span>
                <strong>${escapeHtml(formatStatus(firstNetwork))}</strong>
                <div class="pinned-text mono">${escapeHtml(firstNetwork.url || '-')}</div>
            </div>
        `);
    }

    if (firstConsole) {
        pinnedItems.push(`
            <div class="pinned-item warning">
                <span class="pinned-label">Top Console Signal</span>
                <strong>${escapeHtml(firstConsole.title || 'Console error')}</strong>
                <div class="pinned-text">${escapeHtml(firstConsole.message || '-')}</div>
            </div>
        `);
    }

    if (step.assessment && step.assessment.silentFailure) {
        pinnedItems.push(`
            <div class="pinned-item silent">
                <span class="pinned-label">Silent Failure</span>
                <strong>No visible follow-up</strong>
                <div class="pinned-text">${escapeHtml(step.assessment.reason || '-')}</div>
            </div>
        `);
    }

    if (firstShot) {
        pinnedItems.push(`
            <div class="pinned-item success">
                <span class="pinned-label">Screenshot Evidence</span>
                <strong>Captured</strong>
                <div class="pinned-text">${escapeHtml(formatDateTime(firstShot.timestamp))}</div>
            </div>
        `);
    }

    if (!pinnedItems.length) {
        return `<div class="panel-empty compact">No critical evidence is pinned for this step yet.</div>`;
    }

    return pinnedItems.join('');
}

function renderTimeline(step) {
    const events = [];

    events.push({
        tone: 'neutral',
        title: step.title || 'Step action',
        text: step.selector || step.url || 'Action recorded',
        time: step.timestamp
    });

    step.network.forEach((entry) => {
        events.push({
            tone: 'danger',
            title: `${entry.method || 'REQUEST'} ${formatStatus(entry)}`,
            text: entry.url || '-',
            time: entry.timestamp
        });
    });

    step.console.forEach((entry) => {
        events.push({
            tone: 'warning',
            title: entry.title || 'Console error',
            text: entry.message || '-',
            time: entry.timestamp
        });
    });

    step.screenshots.forEach((entry) => {
        events.push({
            tone: 'success',
            title: 'Screenshot captured',
            text: entry.message || 'Visual evidence saved',
            time: entry.timestamp
        });
    });

    if (step.assessment && step.assessment.silentFailure) {
        events.push({
            tone: 'silent',
            title: 'Silent failure detected',
            text: step.assessment.reason || '-',
            time: step.timestamp + 1400
        });
    }

    events.sort((a, b) => (a.time || 0) - (b.time || 0));

    return `
        <div class="timeline-list">
            ${events.map((event) => `
                <article class="timeline-item ${event.tone}">
                    <div class="timeline-dot"></div>
                    <div class="timeline-content">
                        <div class="timeline-topline">
                            <strong>${escapeHtml(event.title)}</strong>
                            <span>${escapeHtml(formatTime(event.time))}</span>
                        </div>
                        <div class="timeline-text">${escapeHtml(event.text)}</div>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function getSelectedStep() {
    return (session.steps || []).find((step) => step.id === selectedStepId) || null;
}

function syncSelection() {
    const items = session.steps || [];
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

function getSessionBugCount() {
    return (session.steps || []).filter((step) => hasFailureSignal(step)).length;
}

function getFailedSteps() {
    return (session.steps || []).filter((step) => hasFailureSignal(step));
}

function buildSessionBugReport() {
    const steps = session.steps || [];
    const failedSteps = getFailedSteps();
    const headline = buildReportHeadline(failedSteps, steps);
    const impact = buildImpactSummary(failedSteps, steps);
    const owner = inferLikelyOwner(failedSteps);
    const severity = inferSessionSeverity(failedSteps, steps);
    const expectedOutcome = buildExpectedOutcome(steps, failedSteps);

    return [
        'BUG REPORT',
        '',
        `Title: ${headline}`,
        `Suggested Severity: ${severity}`,
        `Likely Owner: ${owner}`,
        `Routing Signal: ${buildOwnerReason(owner, failedSteps)}`,
        `Severity Signal: ${buildSeverityReason(severity, failedSteps, steps)}`,
        'Environment: Browser QA Extension Session',
        `Started: ${session.startedAt ? formatDateTime(session.startedAt) : '-'}`,
        `Stopped: ${session.stoppedAt ? formatDateTime(session.stoppedAt) : '-'}`,
        `Total Recorded Steps: ${steps.length}`,
        `Failed Steps: ${failedSteps.length}`,
        '',
        'Summary:',
        impact,
        '',
        'Expected Outcome:',
        expectedOutcome,
        '',
        'Flow Steps:',
        steps.map((item, index) => `${index + 1}. ${item.title || 'Untitled action'}`).join('\n') || '-',
        '',
        'Observed Failures:',
        failedSteps.map((step, index) => buildFailureBlock(step, index + 1)).join('\n\n') || '-'
    ].join('\n');
}

function buildFailureBlock(step, order) {
    return [
        `${order}. ${step.title || 'Untitled action'}`,
        `   Time: ${formatDateTime(step.timestamp)}`,
        `   Target: ${step.selector || '-'}`,
        `   Result: ${inferActualResult(step)}`,
        `   Evidence:`,
        indentBlock(buildEvidenceSection(step), '   ')
    ].join('\n');
}

function inferSessionSeverity(failedSteps, allSteps) {
    if (failedSteps.some((step) => step.network.some((entry) => Number(entry.status) >= 500))) {
        return 'High (server-side failure observed)';
    }

    if (failedSteps.some((step) => step.assessment && step.assessment.silentFailure)) {
        return 'Medium (user action completed without visible follow-up)';
    }

    const lastFailedStep = failedSteps[failedSteps.length - 1];
    const lastStep = allSteps[allSteps.length - 1];
    if (lastFailedStep && lastStep && lastFailedStep.id === lastStep.id && failedSteps.length === 1) {
        return 'Medium (failure occurs on the final recorded step)';
    }

    if (failedSteps.length) {
        return 'Low to Medium (non-blocking errors observed during flow)';
    }

    return 'Low';
}

function inferActualResult(step) {
    const parts = [];
    if (step.console.length) {
        parts.push(`Console error captured: ${step.console[0].message || step.console[0].title}`);
    }
    if (step.network.length) {
        const first = step.network[0];
        parts.push(`Network request failed with ${formatStatus(first)}.`);
    }
    if (step.screenshots.length) {
        parts.push('Screenshot captured during failure.');
    }
    if (step.assessment && step.assessment.silentFailure) {
        parts.push('The action did not trigger a visible UI change, URL transition, or technical failure signal.');
    }
    return parts.join(' ') || 'Failure evidence captured during the selected step.';
}

function indentBlock(text, prefix) {
    return (text || '-')
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n');
}

function buildEvidenceSection(step) {
    const lines = [];

    if (step.console.length) {
        lines.push('Console:');
        step.console.forEach((entry) => {
            lines.push(`- ${entry.title || 'Error'} | Component: ${entry.componentLabel || '-'} / ${entry.component || '-'}`);
            lines.push(`  Message: ${entry.message || '-'}`);
        });
    }

    if (step.network.length) {
        lines.push('Network:');
        step.network.forEach((entry) => {
            lines.push(`- ${entry.method || '-'} ${formatStatus(entry)} ${entry.url || '-'}`);
            if (entry.responseBody) {
                lines.push(`  Response: ${entry.responseBody.replace(/\s+/g, ' ').slice(0, 500)}`);
            }
        });
    }

    if (step.screenshots.length) {
        lines.push(`Screenshots: ${step.screenshots.length} captured`);
    }

    if (step.assessment && step.assessment.silentFailure) {
        lines.push('Silent failure:');
        lines.push(`- ${step.assessment.reason}`);
    }

    return lines.join('\n') || '-';
}

function hasFailureSignal(step) {
    return Boolean(
        step &&
        (
            step.network.length ||
            step.console.length ||
            step.screenshots.length ||
            (step.assessment && step.assessment.silentFailure)
        )
    );
}

function buildReportHeadline(failedSteps, steps) {
    if (!failedSteps.length) {
        return 'No failure evidence captured during the QA session';
    }

    const firstFailure = failedSteps[0];
    if (firstFailure.network.length) {
        const firstNetworkError = firstFailure.network[0];
        return `${firstFailure.title || 'Flow step'} returned ${formatStatus(firstNetworkError)} during QA flow`;
    }

    if (firstFailure.console.length) {
        return `${firstFailure.title || 'Flow step'} triggered a frontend console error during QA flow`;
    }

    return `${failedSteps.length} failure signal(s) captured across ${steps.length} recorded step(s)`;
}

function buildImpactSummary(failedSteps, steps) {
    if (!failedSteps.length) {
        return 'The recorded session completed without captured failure evidence.';
    }

    const lastFailedStep = failedSteps[failedSteps.length - 1];
    const lastStep = steps[steps.length - 1];

    if (lastFailedStep && lastStep && lastFailedStep.id === lastStep.id) {
        return 'The latest failure appears on the final recorded step, so this issue may block completion of the tested flow.';
    }

    return 'Failure evidence was captured during the flow, but the recording continued afterwards. This may indicate a non-blocking issue, degraded experience, or silent regression.';
}

function inferLikelyOwner(failedSteps) {
    if (!failedSteps.length) {
        return 'Unassigned';
    }

    const hasServerError = failedSteps.some((step) =>
        step.network.some((entry) => Number.parseInt(entry.status, 10) >= 500)
    );
    if (hasServerError) {
        return 'Backend';
    }

    const hasFrontendError = failedSteps.some((step) => step.console.length > 0);
    const hasClientError = failedSteps.some((step) =>
        step.network.some((entry) => {
            const status = Number.parseInt(entry.status, 10);
            return status >= 400 && status < 500;
        })
    );

    if (hasFrontendError && hasClientError) {
        return 'Frontend / Integration';
    }

    if (hasFrontendError) {
        return 'Frontend';
    }

    const hasThirdPartyError = failedSteps.some((step) =>
        step.network.some((entry) => {
            const host = getHost(entry.url);
            const appHost = getHost(step.url);
            return host && appHost && host !== appHost;
        })
    );
    if (hasThirdPartyError) {
        return 'Third-party / Integration';
    }

    if (hasClientError) {
        return 'Integration';
    }

    return 'Needs triage';
}

function buildOwnerReason(owner, failedSteps) {
    if (owner === 'Backend') {
        return 'One or more failed requests returned a 5xx status code.';
    }
    if (owner === 'Frontend') {
        return 'Frontend console errors were captured without stronger backend failure signals.';
    }
    if (owner === 'Frontend / Integration') {
        return 'Both console errors and client-side request failures were captured.';
    }
    if (owner === 'Third-party / Integration') {
        return 'At least one failed request targeted an external host.';
    }
    if (owner === 'Integration') {
        return 'Request failures were captured without direct frontend exception evidence.';
    }
    if (failedSteps.some((step) => step.assessment && step.assessment.silentFailure)) {
        return 'User actions completed without visible follow-up or technical error evidence.';
    }
    return 'No dominant failure pattern could be inferred automatically.';
}

function buildSeverityReason(severity, failedSteps, steps) {
    if (severity.startsWith('High')) {
        return 'A server-side failure was captured, which usually affects core business flow reliability.';
    }

    if (severity.startsWith('Medium (user action completed without visible follow-up)')) {
        return 'A user action completed without any visible UI transition, URL change, or explicit error, which suggests a broken or ignored interaction.';
    }

    const lastFailedStep = failedSteps[failedSteps.length - 1];
    const lastStep = steps[steps.length - 1];
    if (severity.startsWith('Medium') && lastFailedStep && lastStep && lastFailedStep.id === lastStep.id) {
        return 'The final recorded step contains the failure signal, so it may prevent the user from finishing the scenario.';
    }

    if (severity.startsWith('Low to Medium')) {
        return 'Failure evidence exists, but the flow continued afterwards, so the impact is likely partial or non-blocking.';
    }

    return 'No critical failure signal was captured.';
}

function buildExpectedOutcome(steps, failedSteps) {
    if (!steps.length) {
        return 'The tested flow should complete successfully without technical or visual regression signals.';
    }

    const lastStep = steps[steps.length - 1];
    const failedFinalStep = failedSteps.length && failedSteps[failedSteps.length - 1].id === lastStep.id;

    if (failedFinalStep) {
        return `After "${lastStep.title}", the flow should continue to the next expected state without backend failure, frontend error, or stalled UI feedback.`;
    }

    return 'Each recorded step should trigger its expected UI or navigation response, and the full flow should complete without console errors, failed requests, or silent no-op actions.';
}

document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const flowStep = target.closest('.flow-step');
    if (flowStep) {
        selectedStepId = flowStep.getAttribute('data-step-id');
        activeTab = 'network';
        render();
        return;
    }

    if (target.id === 'copy-bug-report-btn') {
        navigator.clipboard.writeText(buildSessionBugReport()).catch(() => {});
        return;
    }

    if (target.id === 'download-bug-package-btn') {
        downloadBugPackage();
    }
});

function downloadBugPackage() {
    const failedSteps = getFailedSteps();
    if (!failedSteps.length) return;

    const folderName = `qa-bug-package-${Date.now()}`;
    const reportBlob = new Blob([buildSessionBugReport()], { type: 'text/plain;charset=utf-8' });
    const reportUrl = URL.createObjectURL(reportBlob);

    chrome.downloads.download({
        url: reportUrl,
        filename: `${folderName}/bug-report.txt`,
        saveAs: false
    }, () => URL.revokeObjectURL(reportUrl));

    failedSteps.forEach((step, stepIndex) => {
        (step.screenshots || []).forEach((shot, shotIndex) => {
            chrome.downloads.download({
                url: shot.url,
                filename: `${folderName}/${String(stepIndex + 1).padStart(2, '0')}-${toFileSafeName(step.title || 'step')}-ss-${shotIndex + 1}.png`,
                saveAs: false
            });
        });
    });
}

function toFileSafeName(value) {
    return String(value || 'step')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'step';
}
