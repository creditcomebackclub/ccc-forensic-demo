const PRODUCTION_ASSETS = Object.freeze({
  animated: 'https://creditcomebackclub.com/brand-assets/ccc-email-signature-animated.gif',
  static: 'https://creditcomebackclub.com/brand-assets/ccc-email-signature-static.png',
});

export const SIGNATURE_TEXT = [
  'Chris Holland',
  'Founder, Credit Comeback Club',
  'Credit repair, built like a case.',
  'Factual credit-report review · Evidence-backed disputes · Documented follow-through',
  '970-644-0063 · creditcomebackclub@gmail.com',
  'creditcomebackclub.com · Request your free 3B review',
  'Gilbert, Arizona · Veteran-Owned & Operated',
].join('\n');

export function createSignatureHtml(sourceHtml, mode) {
  const assetUrl = PRODUCTION_ASSETS[mode];
  if (!assetUrl) throw new Error(`Unsupported signature mode: ${mode}`);

  const source = String(sourceHtml || '');
  if (!source.includes('id="ccc-email-signature"')) {
    throw new Error('CCC signature markup is missing');
  }

  return source
    .replace(/\s+id="ccc-email-signature"/, '')
    .replace(
      /src="[^"]*ccc-email-signature-(?:animated\.gif|static\.png)"/,
      `src="${assetUrl}"`,
    );
}

function fallbackCopy(html, documentObject) {
  const holder = documentObject.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  holder.innerHTML = html;
  documentObject.body.append(holder);

  const range = documentObject.createRange();
  range.selectNodeContents(holder);
  const selection = documentObject.defaultView.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = documentObject.execCommand('copy');
  selection.removeAllRanges();
  holder.remove();
  if (!copied) throw new Error('Copy command was declined');
}

export async function copySignature(mode, options = {}) {
  const documentObject = options.documentObject
    || (typeof document !== 'undefined' ? document : null);
  const windowObject = options.windowObject
    || (typeof window !== 'undefined' ? window : null);
  const navigatorObject = options.navigatorObject
    || (typeof navigator !== 'undefined' ? navigator : null);
  const signature = options.signature
    || documentObject?.querySelector('#ccc-email-signature');

  if (!signature) throw new Error('CCC signature markup is unavailable');
  const html = createSignatureHtml(signature.outerHTML, mode);
  const clipboard = options.clipboard || navigatorObject?.clipboard;
  const ClipboardItemConstructor = options.ClipboardItemConstructor || windowObject?.ClipboardItem;
  const BlobConstructor = options.BlobConstructor
    || windowObject?.Blob
    || (typeof Blob !== 'undefined' ? Blob : null);
  const secureContext = options.secureContext ?? Boolean(windowObject?.isSecureContext);
  const fallback = options.fallback
    || ((copyHtml) => fallbackCopy(copyHtml, documentObject));

  if (clipboard && ClipboardItemConstructor && BlobConstructor && secureContext) {
    try {
      await clipboard.write([new ClipboardItemConstructor({
        'text/html': new BlobConstructor([html], { type: 'text/html' }),
        'text/plain': new BlobConstructor([SIGNATURE_TEXT], { type: 'text/plain' }),
      })]);
      return { html, text: SIGNATURE_TEXT };
    } catch (error) {
      fallback(html);
      return { html, text: SIGNATURE_TEXT };
    }
  }

  fallback(html);
  return { html, text: SIGNATURE_TEXT };
}

export function installSignatureInstaller(documentObject = document) {
  const toast = documentObject.querySelector('[data-toast]');
  let toastTimer;

  function showToast(message) {
    documentObject.defaultView.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = documentObject.defaultView.setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  documentObject.querySelectorAll('[data-copy-signature]').forEach((button) => {
    button.addEventListener('click', async () => {
      const mode = button.dataset.copySignature;
      try {
        await copySignature(mode, { documentObject });
        showToast(`${mode === 'static' ? 'Static' : 'Animated'} CCC signature copied — paste it into Gmail.`);
      } catch (error) {
        showToast('Your browser blocked clipboard access. Select the signature in the preview and copy it manually.');
      }
    });
  });
}

if (typeof document !== 'undefined') installSignatureInstaller(document);
