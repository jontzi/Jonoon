const test = require('node:test');
const assert = require('node:assert/strict');
const { getWaitMinutes, getThresholdMinutes, getDecision, getTransitionNotification, isReminderDue } = require('../lib/decision');

test('reads the public M Room wait estimate', () => {
  assert.equal(getWaitMinutes({ service_time_estimates: [{ wait_time: 24 }] }), 24);
});

test('falls back to the shortest barber queue', () => {
  assert.equal(getWaitMinutes({ shortest_queue: { wait_time: 17 } }), 17);
});

test('recommends joining when queue exceeds the travel time', () => {
  assert.equal(getDecision({ open: true, queueState: 'open', waitMinutes: 23, travelMinutes: 22 }), 'ready');
});

test('waits when the queue only equals the travel time', () => {
  assert.equal(getDecision({ open: true, queueState: 'open', waitMinutes: 22, travelMinutes: 22 }), 'waiting');
});

test('reports a closed shop before considering the queue', () => {
  assert.equal(getDecision({ open: false, queueState: 'closed', waitMinutes: 60, travelMinutes: 10 }), 'closed');
});

test('reports a selected barber outside the queue as unavailable', () => {
  assert.equal(getDecision({ open: true, queueState: 'open', waitMinutes: 20, selectedBarberUnavailable: true, travelMinutes: 10 }), 'unavailable');
});

test('calculates the changing threshold from an arrival time', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z');
  assert.equal(getThresholdMinutes({ timingMode: 'arrival', arrivalAt: '2026-08-26T12:25:00.000Z' }, now), 25);
});

test('arrival mode becomes ready only when queue exceeds time until arrival', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z');
  const settings = { open: true, queueState: 'open', timingMode: 'arrival', arrivalAt: '2026-08-26T12:25:00.000Z' };
  assert.equal(getDecision({ ...settings, waitMinutes: 25 }, now), 'waiting');
  assert.equal(getDecision({ ...settings, waitMinutes: 26 }, now), 'ready');
});

test('notifies on both upward and downward threshold crossings', () => {
  assert.equal(getTransitionNotification('waiting', 'ready'), 'ready');
  assert.equal(getTransitionNotification('ready', 'waiting'), 'shorter');
  assert.equal(getTransitionNotification('waiting', 'waiting'), null);
  assert.equal(getTransitionNotification(null, 'waiting'), null);
});

test('repeats an unacknowledged alert only when its next minute is due', () => {
  const now = Date.parse('2026-08-27T10:00:00Z');
  const alert = { sentCount: 1, nextSendAt: '2026-08-27T10:00:00Z', acknowledgedAt: null };
  assert.equal(isReminderDue(alert, now, 3), true);
  assert.equal(isReminderDue({ ...alert, nextSendAt: '2026-08-27T10:01:00Z' }, now, 3), false);
  assert.equal(isReminderDue({ ...alert, sentCount: 3 }, now, 3), false);
  assert.equal(isReminderDue({ ...alert, acknowledgedAt: '2026-08-27T09:59:30Z' }, now, 3), false);
});
