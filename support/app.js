(() => {
  'use strict';

  const API_URL = 'https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/support-api';
  const form = document.getElementById('support-form');
  const notice = document.getElementById('notice');
  const amountButtons = [...document.querySelectorAll('[data-amount]')];
  const customWrap = document.getElementById('custom-amount-wrap');
  const customInput = document.getElementById('custom-amount');
  const supporterName = document.getElementById('supporter-name');
  const anonymous = document.getElementById('anonymous');
  const message = document.getElementById('support-message');
  const allowTts = document.getElementById('allow-tts');
  const checkoutButton = document.getElementById('checkout-button');
  let selectedAmount = 20;
  let usingCustomAmount = false;

  function formatAmount(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
  }

  function getAmount() {
    return usingCustomAmount ? Number(customInput.value) : selectedAmount;
  }

  function showNotice(text, isError = false) {
    notice.textContent = text;
    notice.classList.toggle('is-error', isError);
    notice.hidden = !text;
    if (text) notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updatePreview() {
    const amount = getAmount();
    const displayName = anonymous.checked ? 'Anonymous' : supporterName.value.trim() || 'Supporter';
    document.getElementById('checkout-total').textContent = `${formatAmount(amount)} USD`;
    document.getElementById('preview-amount').textContent = formatAmount(amount);
    document.getElementById('preview-name').textContent = displayName;
    document.getElementById('preview-message').textContent = message.value.trim() || 'Your optional message will appear here.';
    document.getElementById('message-count').textContent = String(message.value.length);
    supporterName.disabled = anonymous.checked;
  }

  amountButtons.forEach((button) => {
    button.addEventListener('click', () => {
      usingCustomAmount = button.dataset.amount === 'other';
      if (!usingCustomAmount) selectedAmount = Number(button.dataset.amount);
      customWrap.hidden = !usingCustomAmount;
      amountButtons.forEach((item) => item.classList.toggle('is-active', item === button));
      if (usingCustomAmount) customInput.focus();
      updatePreview();
    });
  });

  [customInput, supporterName, anonymous, message].forEach((field) => field.addEventListener('input', updatePreview));
  anonymous.addEventListener('change', updatePreview);

  function getDraft() {
    return {
      amount: getAmount(),
      supporterName: supporterName.value.trim(),
      anonymous: anonymous.checked,
      message: message.value.trim(),
      allowTts: allowTts.checked,
    };
  }

  function resetCompletedCheckout() {
    form.reset();
    selectedAmount = 20;
    usingCustomAmount = false;
    customInput.value = '';
    customWrap.hidden = true;
    amountButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.amount === '20'));
    supporterName.disabled = false;
    checkoutButton.disabled = false;
    checkoutButton.type = 'submit';
    checkoutButton.onclick = null;
    checkoutButton.querySelector('span').textContent = 'Continue securely with PayPal';
    updatePreview();
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Support request failed (${response.status}).`);
      return body;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const draft = getDraft();
    if (!Number.isFinite(draft.amount) || draft.amount < 1 || draft.amount > 1000) {
      showNotice('Choose an amount between $1.00 and $1,000.00.', true);
      return;
    }

    checkoutButton.disabled = true;
    checkoutButton.querySelector('span').textContent = 'Opening secure checkout…';
    showNotice('');

    try {
      sessionStorage.setItem('ttg-support-draft', JSON.stringify(draft));
      const result = await api('/orders', { method: 'POST', body: JSON.stringify(draft) });
      sessionStorage.setItem('ttg-support-donation-id', result.donationId);
      window.location.assign(result.approvalUrl);
    } catch (error) {
      showNotice(error.name === 'AbortError' ? 'The payment station timed out. Please try again.' : error.message, true);
      checkoutButton.disabled = false;
      checkoutButton.querySelector('span').textContent = 'Continue securely with PayPal';
    }
  });

  async function finishApprovedPayment(params) {
    const orderId = params.get('token');
    const donationId = params.get('donation') || sessionStorage.getItem('ttg-support-donation-id');
    if (!orderId || !donationId) return;

    checkoutButton.disabled = true;
    checkoutButton.querySelector('span').textContent = 'Confirming PayPal payment…';
    showNotice('PayPal approved the checkout. Confirming the payment and preparing your receipt…');

    try {
      const result = await api(`/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: JSON.stringify({ donationId }) });
      showNotice(`Thank you! ${result.receiptCode} confirmed for ${formatAmount(result.amount)}. Your verified alert is queued.`);
      sessionStorage.removeItem('ttg-support-draft');
      sessionStorage.removeItem('ttg-support-donation-id');
      history.replaceState({}, '', './');
      resetCompletedCheckout();
    } catch (error) {
      showNotice(`${error.message} Your PayPal payment will not be duplicated.`, true);
      checkoutButton.disabled = false;
      checkoutButton.type = 'button';
      checkoutButton.querySelector('span').textContent = 'Try confirmation again';
      checkoutButton.onclick = () => finishApprovedPayment(params);
    }
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('paypal') === 'approved') finishApprovedPayment(params);
  if (params.get('paypal') === 'cancelled') {
    showNotice('Checkout was cancelled. No payment was completed.', true);
    history.replaceState({}, '', './');
  }

  updatePreview();
  if (window.lucide) window.lucide.createIcons({ attrs: { width: 18, height: 18, 'stroke-width': 1.8 } });
})();
