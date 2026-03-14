var inspectedTabId = chrome.devtools.inspectedWindow.tabId;

chrome.devtools.panels.create('QA Panel', '', 'devtools/panel.html', function() {});

chrome.devtools.network.onRequestFinished.addListener(function(request) {
    var status = request.response && typeof request.response.status !== 'undefined' ? request.response.status : null;
    var payload = {
        url: request.request && request.request.url ? request.request.url : '',
        method: request.request && request.request.method ? request.request.method : 'GET',
        status: status,
        statusText: request.response && request.response.statusText ? request.response.statusText : '',
        resourceType: request._resourceType || '',
        duration: typeof request.time === 'number' ? Math.round(request.time) : null,
        timestamp: Date.now()
    };

    if (status != null && status < 400) {
        chrome.runtime.sendMessage({
            type: 'qa_network',
            tabId: inspectedTabId,
            payload: payload
        }).catch(function() {});
        return;
    }

    request.getContent(function(content, encoding) {
        payload.responseBody = (content || '').slice(0, 2000);
        payload.responseMimeType = request.response && request.response.content ? request.response.content.mimeType || '' : '';

        chrome.runtime.sendMessage({
            type: 'qa_network',
            tabId: inspectedTabId,
            payload: payload
        }).catch(function() {});
    });
});
