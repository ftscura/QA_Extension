if (!window.__qaExtensionContentLoaded) {
window.__qaExtensionContentLoaded = true;

function sendMessage(type, payload) {
    try {
        chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
        // Extension context is not available.
    }
}

let lastMutationAt = Date.now();
const mutationObserver = new MutationObserver(() => {
    lastMutationAt = Date.now();
});

mutationObserver.observe(document.documentElement || document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
});

document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const metadata = buildElementMetadata(target);
    const clientActionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sendMessage('qa_click', {
        ...metadata,
        clientActionId,
        actionType: 'click',
        message: `Clicked ${metadata.selector}`,
        url: window.location.href,
        timestamp: Date.now()
    });
    scheduleAssessment(clientActionId, 'click', window.location.href);
}, true);

document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
    }

    const metadata = buildElementMetadata(target);
    const clientActionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sendMessage('qa_click', {
        ...metadata,
        clientActionId,
        actionType: 'input',
        message: `Updated ${metadata.selector}`,
        url: window.location.href,
        timestamp: Date.now()
    });
    scheduleAssessment(clientActionId, 'input', window.location.href);
}, true);

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'qa_extension_injected') return;

    const payload = event.data.payload || {};
    if (payload.channel === 'console') {
        sendMessage('qa_console', payload);
    } else if (payload.channel === 'network') {
        sendMessage('qa_network', payload);
    }
});

const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/injected.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

function buildElementMetadata(target) {
    const className = typeof target.className === 'string'
        ? target.className.trim().replace(/\s+/g, '.')
        : '';
    let selector = target.tagName.toLowerCase();
    if (target.id) selector += `#${target.id}`;
    if (className) selector += `.${className}`;

    return {
        tagName: target.tagName,
        id: target.id || '',
        name: target.getAttribute('name') || '',
        ariaLabel: target.getAttribute('aria-label') || '',
        titleAttr: target.getAttribute('title') || '',
        placeholder: target.getAttribute('placeholder') || '',
        elementText: getBestElementText(target),
        selector
    };
}

function getBestElementText(target) {
    const candidates = [
        target.innerText,
        target.textContent,
        target.getAttribute('aria-label'),
        target.getAttribute('title'),
        target.getAttribute('placeholder'),
        target.getAttribute('value'),
        target.closest('button, a, label, [role="button"]')?.innerText,
        target.closest('[aria-label]')?.getAttribute('aria-label')
    ];

    for (const value of candidates) {
        const normalized = (value || '').trim().replace(/\s+/g, ' ');
        if (normalized) return normalized.slice(0, 120);
    }

    return '';
}

function scheduleAssessment(clientActionId, actionType, startingUrl) {
    const actionStartedAt = Date.now();

    window.setTimeout(() => {
        sendMessage('qa_step_assessment', {
            clientActionId,
            actionType,
            startingUrl,
            endingUrl: window.location.href,
            urlChanged: startingUrl !== window.location.href,
            domChanged: lastMutationAt >= actionStartedAt
        });
    }, 1400);
}

}
