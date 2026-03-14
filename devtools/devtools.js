var inspectedTabId = chrome.devtools.inspectedWindow.tabId;

chrome.devtools.panels.create('QA Panel', '', 'devtools/panel.html', function() {});

chrome.devtools.network.onRequestFinished.addListener(function(request) {
    chrome.runtime.sendMessage({
        type: 'qa_network',
        tabId: inspectedTabId,
        payload: {
            url: request.request && request.request.url ? request.request.url : '',
            method: request.request && request.request.method ? request.request.method : 'GET',
            status: request.response && typeof request.response.status !== 'undefined' ? request.response.status : null,
            statusText: request.response && request.response.statusText ? request.response.statusText : '',
            resourceType: request._resourceType || '',
            duration: typeof request.time === 'number' ? Math.round(request.time) : null,
            timestamp: Date.now()
        }
    }).catch(function() {});
});
