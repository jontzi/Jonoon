function getWaitMinutes(shop) {
  const estimates = Array.isArray(shop?.service_time_estimates)
    ? shop.service_time_estimates
        .map((estimate) => Number(estimate?.wait_time))
        .filter(Number.isFinite)
    : [];

  if (estimates.length > 0) return Math.max(0, Math.round(estimates[0]));

  const shortest = Number(shop?.shortest_queue?.wait_time);
  return Number.isFinite(shortest) ? Math.max(0, Math.round(shortest)) : null;
}

function getThresholdMinutes({ timingMode, arrivalAt, travelMinutes }, now = Date.now()) {
  if (timingMode === 'arrival') {
    const arrivalTime = Date.parse(arrivalAt);
    if (!Number.isFinite(arrivalTime)) return null;
    return Math.max(0, Math.ceil((arrivalTime - now) / 60_000));
  }

  const travelTime = Number(travelMinutes);
  return Number.isFinite(travelTime) ? travelTime : null;
}

function getDecision(settings, now = Date.now()) {
  const { open, queueState, waitMinutes } = settings;
  if (settings.selectedBarberUnavailable) return 'unavailable';
  if (!open || queueState !== 'open') return 'closed';
  if (!Number.isFinite(waitMinutes)) return 'unavailable';
  const threshold = getThresholdMinutes(settings, now);
  if (!Number.isFinite(threshold)) return 'unavailable';
  return waitMinutes > threshold ? 'ready' : 'waiting';
}

function getTransitionNotification(previousState, currentState) {
  if (currentState === 'ready' && previousState !== 'ready') return 'ready';
  if (currentState === 'waiting' && previousState === 'ready') return 'shorter';
  return null;
}

function isReminderDue(alert, now = Date.now(), limit = 3) {
  if (!alert || alert.acknowledgedAt || Number(alert.sentCount) >= limit) return false;
  const nextSendAt = Date.parse(alert.nextSendAt);
  return Number.isFinite(nextSendAt) && nextSendAt <= now;
}

module.exports = { getWaitMinutes, getThresholdMinutes, getDecision, getTransitionNotification, isReminderDue };
