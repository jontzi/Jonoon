function createDefaultArrivalAt(minutes = 22) {
  const date = new Date(Date.now() + minutes * 60_000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5);
  return date.toISOString();
}

function initialArrivalAt() {
  const stored = localStorage.getItem('jono.arrivalAt');
  return stored && Number.isFinite(Date.parse(stored)) ? stored : createDefaultArrivalAt();
}

const state = {
  shops: [],
  selectedShopId: Number(new URLSearchParams(location.search).get('shop')) || Number(localStorage.getItem('jono.shopId')) || 98,
  selectedEmployeeId: 0,
  travelMinutes: Number(localStorage.getItem('jono.travelMinutes')) || 22,
  timingMode: localStorage.getItem('jono.timingMode') === 'arrival' ? 'arrival' : 'travel',
  arrivalAt: initialArrivalAt(),
  deviceId: localStorage.getItem('jono.deviceId'),
  monitoring: false,
  loading: false,
  refreshQueued: false,
  refreshQueuedFresh: false,
  config: null
};

const elements = {
  shopSelect: document.querySelector('#shop-select'),
  shopAddress: document.querySelector('#shop-address'),
  barberPicker: document.querySelector('#barber-picker'),
  barberSelect: document.querySelector('#barber-select'),
  liveState: document.querySelector('#live-state'),
  decisionTitle: document.querySelector('#decision-title'),
  decisionDetail: document.querySelector('#decision-detail'),
  queueRing: document.querySelector('#queue-ring'),
  queueValue: document.querySelector('#queue-value'),
  queueUnit: document.querySelector('#queue-unit'),
  clientsValue: document.querySelector('#clients-value'),
  staffValue: document.querySelector('#staff-value'),
  travelValue: document.querySelector('#travel-value'),
  timingTabs: document.querySelectorAll('.timing-tab'),
  travelSetting: document.querySelector('#travel-setting'),
  arrivalSetting: document.querySelector('#arrival-setting'),
  arrivalTime: document.querySelector('#arrival-time'),
  arrivalHint: document.querySelector('#arrival-hint'),
  monitorButton: document.querySelector('#monitor-button'),
  monitorStatus: document.querySelector('#monitor-status'),
  monitorDescription: document.querySelector('#monitor-description'),
  browserNote: document.querySelector('#browser-note'),
  joinLink: document.querySelector('#join-link'),
  updatedValue: document.querySelector('#updated-value'),
  permissionGate: document.querySelector('#permission-gate'),
  permissionAllow: document.querySelector('#permission-allow'),
  permissionLater: document.querySelector('#permission-later'),
  toast: document.querySelector('#toast')
};

const selectedShop = () => state.shops.find((shop) => shop.id === state.selectedShopId);
const employeeStorageKey = () => `jono.employee.${state.selectedShopId}`;
let toastTimer;
let settingsTimer;
let lifecycleRefreshTimer;

state.selectedEmployeeId = Number(localStorage.getItem(employeeStorageKey())) || 0;

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Pyyntö epäonnistui.');
  }
  return response.status === 204 ? null : response.json();
}

function decisionFor(shop) {
  if (!shop) return 'loading';
  if (shop.selectedBarberUnavailable) return 'unavailable';
  if (!shop.open || shop.queueState !== 'open') return 'closed';
  if (!Number.isFinite(shop.waitMinutes)) return 'unavailable';
  return shop.waitMinutes > thresholdMinutes() ? 'ready' : 'waiting';
}

function selectedQueueView(shop) {
  if (!shop || !state.selectedEmployeeId) return shop;
  const queue = shop.barberQueues?.find((item) => item.employeeId === state.selectedEmployeeId);
  if (!queue) return { ...shop, waitMinutes: null, selectedBarberName: 'Valittu parturi', selectedBarberUnavailable: true };
  return {
    ...shop,
    waitMinutes: queue.waitMinutes,
    clientsInQueue: queue.queueLength,
    staffCount: 1,
    queueState: queue.queueOpen ? 'open' : 'closed',
    selectedBarberName: queue.name,
    selectedBarberUnavailable: !queue.queueOpen
  };
}

function thresholdMinutes() {
  if (state.timingMode === 'travel') return state.travelMinutes;
  return Math.max(0, Math.ceil((Date.parse(state.arrivalAt) - Date.now()) / 60_000));
}

function timeInputValue(isoValue) {
  const date = new Date(isoValue);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function arrivalAtFromTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function arrivalDayLabel() {
  const arrival = new Date(state.arrivalAt);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDate = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDate(arrival, today)) return 'Tänään';
  if (sameDate(arrival, tomorrow)) return 'Huomenna';
  return arrival.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });
}

