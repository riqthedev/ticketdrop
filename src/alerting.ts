/**
 * Alerting utilities for monitoring system health
 * In production, these would integrate with services like PagerDuty, Slack, etc.
 */

interface OversellSpikeAlert {
  eventId: string;
  tierId: string;
  count: number;
  windowSeconds: number;
  threshold: number;
}

// Track oversell attempts in a sliding window (in-memory for demo)
// In production, use Redis or a time-series database
const oversellAttempts: Map<string, number[]> = new Map();

/**
 * Track an oversell attempt and potentially alert if threshold is exceeded
 */
export async function maybeAlertOversellSpike(
  eventId: string,
  tierId: string,
  threshold: number = 10,
  windowSeconds: number = 60
): Promise<void> {
  const key = `${eventId}:${tierId}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Get existing attempts for this event/tier
  let attempts = oversellAttempts.get(key) || [];
  
  // Filter out attempts outside the window
  attempts = attempts.filter(timestamp => now - timestamp < windowMs);
  
  // Add current attempt
  attempts.push(now);
  oversellAttempts.set(key, attempts);

  // Check if threshold exceeded
  if (attempts.length >= threshold) {
    const alert: OversellSpikeAlert = {
      eventId,
      tierId,
      count: attempts.length,
      windowSeconds,
      threshold,
    };

    // Log structured alert (in production, send to alerting service)
    console.log(
      JSON.stringify({
        level: 'error',
        msg: 'alert.oversell_spike_detected',
        alert_type: 'oversell_spike',
        event_id: eventId,
        tier_id: tierId,
        count: attempts.length,
        threshold,
        window_seconds: windowSeconds,
        severity: 'high',
        recommendation: 'Review inventory allocation and capacity settings',
      })
    );

    // In production, you would:
    // - Send to PagerDuty / OpsGenie
    // - Post to Slack / Teams
    // - Create a ticket in Jira / ServiceNow
    // - Trigger an automated scaling action
  }
}

/**
 * Clear old oversell attempt tracking data (call periodically)
 */
export function cleanupOversellTracking(maxAgeSeconds: number = 300): void {
  const now = Date.now();
  const maxAgeMs = maxAgeSeconds * 1000;

  for (const [key, attempts] of oversellAttempts.entries()) {
    const filtered = attempts.filter(timestamp => now - timestamp < maxAgeMs);
    if (filtered.length === 0) {
      oversellAttempts.delete(key);
    } else {
      oversellAttempts.set(key, filtered);
    }
  }
}

