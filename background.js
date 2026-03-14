const STORAGE_KEY = 'qa_session_state';
const MAX_STEPS = 200;
const MAX_ITEMS_PER_STEP = 100;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
            console.error('QA Extension background error:', error);
            sendResponse({ ok: false, error: error.message });
        });

    return true;
});

async function handleMessage(request, sender) {
    if (!request || !request.type) {
        return { ok: false, error: 'Invalid request' };
    }

    const tabId = request.tabId ?? sender?.tab?.id;
    const windowId = request.windowId ?? sender?.tab?.windowId;

    switch (request.type) {
        case 'start_recording':
            return startRecording(tabId);
        case 'stop_recording':
            return stopRecording(tabId);
        case 'clear_session':
            return clearSession(tabId);
        case 'get_session':
            return getSessionResponse(tabId);
        case 'qa_click':
            if (tabId == null) return { ok: false, error: 'Missing tabId' };
            await addStep(tabId, request.payload);
            return { ok: true };
        case 'qa_console':
            if (tabId == null) return { ok: false, error: 'Missing tabId' };
            await appendConsoleEntry(tabId, request.payload, windowId);
            return { ok: true };
        case 'qa_network':
            if (tabId == null) return { ok: false, error: 'Missing tabId' };
            await appendNetworkEntry(tabId, request.payload);
            return { ok: true };
        case 'qa_step_assessment':
            if (tabId == null) return { ok: false, error: 'Missing tabId' };
            await applyStepAssessment(tabId, request.payload);
            return { ok: true };
        default:
            return { ok: false, error: `Unknown request type: ${request.type}` };
    }
}

async function getSessionState() {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || { sessions: {} };
}

async function setSessionState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function createEmptySession(tabId) {
    return {
        tabId,
        isRecording: false,
        startedAt: null,
        stoppedAt: null,
        currentStepId: null,
        steps: []
    };
}

function normalizeSession(state, tabId) {
    const key = String(tabId);
    if (!state.sessions[key]) {
        state.sessions[key] = createEmptySession(tabId);
    }
    return state.sessions[key];
}

async function startRecording(tabId) {
    if (tabId == null) return { ok: false, error: 'Missing tabId' };

    const state = await getSessionState();
    const session = createEmptySession(tabId);
    session.isRecording = true;
    session.startedAt = Date.now();
    state.sessions[String(tabId)] = session;
    await setSessionState(state);
    await broadcastSession(tabId, session);
    return { ok: true, session };
}

async function stopRecording(tabId) {
    if (tabId == null) return { ok: false, error: 'Missing tabId' };

    const state = await getSessionState();
    const session = normalizeSession(state, tabId);
    session.isRecording = false;
    session.stoppedAt = Date.now();
    await setSessionState(state);
    await broadcastSession(tabId, session);
    return { ok: true, session };
}

async function clearSession(tabId) {
    if (tabId == null) return { ok: false, error: 'Missing tabId' };

    const state = await getSessionState();
    state.sessions[String(tabId)] = createEmptySession(tabId);
    await setSessionState(state);
    await broadcastSession(tabId, state.sessions[String(tabId)]);
    return { ok: true };
}

async function getSessionResponse(tabId) {
    if (tabId == null) return { ok: false, error: 'Missing tabId' };

    const state = await getSessionState();
    const session = normalizeSession(state, tabId);
    return { ok: true, session };
}

async function addStep(tabId, payload) {
    await updateSession(tabId, async (session) => {
        if (!session.isRecording) return;

        const stepId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const title = deriveStepTitle(payload);
        const step = {
            id: stepId,
            title,
            actionType: payload.actionType || 'click',
            clientActionId: payload.clientActionId || '',
            selector: payload.selector || '',
            message: payload.message || '',
            url: payload.url || '',
            timestamp: payload.timestamp || Date.now(),
            network: [],
            console: [],
            screenshots: [],
            assessment: {
                evaluated: false,
                domChanged: false,
                urlChanged: false,
                silentFailure: false,
                reason: ''
            }
        };

        session.steps.push(step);
        session.currentStepId = stepId;

        if (session.steps.length > MAX_STEPS) {
            session.steps = session.steps.slice(-MAX_STEPS);
        }
    });
}

