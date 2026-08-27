const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const webpush = require('web-push');
const { JsonStore } = require('./lib/store');
const { getWaitMinutes, getThresholdMinutes, getDecision, getTransitionNotification, isReminderDue } = require('./lib/decision');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MROOM_API_BASE = process.env.MROOM_API_BASE || 'https://mcloud-backend-suomi.mroompos.com';
const POLL_INTERVAL_MS = Math.max(30_000, Number(process.env.POLL_INTERVAL_MS || 60_000));
const REMINDER_INTERVAL_MS = Math.max(60_000, Number(process.env.REMINDER_INTERVAL_MS || 60_000));
const REMINDER_LIMIT = Math.min(5, Math.max(1, Number(process.env.REMINDER_LIMIT || 3)));
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const app = express();
const store = new JsonStore(path.join(DATA_DIR, 'state.json'));
let vapidKeys;
let shopsCache = { fetchedAt: 0, shops: [] };
const shopDetailCache = new Map();
let pollRunning = false;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(response, filePath) {
    if (/\.(?:html|js|css|webmanifest)$/.test(filePath)) {
      response.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

function publicShop(raw) {
  return {
    id: raw.id,
    name: raw.name,
    city: raw.city,
    address: raw.address,
    open: Boolean(raw.open),
    closingSoon: Boolean(raw.closing_soon),
    queueState: raw.queue_state,
    waitMinutes: getWaitMinutes(raw),
    shortestWaitMinutes: Number.isFinite(Number(raw.shortest_queue?.wait_time))
      ? Math.round(Number(raw.shortest_queue.wait_time))
      : null,
    clientsInQueue: Number(raw.queue_info?.clients_in_queue || 0),
    staffCount: Number(raw.queue_info?.queue_employees || 0),
    updatedAt: raw.service_time_estimates?.[0]?.created || new Date().toISOString(),
    joinUrl: `https://my.mroom.com/barbershop/${raw.id}`,
    barberQueues: Array.isArray(raw.queues) ? raw.queues.map((queue) => ({
      employeeId: Number(queue.barber?.id),
      name: queue.barber?.full_name || queue.barber?.name || 'Parturi',
      waitMinutes: Number.isFinite(Number(queue.wait_time)) ? Math.max(0, Math.round(Number(queue.wait_time))) : null,
      queueLength: Number(queue.queue_length || 0),
      queueOpen: Boolean(queue.queue_open),
      shiftStart: queue.shift_start || null,
      shiftEnd: queue.shift_end || null
    })).filter((queue) => Number.isInteger(queue.employeeId)) : []
  };
}

async function fetchShops({ fresh = false } = {}) {
  if (!fresh && Date.now() - shopsCache.fetchedAt < 25_000 && shopsCache.shops.length) {
    return shopsCache.shops;
  }

  const response = await fetch(`${MROOM_API_BASE}/pobs/`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Jono/0.1 (personal homelab queue monitor)' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`M Room vastasi HTTP ${response.status}`);
  const body = await response.json();
  shopsCache = {
    fetchedAt: Date.now(),
    shops: body.map(publicShop).sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`, 'fi'))
  };
  return shopsCache.shops;
}

async function fetchShopDetail(shopId, { fresh = false } = {}) {
  const cached = shopDetailCache.get(shopId);
  if (!fresh && cached && Date.now() - cached.fetchedAt < 25_000) return cached.shop;
  const response = await fetch(`${MROOM_API_BASE}/pobs/${shopId}/`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Jono/0.1 (personal homelab queue monitor)' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`M Room vastasi HTTP ${response.status}`);
  const shop = publicShop(await response.json());
  shopDetailCache.set(shopId, { fetchedAt: Date.now(), shop });
  return shop;
}

function employeeQueueView(shop, employeeId) {
  if (!employeeId) return shop;
  const queue = shop?.barberQueues?.find((item) => item.employeeId === Number(employeeId));
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

async function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }

  const keyPath = path.join(DATA_DIR, 'vapid.json');
  try {
    return JSON.parse(await fs.readFile(keyPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const generated = webpush.generateVAPIDKeys();
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(keyPath, JSON.stringify(generated, null, 2), { encoding: 'utf8', mode: 0o600 });
    return generated;
  }
}

function findDevice(id) {
  return store.data.devices.find((device) => device.id === id);
}

function normalizeSettings(body) {
  const shopId = Number(body.shopId);
  const travelMinutes = Math.min(90, Math.max(1, Number(body.travelMinutes)));
  const timingMode = body.timingMode === 'arrival' ? 'arrival' : 'travel';
  const parsedArrival = Date.parse(body.arrivalAt);
  if (!Number.isInteger(shopId) || !Number.isFinite(travelMinutes) || (timingMode === 'arrival' && !Number.isFinite(parsedArrival))) {
    return null;
  }
  return {
    shopId,
    employeeId: Number.isInteger(Number(body.employeeId)) && Number(body.employeeId) > 0 ? Number(body.employeeId) : null,
    travelMinutes,
    timingMode,
    arrivalAt: timingMode === 'arrival' ? new Date(parsedArrival).toISOString() : null,
    enabled: Boolean(body.enabled)
  };
}

async function sendNotification(device, shop, type, { alertId = null, reminderNumber = 1 } = {}) {
  const threshold = getThresholdMinutes(device.settings);
  const arrivalMode = device.settings.timingMode === 'arrival';
  const waitAtShop = Math.max(0, shop.waitMinutes - threshold);
  const targetName = shop.selectedBarberName ? `${shop.name} · ${shop.selectedBarberName}` : shop.name;
  const title = type === 'shorter'
    ? `Jono lyheni · ${targetName}`
    : reminderNumber > 1
      ? `MUISTUTUS ${reminderNumber}/${REMINDER_LIMIT} · ${targetName}`
      : `LÄHDE NYT · ${targetName}`;
  const body = type === 'shorter'
    ? arrivalMode
      ? `Jono putosi ${shop.waitMinutes} minuuttiin. Saapumiseesi on ${threshold} min, joten jono on taas ajoitusrajasi alla.`
      : `Jono putosi ${shop.waitMinutes} minuuttiin, alle ${threshold} minuutin matka-aikasi.`
    : arrivalMode
      ? `Jono ${shop.waitMinutes} min ja saapumiseesi ${threshold} min. Odotusta olisi noin ${waitAtShop} min.`
      : `Jono ${shop.waitMinutes} min ylitti ${threshold} minuutin matka-aikasi.`;
  const payload = JSON.stringify({
    title,
    body,
    tag: `jono-${shop.id}-status`,
    url: `/?shop=${shop.id}`,
    shopUrl: shop.joinUrl,
    ackUrl: alertId ? `/api/devices/${device.id}/alerts/${alertId}/ack` : null,
    renotify: type === 'ready',
    timestamp: Date.now()
  });
  await webpush.sendNotification(device.subscription, payload, { TTL: 300, urgency: 'high' });
}

async function pollMonitors() {
  if (pollRunning) return;
  const active = store.data.devices.filter((device) => device.settings?.enabled && device.subscription);
  if (!active.length) return;
  pollRunning = true;

  try {
    const shops = await fetchShops({ fresh: true });
    const details = new Map();
    let changed = false;

    for (const device of active) {
      let shop = shops.find((candidate) => candidate.id === device.settings.shopId);
      if (shop && device.settings.employeeId) {
        if (!details.has(shop.id)) details.set(shop.id, await fetchShopDetail(shop.id, { fresh: true }));
        shop = employeeQueueView(details.get(shop.id), device.settings.employeeId);
      }
      const state = shop
        ? getDecision({ ...shop, ...device.settings })
        : 'unavailable';

      const now = Date.now();
      const notificationType = getTransitionNotification(device.lastState, state);

      if (notificationType === 'ready') {
        device.activeAlert = {
          id: crypto.randomUUID(),
          sentCount: 0,
          createdAt: new Date(now).toISOString(),
          nextSendAt: new Date(now).toISOString(),
          acknowledgedAt: null
        };
      } else if (state !== 'ready') {
        device.activeAlert = null;
      }

      if (notificationType === 'shorter') {
        try {
          await sendNotification(device, shop, 'shorter');
          device.lastNotificationAt = new Date().toISOString();
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            device.subscription = null;
            device.settings.enabled = false;
          } else {
            console.error('Push-ilmoitus epäonnistui:', error.message);
          }
        }
      }

      const alert = device.activeAlert;
      const reminderDue = state === 'ready'
        && isReminderDue(alert, now, REMINDER_LIMIT);

      if (reminderDue) {
        try {
          const reminderNumber = alert.sentCount + 1;
          await sendNotification(device, shop, 'ready', { alertId: alert.id, reminderNumber });
          alert.sentCount = reminderNumber;
          alert.lastSentAt = new Date(now).toISOString();
          alert.nextSendAt = reminderNumber < REMINDER_LIMIT
            ? new Date(now + REMINDER_INTERVAL_MS).toISOString()
            : null;
          device.lastNotificationAt = alert.lastSentAt;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            device.subscription = null;
            device.settings.enabled = false;
            device.activeAlert = null;
          } else {
            console.error('Push-muistutus epäonnistui:', error.message);
          }
        }
      }

      if (device.lastState !== state) changed = true;
      device.lastState = state;
      device.lastWaitMinutes = shop?.waitMinutes ?? null;
      device.lastCheckedAt = new Date().toISOString();
    }

    if (changed || active.length) await store.save();
  } catch (error) {
    console.error('Jonojen päivitys epäonnistui:', error.message);
  } finally {
    pollRunning = false;
  }
}

app.get('/api/health', (request, response) => {
  response.json({ ok: true, activeMonitors: store.data.devices.filter((device) => device.settings?.enabled).length });
});

app.get('/api/config', (request, response) => {
  response.json({ vapidPublicKey: vapidKeys.publicKey, pollIntervalSeconds: POLL_INTERVAL_MS / 1000 });
});

app.get('/api/shops', async (request, response) => {
  try {
    const fresh = request.query.fresh === '1';
    response.json({ shops: await fetchShops({ fresh }), fetchedAt: new Date(shopsCache.fetchedAt).toISOString() });
  } catch (error) {
    response.status(502).json({ error: 'M Roomin jonotietoja ei saatu juuri nyt.' });
  }
});

app.get('/api/shops/:id', async (request, response) => {
  const shopId = Number(request.params.id);
  if (!Number.isInteger(shopId)) return response.status(400).json({ error: 'Virheellinen liike.' });
  try {
    response.json(await fetchShopDetail(shopId, { fresh: request.query.fresh === '1' }));
  } catch (error) {
    response.status(502).json({ error: 'Liikkeen työntekijäjonoja ei saatu juuri nyt.' });
  }
});

app.post('/api/devices', async (request, response) => {
  const subscription = request.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return response.status(400).json({ error: 'Virheellinen push-tilaus.' });
  }

  let device = store.data.devices.find((item) => item.subscription?.endpoint === subscription.endpoint);
  if (!device) {
    device = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), settings: { enabled: false } };
    store.data.devices.push(device);
  }
  device.subscription = subscription;
  device.updatedAt = new Date().toISOString();
  await store.save();
  response.json({ id: device.id, settings: device.settings });
});

app.get('/api/devices/:id', (request, response) => {
  const device = findDevice(request.params.id);
  if (!device) return response.status(404).json({ error: 'Laitetta ei löytynyt.' });
  response.json({ id: device.id, settings: device.settings, lastState: device.lastState, lastCheckedAt: device.lastCheckedAt });
});

app.put('/api/devices/:id/settings', async (request, response) => {
  const device = findDevice(request.params.id);
  if (!device) return response.status(404).json({ error: 'Laitetta ei löytynyt.' });
  const settings = normalizeSettings(request.body);
  if (!settings) return response.status(400).json({ error: 'Tarkista seuranta-asetukset.' });

  device.settings = settings;
  device.lastState = null;
  device.activeAlert = null;
  device.updatedAt = new Date().toISOString();
  await store.save();
  response.json({ ok: true, settings });
  if (settings.enabled) setImmediate(pollMonitors);
});

app.post('/api/devices/:id/alerts/:alertId/ack', async (request, response) => {
  const device = findDevice(request.params.id);
  if (!device) return response.status(404).json({ error: 'Laitetta ei löytynyt.' });
  if (!device.activeAlert || device.activeAlert.id !== request.params.alertId) {
    return response.status(204).end();
  }
  device.activeAlert.acknowledgedAt = new Date().toISOString();
  await store.save();
  response.status(204).end();
});

app.delete('/api/devices/:id', async (request, response) => {
  const index = store.data.devices.findIndex((device) => device.id === request.params.id);
  if (index >= 0) {
    store.data.devices.splice(index, 1);
    await store.save();
  }
  response.status(204).end();
});

app.get('*path', (request, response) => response.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  await store.load();
  vapidKeys = await loadVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);
  app.listen(PORT, '0.0.0.0', () => console.log(`JONO kuuntelee portissa ${PORT}`));
  setInterval(pollMonitors, POLL_INTERVAL_MS).unref();
  setImmediate(pollMonitors);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { app, fetchShops, fetchShopDetail, publicShop, employeeQueueView };
