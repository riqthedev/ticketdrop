import { useState, useEffect } from 'react';
import UserView from './UserView';

const API_BASE = 'http://localhost:4000';

interface HealthResponse {
  status: string;
  timestamp?: string;
}

interface Event {
  id: string;
  name: string;
  venue: string;
  description?: string;
  starts_at: string;
  on_sale_at: string;
  status?: string;
  paused?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface Tier {
  id: string;
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  per_user_limit?: number;
}

interface WaitingRoomStatus {
  state: 'waiting' | 'sale_open';
  onSaleAt: string;
  secondsUntilOnSale: number;
}

function App() {
  const [viewMode, setViewMode] = useState<'user' | 'admin'>('user');
  
  // Admin view state
  const [healthStatus, setHealthStatus] = useState<'online' | 'offline' | 'loading'>('loading');
  const [events, setEvents] = useState<Event[]>([]);
  const [tiersByEventId, setTiersByEventId] = useState<Record<string, Tier[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Waiting room state
  const [publicEvents, setPublicEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [waitingRoomToken, setWaitingRoomToken] = useState<string>('');
  const [waitingRoomStatus, setWaitingRoomStatus] = useState<WaitingRoomStatus | null>(null);
  const [waitingRoomError, setWaitingRoomError] = useState<string | null>(null);
  const [statusInterval, setStatusInterval] = useState<NodeJS.Timeout | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    venue: '',
    description: '',
    startsAt: '',
    onSaleAt: '',
    tierName: '',
    priceCents: '',
    capacity: '',
  });

  // Fetch health status
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
          const data: HealthResponse = await response.json();
          if (data.status === 'ok') {
            setHealthStatus('online');
          } else {
            setHealthStatus('offline');
          }
        } else {
          setHealthStatus('offline');
        }
      } catch (err) {
        setHealthStatus('offline');
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch events and tiers
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch events
        const eventsResponse = await fetch(`${API_BASE}/admin/events`);
        if (!eventsResponse.ok) {
          throw new Error('Failed to fetch events');
        }
        const eventsData: Event[] = await eventsResponse.json();
        setEvents(eventsData);

        // Fetch tiers for each event
        const tiersMap: Record<string, Tier[]> = {};
        for (const event of eventsData) {
          try {
            const tiersResponse = await fetch(`${API_BASE}/admin/tiers?event_id=${event.id}`);
            if (tiersResponse.ok) {
              const tiersData: Tier[] = await tiersResponse.json();
              tiersMap[event.id] = tiersData;
            }
          } catch (err) {
            // Ignore tier fetch errors for individual events
            tiersMap[event.id] = [];
          }
        }
        setTiersByEventId(tiersMap);
      } catch (err) {
        setError('Failed to load events');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Fetch public events for waiting room testing
  useEffect(() => {
    const fetchPublicEvents = async () => {
      try {
        const response = await fetch(`${API_BASE}/events`);
        if (response.ok) {
          const data: Event[] = await response.json();
          setPublicEvents(data);
        }
      } catch (err) {
        console.error('Failed to fetch public events:', err);
      }
    };

    fetchPublicEvents();
    const interval = setInterval(fetchPublicEvents, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Poll waiting room status if we have a token
  useEffect(() => {
    if (waitingRoomToken && selectedEventId) {
      const pollStatus = async () => {
        try {
          const response = await fetch(
            `${API_BASE}/events/${selectedEventId}/waiting-room/status?token=${waitingRoomToken}`
          );
          if (response.ok) {
            const status: WaitingRoomStatus = await response.json();
            setWaitingRoomStatus(status);
            setWaitingRoomError(null);
          } else {
            const errorData = await response.json();
            setWaitingRoomError(errorData.error || 'Failed to get status');
            setWaitingRoomStatus(null);
          }
        } catch (err: any) {
          setWaitingRoomError('Failed to check status');
          setWaitingRoomStatus(null);
        }
      };

      pollStatus();
      const interval = setInterval(pollStatus, 2000); // Poll every 2 seconds
      setStatusInterval(interval);

      return () => {
        clearInterval(interval);
      };
    } else {
      if (statusInterval) {
        clearInterval(statusInterval);
        setStatusInterval(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingRoomToken, selectedEventId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Convert datetime-local to ISO string
      const startsAt = formData.startsAt ? new Date(formData.startsAt).toISOString() : '';
      const onSaleAt = formData.onSaleAt ? new Date(formData.onSaleAt).toISOString() : '';

      // Create event (backend expects snake_case)
      const eventResponse = await fetch(`${API_BASE}/admin/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          venue: formData.venue,
          description: formData.description || undefined,
          starts_at: startsAt,
          on_sale_at: onSaleAt,
        }),
      });

      if (!eventResponse.ok) {
        const errorData = await eventResponse.json();
        throw new Error(errorData.error || 'Failed to create event');
      }

      const newEvent: Event = await eventResponse.json();

      // Create tier if provided
      if (formData.tierName && formData.priceCents && formData.capacity) {
        const tierResponse = await fetch(`${API_BASE}/admin/tiers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_id: newEvent.id,
            name: formData.tierName,
            price_cents: Number(formData.priceCents),
            capacity: Number(formData.capacity),
          }),
        });

        if (!tierResponse.ok) {
          const errorData = await tierResponse.json();
          throw new Error(errorData.error || 'Failed to create tier');
        }
      }

      // Clear form
      setFormData({
        name: '',
        venue: '',
        description: '',
        startsAt: '',
        onSaleAt: '',
        tierName: '',
        priceCents: '',
        capacity: '',
      });

      // Re-fetch events and tiers
      const eventsResponse = await fetch(`${API_BASE}/admin/events`);
      if (eventsResponse.ok) {
        const eventsData: Event[] = await eventsResponse.json();
        setEvents(eventsData);

        // Re-fetch all tiers for all events
        const tiersMap: Record<string, Tier[]> = {};
        for (const event of eventsData) {
          try {
            const tiersResponse = await fetch(`${API_BASE}/admin/tiers?event_id=${event.id}`);
            if (tiersResponse.ok) {
              const tiersData: Tier[] = await tiersResponse.json();
              tiersMap[event.id] = tiersData;
            }
          } catch (err) {
            tiersMap[event.id] = [];
          }
        }
        setTiersByEventId(tiersMap);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  };

  const getTotalCapacity = (eventId: string): number => {
    const tiers = tiersByEventId[eventId] || [];
    return tiers.reduce((sum, tier) => sum + tier.capacity, 0);
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const handleJoinWaitingRoom = async () => {
    if (!selectedEventId) {
      setWaitingRoomError('Please select an event');
      return;
    }

    try {
      setWaitingRoomError(null);
      const response = await fetch(
        `${API_BASE}/events/${selectedEventId}/waiting-room/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to join waiting room');
      }

      const data = await response.json();
      setWaitingRoomToken(data.token);
      setWaitingRoomStatus(null); // Will be set by polling
    } catch (err: any) {
      setWaitingRoomError(err.message || 'Failed to join waiting room');
      setWaitingRoomToken('');
    }
  };

  const handleCheckStatus = async () => {
    if (!selectedEventId || !waitingRoomToken) {
      setWaitingRoomError('Please join the waiting room first');
      return;
    }

    try {
      setWaitingRoomError(null);
      const response = await fetch(
        `${API_BASE}/events/${selectedEventId}/waiting-room/status?token=${waitingRoomToken}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get status');
      }

      const status: WaitingRoomStatus = await response.json();
      setWaitingRoomStatus(status);
    } catch (err: any) {
      setWaitingRoomError(err.message || 'Failed to check status');
      setWaitingRoomStatus(null);
    }
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return 'Sale is open!';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const handleClearQueue = async (eventId: string) => {
    if (!confirm('Are you sure you want to clear the waiting room queue for this event? This will remove all users from the queue.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/events/${eventId}/waiting-room/clear`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clear queue');
      }

      const data = await response.json();
      alert(`Queue cleared successfully. Removed ${data.cleared} users.`);
    } catch (err: any) {
      alert(err.message || 'Failed to clear queue');
    }
  };

  const handleClearOrders = async (eventId: string) => {
    if (!confirm('Are you sure you want to clear all orders and tickets for this event? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/admin/events/${eventId}/orders`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clear orders and tickets');
      }

      const data = await response.json();
      alert(`Orders and tickets cleared successfully. Deleted ${data.orders_deleted} orders and ${data.tickets_deleted} tickets.`);
      // Refresh events to update display
      const eventsResponse = await fetch(`${API_BASE}/admin/events`);
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to clear orders and tickets');
    }
  };

  const handlePauseEvent = async (eventId: string) => {
    try {
      const response = await fetch(`${API_BASE}/admin/events/${eventId}/pause`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to pause event');
      }

      alert('Event sales paused successfully');
      // Refresh events to update display
      const eventsResponse = await fetch(`${API_BASE}/admin/events`);
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to pause event');
    }
  };

  const handleResumeEvent = async (eventId: string) => {
    try {
      const response = await fetch(`${API_BASE}/admin/events/${eventId}/resume`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to resume event');
      }

      alert('Event sales resumed successfully');
      // Refresh events to update display
      const eventsResponse = await fetch(`${API_BASE}/admin/events`);
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to resume event');
    }
  };

  const handleViewStatus = async (eventId: string) => {
    try {
      const response = await fetch(`${API_BASE}/admin/events/${eventId}/status`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get event status');
      }

      const data = await response.json();
      const statusMessage = `
Event: ${data.event_name}
Status: ${data.status}
Paused: ${data.paused ? 'Yes' : 'No'}
Total Capacity: ${data.total_capacity}
Total Sold: ${data.total_sold}
Active Holds: ${data.total_active_holds}
Available: ${data.total_available}
Queue Length: ${data.queue_length}

Tier Breakdown:
${data.tiers.map((t: any) => 
  `  ${t.tier_name}: ${t.sold} sold, ${t.active_holds} holds, ${t.available} available`
).join('\n')}
      `.trim();
      
      alert(statusMessage);
    } catch (err: any) {
      alert(err.message || 'Failed to get event status');
    }
  };

  // Show user view if selected
  if (viewMode === 'user') {
    return (
      <div>
        <div style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 1000,
        }}>
          <button
            onClick={() => setViewMode('admin')}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Admin View
          </button>
        </div>
        <UserView />
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>TicketDrop Admin Demo</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <a
              href="http://localhost:4000/metrics"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '8px 16px',
                backgroundColor: '#17a2b8',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '4px',
                fontSize: '0.9rem',
              }}
            >
              📊 Metrics
            </a>
            <button
              onClick={() => setViewMode('user')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              User View
            </button>
          </div>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
          Prometheus metrics available at <code>http://localhost:4000/metrics</code>
        </div>
      </header>

      <main>
        {/* Health Status */}
        <section className="card">
          <h2>API Status</h2>
          <div className={`health-status ${healthStatus}`}>
            {healthStatus === 'online' ? 'API: Online' : healthStatus === 'offline' ? 'API: Offline' : 'Checking...'}
          </div>
        </section>

        {/* Create Event Form */}
        <section className="card">
          <h2>Create New Event</h2>
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Event Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="venue">Venue *</label>
              <input
                type="text"
                id="venue"
                name="venue"
                value={formData.venue}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="startsAt">Event Start *</label>
              <input
                type="datetime-local"
                id="startsAt"
                name="startsAt"
                value={formData.startsAt}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="onSaleAt">On Sale At *</label>
              <input
                type="datetime-local"
                id="onSaleAt"
                name="onSaleAt"
                value={formData.onSaleAt}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-section">
              <h3>Default Tier (Optional)</h3>
              <div className="form-group">
                <label htmlFor="tierName">Tier Name</label>
                <input
                  type="text"
                  id="tierName"
                  name="tierName"
                  value={formData.tierName}
                  onChange={handleInputChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="priceCents">Price (cents)</label>
                <input
                  type="number"
                  id="priceCents"
                  name="priceCents"
                  value={formData.priceCents}
                  onChange={handleInputChange}
                  min="0"
                />
              </div>

              <div className="form-group">
                <label htmlFor="capacity">Capacity</label>
                <input
                  type="number"
                  id="capacity"
                  name="capacity"
                  value={formData.capacity}
                  onChange={handleInputChange}
                  min="0"
                />
              </div>
            </div>

            <button type="submit" disabled={submitting} className="submit-button">
              {submitting ? 'Creating...' : 'Create Event'}
            </button>
          </form>
        </section>

        {/* Waiting Room Testing */}
        <section className="card">
          <h2>🧪 Feature 2: Waiting Room Testing</h2>
          
          <div className="form-group">
            <label htmlFor="eventSelect">Select Event (Public Events Only)</label>
            <select
              id="eventSelect"
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setWaitingRoomToken('');
                setWaitingRoomStatus(null);
                setWaitingRoomError(null);
              }}
              style={{ width: '100%', padding: '8px', marginTop: '8px' }}
            >
              <option value="">-- Select an event --</option>
              {publicEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} - {formatDate(event.on_sale_at)}
                </option>
              ))}
            </select>
          </div>

          {selectedEventId && (
            <div style={{ marginTop: '16px' }}>
              <button
                onClick={handleJoinWaitingRoom}
                disabled={!!waitingRoomToken}
                style={{
                  padding: '10px 20px',
                  backgroundColor: waitingRoomToken ? '#ccc' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: waitingRoomToken ? 'not-allowed' : 'pointer',
                  marginRight: '8px',
                }}
              >
                {waitingRoomToken ? 'Already Joined' : 'Join Waiting Room'}
              </button>

              <button
                onClick={handleCheckStatus}
                disabled={!waitingRoomToken}
                style={{
                  padding: '10px 20px',
                  backgroundColor: !waitingRoomToken ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: !waitingRoomToken ? 'not-allowed' : 'pointer',
                }}
              >
                Check Status
              </button>
            </div>
          )}

          {waitingRoomToken && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <p><strong>Token:</strong> <code style={{ fontSize: '12px', wordBreak: 'break-all' }}>{waitingRoomToken}</code></p>
            </div>
          )}

          {waitingRoomError && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px' }}>
              <strong>Error:</strong> {waitingRoomError}
            </div>
          )}

          {waitingRoomStatus && (
            <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#d4edda', borderRadius: '4px' }}>
              <h3 style={{ marginTop: 0 }}>Waiting Room Status</h3>
              <p><strong>State:</strong> 
                <span style={{ 
                  padding: '4px 8px', 
                  marginLeft: '8px',
                  backgroundColor: waitingRoomStatus.state === 'sale_open' ? '#28a745' : '#ffc107',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}>
                  {waitingRoomStatus.state === 'sale_open' ? '🟢 Sale Open' : '⏳ Waiting'}
                </span>
              </p>
              <p><strong>On Sale At:</strong> {formatDate(waitingRoomStatus.onSaleAt)}</p>
              <p><strong>Time Remaining:</strong> {formatTimeRemaining(waitingRoomStatus.secondsUntilOnSale)}</p>
              {waitingRoomStatus.state === 'waiting' && (
                <p style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                  ⏰ Auto-refreshing every 2 seconds...
                </p>
              )}
            </div>
          )}

          {publicEvents.length === 0 && (
            <p style={{ marginTop: '16px', color: '#666' }}>
              No public events available. Create an event with status "scheduled" or "on_sale" to test.
            </p>
          )}
        </section>

        {/* Events List */}
        <section className="card">
          <h2>Events</h2>
          {loading ? (
            <p>Loading events...</p>
          ) : events.length === 0 ? (
            <p>No events yet. Create one above.</p>
          ) : (
            <div className="events-list">
              {events.map((event) => {
                const totalCapacity = getTotalCapacity(event.id);
                const tiers = tiersByEventId[event.id] || [];

                return (
                  <div key={event.id} className="event-card">
                    <h3>{event.name}</h3>
                    <div className="event-details">
                      <p><strong>Venue:</strong> {event.venue}</p>
                      {event.description && (
                        <p><strong>Description:</strong> {event.description}</p>
                      )}
                      <p><strong>On Sale:</strong> {formatDate(event.on_sale_at)}</p>
                      <p><strong>Starts:</strong> {formatDate(event.starts_at)}</p>
                      {event.status && (
                        <p><strong>Status:</strong> {event.status}</p>
                      )}
                      {totalCapacity > 0 && (
                        <p><strong>Total Capacity:</strong> {totalCapacity}</p>
                      )}
                      {tiers.length > 0 && (
                        <div className="tiers">
                          <strong>Tiers:</strong>
                          <ul>
                            {tiers.map((tier) => (
                              <li key={tier.id}>
                                {tier.name} - ${(tier.price_cents / 100).toFixed(2)} ({tier.capacity} tickets)
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
                      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong>Status:</strong>
                        {event.paused ? (
                          <span style={{ color: '#dc3545', fontWeight: 'bold' }}>⏸️ PAUSED</span>
                        ) : (
                          <span style={{ color: '#28a745', fontWeight: 'bold' }}>▶️ ACTIVE</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {event.paused ? (
                          <button
                            onClick={() => handleResumeEvent(event.id)}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#28a745',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                            }}
                          >
                            ▶ Resume Sales
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePauseEvent(event.id)}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#ffc107',
                              color: '#333',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                            }}
                          >
                            ⏸ Pause Sales
                          </button>
                        )}
                        <button
                          onClick={() => handleViewStatus(event.id)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#17a2b8',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                          }}
                        >
                          📊 View Status
                        </button>
                        <button
                          onClick={() => handleClearQueue(event.id)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                          }}
                        >
                          Clear Queue
                        </button>
                        <button
                          onClick={() => handleClearOrders(event.id)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#ff6b35',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                          }}
                        >
                          Clear Orders
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;