function render() {
  const shop = selectedShop();
  const queueView = selectedQueueView(shop);
  const target = thresholdMinutes();
  const decision = decisionFor(queueView);

  elements.travelValue.textContent = `${state.travelMinutes} min`;
  elements.timingTabs.forEach((tab) => {
    const active = tab.dataset.timingMode === state.timingMode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  elements.travelSetting.hidden = state.timingMode !== 'travel';
  elements.arrivalSetting.hidden = state.timingMode !== 'arrival';
  if (document.activeElement !== elements.arrivalTime) elements.arrivalTime.value = timeInputValue(state.arrivalAt);
  elements.arrivalHint.textContent = `${arrivalDayLabel()} · ${target} min päästä`;
  localStorage.setItem('jono.travelMinutes', state.travelMinutes);
  localStorage.setItem('jono.timingMode', state.timingMode);
  localStorage.setItem('jono.arrivalAt', state.arrivalAt);

  if (!shop) return;
  elements.shopAddress.textContent = `${shop.address}, ${shop.city}`;
  elements.queueValue.textContent = Number.isFinite(queueView.waitMinutes) ? queueView.waitMinutes : '–';
  elements.queueUnit.textContent = Number.isFinite(queueView.waitMinutes) ? 'min jono' : 'ei arviota';
  elements.clientsValue.textContent = Number.isFinite(queueView.clientsInQueue) ? queueView.clientsInQueue : '–';
  elements.staffValue.textContent = Number.isFinite(queueView.staffCount) ? queueView.staffCount : '–';
  elements.queueRing.style.setProperty('--queue-angle', `${Math.min(330, Math.max(8, (queueView.waitMinutes || 0) / 60 * 330))}deg`);
  elements.joinLink.href = shop.joinUrl;
  elements.joinLink.classList.remove('disabled');

  const readyDetail = state.timingMode === 'arrival'
    ? `Saapumiseesi on ${target} min ja jono ${queueView.waitMinutes} min. Odotusta olisi noin ${Math.max(1, queueView.waitMinutes - target)} min.`
    : `Jono ylittää valitsemasi ${state.travelMinutes} minuutin matka-ajan.`;
  const waitingDetail = state.timingMode === 'arrival'
    ? `Saapumiseesi on ${target} min ja jono ${queueView.waitMinutes} min. Ilmoitamme rajan ylittyessä.`
    : `Jono on ${queueView.waitMinutes} min. Ilmoitamme, kun se ylittää ${target} minuuttia.`;
  const copy = {
    ready: ['Liity jonoon.', readyDetail],
    waiting: ['Odota vielä.', waitingDetail],
    closed: ['Liike on kiinni.', 'Voit silti käynnistää seurannan seuraavaa aukioloa varten.'],
    unavailable: state.selectedEmployeeId
      ? ['Ei jonoarviota.', 'Valittu parturi ei ole juuri nyt avoimessa jonossa.']
      : ['Ei jonoarviota.', 'M Room ei ilmoita tälle liikkeelle jonotusaikaa juuri nyt.']
  }[decision];
  [elements.decisionTitle.textContent, elements.decisionDetail.textContent] = copy;

  elements.liveState.className = `live-state ${decision === 'unavailable' ? 'error' : decision === 'closed' ? 'closed' : 'online'}`;
  elements.liveState.querySelector('span').textContent = decision === 'closed' ? 'Suljettu' : 'Live';
  elements.monitorButton.classList.toggle('active', state.monitoring);
  elements.monitorButton.setAttribute('aria-pressed', String(state.monitoring));
  elements.monitorStatus.textContent = state.monitoring ? 'Päällä' : 'Pois';
  const monitoredName = queueView.selectedBarberName ? `${shop.name} · ${queueView.selectedBarberName}` : shop.name;
  elements.monitorDescription.textContent = state.monitoring
    ? state.timingMode === 'arrival'
      ? `${monitoredName}: seurataan saapumista klo ${timeInputValue(state.arrivalAt)}.`
      : `${monitoredName}: seurataan ${target} min matka-aikaa.`
    : 'Ilmoitamme jonon ylittäessä tai alittaessa ajoitusrajan.';
}

function populateShops() {
  elements.shopSelect.innerHTML = '';
  for (const shop of state.shops) {
    const option = document.createElement('option');
    option.value = shop.id;
    option.textContent = `${shop.city} · ${shop.name}`;
    elements.shopSelect.append(option);
  }
  if (!state.shops.some((shop) => shop.id === state.selectedShopId)) state.selectedShopId = state.shops[0]?.id;
  elements.shopSelect.value = state.selectedShopId;
  elements.shopSelect.disabled = false;
  localStorage.setItem('jono.shopId', state.selectedShopId);
}

function populateBarbers(shop) {
  const queues = Array.isArray(shop?.barberQueues) ? shop.barberQueues : [];
  elements.barberSelect.innerHTML = '<option value="0">Kuka tahansa · lyhin jono</option>';
  for (const queue of queues) {
    const option = document.createElement('option');
    option.value = queue.employeeId;
    option.textContent = `${queue.name} · ${queue.queueOpen && Number.isFinite(queue.waitMinutes) ? `${queue.waitMinutes} min` : 'ei jonossa'}`;
    elements.barberSelect.append(option);
  }
  if (!queues.some((queue) => queue.employeeId === state.selectedEmployeeId)) state.selectedEmployeeId = 0;
  elements.barberSelect.value = state.selectedEmployeeId;
  elements.barberPicker.hidden = queues.length === 0;
  localStorage.setItem(employeeStorageKey(), state.selectedEmployeeId);
}

async function loadShopDetail({ fresh = false } = {}) {
  const detail = await api(`/api/shops/${state.selectedShopId}${fresh ? '?fresh=1' : ''}`);
  const index = state.shops.findIndex((shop) => shop.id === detail.id);
  if (index >= 0) state.shops[index] = detail;
  populateBarbers(detail);
}

async function loadShops({ quiet = false, fresh = false } = {}) {
  if (state.loading) {
    state.refreshQueued = true;
    state.refreshQueuedFresh ||= fresh;
    return;
  }
  state.loading = true;
  if (!quiet) elements.liveState.querySelector('span').textContent = 'Päivitetään';

  try {
    const payload = await api(`/api/shops${fresh ? '?fresh=1' : ''}`);
    state.shops = payload.shops;
    populateShops();
    await loadShopDetail({ fresh });
    render();
    const updated = new Date(payload.fetchedAt);
    elements.updatedValue.textContent = `Päivittyy automaattisesti minuutin välein · Päivitetty ${updated.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    elements.liveState.className = 'live-state error';
    elements.liveState.querySelector('span').textContent = 'Ei yhteyttä';
    elements.decisionTitle.textContent = 'Ei yhteyttä.';
    elements.decisionDetail.textContent = error.message;
    if (!quiet) showToast(error.message);
  } finally {
    state.loading = false;
    if (state.refreshQueued) {
      const queuedFresh = state.refreshQueuedFresh;
      state.refreshQueued = false;
      state.refreshQueuedFresh = false;
      queueMicrotask(() => loadShops({ quiet: true, fresh: queuedFresh }));
    }
  }
}

function refreshLiveData() {
  if (!navigator.onLine || document.visibilityState === 'hidden') return;
  clearTimeout(lifecycleRefreshTimer);
  lifecycleRefreshTimer = setTimeout(() => loadShops({ quiet: true, fresh: true }), 100);
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function closePermissionGate() {
  elements.permissionGate.hidden = true;
  document.body.classList.remove('permission-open');
}

function showPermissionGateOnFirstOpen() {
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'default' || localStorage.getItem('jono.notificationPromptSeen') === '1') return;
  elements.permissionGate.hidden = false;
  document.body.classList.add('permission-open');
  requestAnimationFrame(() => elements.permissionAllow.focus());
}

function updateNotificationNote() {
  if (!('Notification' in window) || Notification.permission !== 'denied') return;
  elements.browserNote.hidden = false;
  elements.browserNote.textContent = 'Ilmoitukset on estetty selaimessa. Salli ne tämän sivun asetuksista ja yritä uudelleen.';
}

async function getPushSubscription() {
  if (!window.isSecureContext) throw new Error('Ilmoitukset vaativat HTTPS-yhteyden.');
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Selain ei tue web-push-ilmoituksia.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Ilmoituslupa tarvitaan seurantaa varten.');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing || registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(state.config.vapidPublicKey)
  });
}

async function ensureDevice() {
  const subscription = await getPushSubscription();
  const payload = await api('/api/devices', { method: 'POST', body: JSON.stringify({ subscription }) });
  state.deviceId = payload.id;
  localStorage.setItem('jono.deviceId', state.deviceId);
}

async function saveMonitorSettings() {
  if (!state.deviceId) return;
  await api(`/api/devices/${state.deviceId}/settings`, {
    method: 'PUT',
    body: JSON.stringify({
      shopId: state.selectedShopId,
      employeeId: state.selectedEmployeeId || null,
      travelMinutes: state.travelMinutes,
      timingMode: state.timingMode,
      arrivalAt: state.arrivalAt,
      enabled: state.monitoring
    })
  });
}

function scheduleSettingsSave() {
  if (!state.monitoring || !state.deviceId) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => saveMonitorSettings().catch((error) => showToast(error.message)), 450);
}

async function toggleMonitoring() {
  elements.monitorButton.disabled = true;
  try {
    if (!state.monitoring) {
      await ensureDevice();
      state.monitoring = true;
      await saveMonitorSettings();
      showToast('Seuranta on päällä');
    } else {
      state.monitoring = false;
      await saveMonitorSettings();
      showToast('Seuranta pysäytettiin');
    }
    render();
  } catch (error) {
    state.monitoring = false;
    render();
    showToast(error.message);
  } finally {
    elements.monitorButton.disabled = false;
  }
}

async function restoreDevice() {
  if (!state.deviceId) return;
  try {
    const payload = await api(`/api/devices/${state.deviceId}`);
    state.monitoring = Boolean(payload.settings?.enabled);
    if (payload.settings?.shopId) {
      state.selectedShopId = payload.settings.shopId;
      state.selectedEmployeeId = Number(payload.settings.employeeId) || 0;
      state.travelMinutes = payload.settings.travelMinutes;
      state.timingMode = payload.settings.timingMode === 'arrival' ? 'arrival' : 'travel';
      if (payload.settings.arrivalAt && Number.isFinite(Date.parse(payload.settings.arrivalAt))) {
        state.arrivalAt = payload.settings.arrivalAt;
      }
    }
  } catch (error) {
    localStorage.removeItem('jono.deviceId');
    state.deviceId = null;
  }
}

document.querySelectorAll('.stepper button').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.dataset.field;
    const limits = [1, 90];
    state[field] = Math.min(limits[1], Math.max(limits[0], state[field] + Number(button.dataset.delta)));
    render();
    scheduleSettingsSave();
  });
});

elements.timingTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.timingMode = tab.dataset.timingMode;
    render();
    scheduleSettingsSave();
  });
});

elements.arrivalTime.addEventListener('change', () => {
  if (!elements.arrivalTime.value) return;
  state.arrivalAt = arrivalAtFromTime(elements.arrivalTime.value);
  render();
  scheduleSettingsSave();
});

elements.shopSelect.addEventListener('change', async () => {
  state.selectedShopId = Number(elements.shopSelect.value);
  state.selectedEmployeeId = Number(localStorage.getItem(employeeStorageKey())) || 0;
  localStorage.setItem('jono.shopId', state.selectedShopId);
  elements.shopSelect.disabled = true;
  try {
    await loadShopDetail();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.shopSelect.disabled = false;
  }
  render();
  scheduleSettingsSave();
});
elements.barberSelect.addEventListener('change', () => {
  state.selectedEmployeeId = Number(elements.barberSelect.value) || 0;
  localStorage.setItem(employeeStorageKey(), state.selectedEmployeeId);
  render();
  scheduleSettingsSave();
});
elements.monitorButton.addEventListener('click', toggleMonitoring);
elements.permissionAllow.addEventListener('click', () => {
  elements.permissionAllow.disabled = true;
  Notification.requestPermission().then((permission) => {
    localStorage.setItem('jono.notificationPromptSeen', '1');
    closePermissionGate();
    if (permission === 'granted') showToast('Ilmoitukset sallittu');
    else updateNotificationNote();
  }).catch(() => {
    closePermissionGate();
    showToast('Ilmoituslupaa ei voitu pyytää.');
  }).finally(() => {
    elements.permissionAllow.disabled = false;
  });
});
elements.permissionLater.addEventListener('click', () => {
  localStorage.setItem('jono.notificationPromptSeen', '1');
  closePermissionGate();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshLiveData();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refreshLiveData();
});
window.addEventListener('online', refreshLiveData);

async function initialize() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  showPermissionGateOnFirstOpen();
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    elements.browserNote.hidden = false;
    elements.browserNote.textContent = 'Puhelimen ilmoitukset tarvitsevat HTTPS-osoitteen. Lisää TLS Traefik-ingressiin ennen käyttöönottoa.';
  }
  updateNotificationNote();
  try {
    state.config = await api('/api/config');
    await restoreDevice();
  } catch (error) {
    showToast('Palvelimen asetuksia ei saatu.');
  }
  await loadShops();
  render();
  setInterval(() => loadShops({ quiet: true }), 60_000);
}

initialize();
