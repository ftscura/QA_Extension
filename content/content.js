function sendMessage(type, payload) {
    try {
        chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
        // Extension context is not available.
    }
}

document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const elementText = (target.innerText || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const className = typeof target.className === 'string'
        ? target.className.trim().replace(/\s+/g, '.')
        : '';

    let selector = target.tagName.toLowerCase();
    if (target.id) selector += `#${target.id}`;
    if (className) selector += `.${className}`;

    sendMessage('qa_click', {
        tagName: target.tagName,
        id: target.id || '',
        name: target.getAttribute('name') || '',
        ariaLabel: target.getAttribute('aria-label') || '',
        elementText,
        selector,
        message: `Clicked ${selector}`,
        url: window.location.href,
        timestamp: Date.now()
    });
}, true);

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'qa_extension_injected') return;

    const payload = event.data.payload || {};
    if (payload.channel === 'console') {
        sendMessage('qa_console', payload);
    }
});

const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/injected.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);
