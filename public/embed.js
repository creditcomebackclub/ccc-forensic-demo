(function() {
  // Prevent the widget from embedding itself inside an iframe
  if (window.self !== window.top) return;

  const SCRIPT_URL = document.currentScript ? document.currentScript.src : '';
  // Default to the production URL, or derive it from the script location
  const BASE_URL = SCRIPT_URL ? new URL(SCRIPT_URL).origin : 'https://ccc-forensic-demo.netlify.app';

  // 1. Create a container for the widget to isolate it
  const container = document.createElement('div');
  container.id = 'ccc-widget-container';
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.zIndex = '999999';
  container.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  document.body.appendChild(container);

  // 2. Create the floating action button
  const button = document.createElement('button');
  button.id = 'ccc-widget-button';
  button.style.width = '56px';
  button.style.height = '56px';
  button.style.borderRadius = '50%';
  button.style.backgroundColor = '#1B2A4A'; // navy
  button.style.color = '#FBBF24'; // amber-400
  button.style.border = 'none';
  button.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
  button.style.cursor = 'pointer';
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.transition = 'transform 0.2s ease-in-out';
  button.style.position = 'absolute';
  button.style.bottom = '0';
  button.style.right = '0';
  
  // Icon SVG
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"></path>
    </svg>
  `;

  button.onmouseover = () => button.style.transform = 'scale(1.05)';
  button.onmouseout = () => button.style.transform = 'scale(1)';

  // 2.5 Create a tooltip bubble
  const tooltip = document.createElement('div');
  tooltip.style.position = 'absolute';
  tooltip.style.bottom = '10px';
  tooltip.style.right = '70px'; // To the left of the button
  tooltip.style.backgroundColor = '#fff';
  tooltip.style.color = '#1B2A4A';
  tooltip.style.padding = '8px 14px';
  tooltip.style.borderRadius = '20px';
  tooltip.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
  tooltip.style.fontSize = '14px';
  tooltip.style.fontWeight = '500';
  tooltip.style.whiteSpace = 'nowrap';
  tooltip.style.cursor = 'pointer';
  tooltip.style.transition = 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out';
  tooltip.innerText = "Questions? I'm here to help! 👋";
  
  const tail = document.createElement('div');
  tail.style.position = 'absolute';
  tail.style.right = '-6px';
  tail.style.bottom = '14px';
  tail.style.width = '0';
  tail.style.height = '0';
  tail.style.borderTop = '6px solid transparent';
  tail.style.borderBottom = '6px solid transparent';
  tail.style.borderLeft = '6px solid #fff';
  tooltip.appendChild(tail);

  tooltip.onclick = () => {
    if (!isOpen) toggleChat();
  };

  // 3. Create the iframe
  const iframeContainer = document.createElement('div');
  iframeContainer.style.position = 'absolute';
  iframeContainer.style.bottom = '80px'; // Above the button
  iframeContainer.style.right = '0';
  iframeContainer.style.width = '360px';
  iframeContainer.style.height = '500px';
  iframeContainer.style.maxWidth = 'calc(100vw - 40px)';
  iframeContainer.style.maxHeight = 'calc(100vh - 100px)';
  iframeContainer.style.borderRadius = '16px';
  iframeContainer.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
  iframeContainer.style.overflow = 'hidden';
  iframeContainer.style.display = 'none'; // hidden by default
  iframeContainer.style.opacity = '0';
  iframeContainer.style.transition = 'opacity 0.2s ease-in-out';
  iframeContainer.style.backgroundColor = 'transparent';

  const iframe = document.createElement('iframe');
  iframe.src = BASE_URL + '/widget';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.backgroundColor = 'transparent';
  iframe.allowTransparency = 'true';

  iframeContainer.appendChild(iframe);
  
  container.appendChild(iframeContainer);
  container.appendChild(tooltip);
  container.appendChild(button);

  // 4. Toggle Logic
  let isOpen = false;
  
  const toggleChat = () => {
    isOpen = !isOpen;
    if (isOpen) {
      tooltip.style.display = 'none';
      iframeContainer.style.display = 'block';
      // Small timeout to allow display:block to apply before animating opacity
      setTimeout(() => {
        iframeContainer.style.opacity = '1';
      }, 10);
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
    } else {
      iframeContainer.style.opacity = '0';
      setTimeout(() => {
        iframeContainer.style.display = 'none';
      }, 200);
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"></path>
        </svg>
      `;
    }
  };

  button.onclick = toggleChat;

  // Listen for close events from inside the iframe
  window.addEventListener('message', (event) => {
    if (event.data === 'close_ccc_chat' && isOpen) {
      toggleChat();
    }
  });

})();