async function appendConsoleEntry(tabId, payload, windowId) {
    await updateSession(tabId, async (session) => {
        if (!session.isRecording || !session.currentStepId) return;
        if (payload.level !== 'error') return;

        const step = session.steps.find((item) => item.id === session.currentStepId);
        if (!step) return;

        const entry = {
            level: payload.level || 'error',
            title: payload.title || 'Console',
            message: payload.message || '',
            component: step.selector || '',
            componentLabel: step.title || '',
            url: payload.url || '',
            timestamp: payload.timestamp || Date.now()
        };

        step.console.push(entry);
        trimItems(step.console);

        if (entry.level === 'error' && windowId != null) {
            const screenshotUrl = await captureScreenshot(windowId);
            if (screenshotUrl) {
                step.screenshots.push({
                    title: entry.title || 'Error Screenshot',
                    message: entry.message || '',
                    url: screenshotUrl,
                    timestamp: Date.now()
                });
                trimItems(step.screenshots);
            }
        }
    });
}

async function appendNetworkEntry(tabId, payload) {
    await updateSession(tabId, async (session) => {
        if (!session.isRecording || !session.currentStepId) return;
        if (!isNetworkError(payload)) return;

        const step = session.steps.find((item) => item.id === session.currentStepId);
        if (!step) return;

        step.network.push({
            method: payload.method || 'GET',
            url: payload.url || '',
            status: payload.status ?? null,
            statusText: payload.statusText || '',
            type: payload.resourceType || payload.type || '',
            responseBody: payload.responseBody || '',
            responseMimeType: payload.responseMimeType || '',
            duration: payload.duration ?? null,
            timestamp: payload.timestamp || Date.now()
        });
        trimItems(step.network);
    });
}

async function applyStepAssessment(tabId, payload) {
    await updateSession(tabId, async (session) => {
        if (!payload || !payload.clientActionId) return;

        const step = session.steps.find((item) => item.clientActionId === payload.clientActionId);
        if (!step) return;

        const domChanged = Boolean(payload.domChanged);
        const urlChanged = Boolean(payload.urlChanged);
        const hasFailureSignals = step.network.length > 0 || step.console.length > 0 || step.screenshots.length > 0;
        const isSilentFailure = !hasFailureSignals && !domChanged && !urlChanged && step.actionType === 'click';

        step.assessment = {
            evaluated: true,
            domChanged,
            urlChanged,
            silentFailure: isSilentFailure,
            reason: isSilentFailure ? 'No visible UI change, URL change, or technical error was captured after the action.' : ''
        };
    });
}

function isNetworkError(payload) {
    if (!payload) return false;
    if (payload.failed) return true;
    if (payload.status == null) return true;
    return Number(payload.status) >= 400;
}

async function updateSession(tabId, mutator) {
    const state = await getSessionState();
    const session = normalizeSession(state, tabId);
    await mutator(session);
    await setSessionState(state);
    await broadcastSession(tabId, session);
}

function trimItems(items) {
    if (items.length > MAX_ITEMS_PER_STEP) {
        items.splice(0, items.length - MAX_ITEMS_PER_STEP);
    }
}

function deriveStepTitle(payload) {
    const label = normalizeStepLabel(
        payload.elementText ||
        payload.ariaLabel ||
        payload.titleAttr ||
        payload.placeholder ||
        payload.name ||
        payload.id ||
        payload.tagName ||
        'Element'
    );

    if (payload.actionType === 'input') {
        return `Entered ${label}`;
    }

    return `Clicked ${label}`;
}

function normalizeStepLabel(label) {
    const cleaned = String(label || 'Element')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

    if (!cleaned) return 'Element';

    if (/^[A-Z0-9 _-]+$/.test(cleaned)) {
        return toTitleCase(cleaned.toLowerCase());
    }

    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function toTitleCase(value) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function captureScreenshot(windowId) {
    try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (error) {
        console.error('QA Extension: screenshot capture failed', error);
        return null;
    }
}

async function broadcastSession(tabId, session) {
    try {
        await chrome.runtime.sendMessage({
            type: 'session_updated',
            tabId,
            session
        });
    } catch (error) {
        // No active listeners.
    }
}
