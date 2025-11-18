import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:4000';

interface Event {
  id: string;
  name: string;
  venue: string;
  description?: string;
  starts_at: string;
  on_sale_at: string;
  status?: string;
  tiers?: Tier[];
}

interface Tier {
  id: string;
  name: string;
  price_cents: number;
  capacity: number;
}

interface WaitingRoomStatus {
  state: 'waiting' | 'sale_open';
  onSaleAt: string;
  secondsUntilOnSale: number;
  position?: number | null;
  total?: number;
  canEnter?: boolean;
  etaSeconds?: number;
  paused?: boolean;
}

interface TierAvailability {
  tier_id: string;
  tier_name: string;
  capacity: number;
  available: number;
  reserved: number;
  sold: number;
  price_cents: number;
  per_user_limit: number;
}

interface AvailabilityResponse {
  event_id: string;
  event_name: string;
  availability: TierAvailability[];
  last_updated: string;
}

interface Reservation {
  id: string;
  event_id: string;
  tier_id: string;
  tier_name: string;
  quantity: number;
  price_cents: number;
  total_price_cents: number;
  expires_at: string;
  expires_in_seconds: number;
}

interface CheckoutSession {
  id: string;
  reservation_id: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  reservation: {
    id: string;
    tier_name: string;
    quantity: number;
    price_cents: number;
    total_price_cents: number;
    expires_at: string;
  };
  created_at: string;
}

interface Order {
  id: string;
  checkout_session_id: string;
  status: 'paid' | 'refunded' | 'canceled';
  quantity: number;
  total_price_cents: number;
  created_at: string;
}

interface Ticket {
  id: string;
  code: string;
  qr_sig: string;
  created_at: string;
}

export default function UserView() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [waitingRoomToken, setWaitingRoomToken] = useState<string>('');
  const [waitingRoomStatus, setWaitingRoomStatus] = useState<WaitingRoomStatus | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [showMyTickets, setShowMyTickets] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<string>('');
  const [reservationQuantity, setReservationQuantity] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Get or create canonical user ID (persisted in localStorage)
  const getUserId = (): string => {
    let userId = localStorage.getItem('userId');
    if (!userId) {
      userId = `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      localStorage.setItem('userId', userId);
    }
    return userId;
  };

  // Helper to get headers with X-User-Id
  const getHeaders = (): HeadersInit => {
    return {
      'Content-Type': 'application/json',
      'X-User-Id': getUserId(),
    };
  };

  // Helper to handle API errors with specific messages
  const handleApiError = async (response: Response, defaultMessage: string): Promise<string> => {
    try {
      const errorData = await response.json();
      const errorCode = errorData.error;
      
      if (response.status === 429) {
        return 'Too many attempts. Please wait a moment and try again.';
      }
      
      if (errorCode === 'purchase_limit_exceeded') {
        const limit = errorData.limit || 6;
        const alreadyPurchased = errorData.alreadyPurchased || 0;
        const activeHolds = errorData.activeHolds || 0;
        return `You've reached the purchase limit for this event (limit: ${limit} tickets). You already have ${alreadyPurchased} purchased and ${activeHolds} reserved.`;
      }
      
      if (errorCode === 'rate_limited') {
        const retryAfter = errorData.retryAfterSeconds || 60;
        return `Too many attempts. Please wait ${retryAfter} seconds and try again.`;
      }
      
      if (errorCode === 'reservation_expired_or_invalid') {
        return 'Your reservation expired before checkout finished. Please reserve again.';
      }
      
      return errorData.error || errorData.message || defaultMessage;
    } catch {
      return defaultMessage;
    }
  };

  const clearPersistedOrderState = () => {
    const tabSessionId = sessionStorage.getItem('tabSessionId');
    setOrder(null);
    setTickets([]);
    setCheckoutSession(null);
    if (tabSessionId) {
      sessionStorage.removeItem(`order_${tabSessionId}`);
      sessionStorage.removeItem(`tickets_${tabSessionId}`);
      sessionStorage.removeItem(`checkoutSession_${tabSessionId}`);
    }
  };

  // Check status helper function
  const checkStatusForToken = async (eventId: string, token: string) => {
    try {
      const response = await fetch(
        `${API_BASE}/events/${eventId}/waiting-room/status?token=${token}`
      );

      if (!response.ok) {
        // If token is invalid, clear it from sessionStorage
        if (response.status === 404) {
          setWaitingRoomToken('');
          // Token will be cleared from sessionStorage via useEffect
        }
        return null;
      }

      const status: WaitingRoomStatus = await response.json();
      // Ensure position and total are numbers if they exist
      if (status.position !== undefined && status.position !== null) {
        status.position = typeof status.position === 'string' ? parseInt(status.position, 10) : status.position;
      }
      if (status.total !== undefined && status.total !== null) {
        status.total = typeof status.total === 'string' ? parseInt(status.total, 10) : status.total;
      }
      setWaitingRoomStatus(status);
      return status;
    } catch (err: any) {
      return null;
    }
  };

  // Load saved token and event from sessionStorage on mount (per-tab isolation)
  useEffect(() => {
    // Get or create session ID for this tab
    let tabSessionId = sessionStorage.getItem('tabSessionId');
    if (!tabSessionId) {
      tabSessionId = `tab-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem('tabSessionId', tabSessionId);
    }
    
    const savedToken = sessionStorage.getItem(`waitingRoomToken_${tabSessionId}`);
    const savedEventId = sessionStorage.getItem(`waitingRoomEventId_${tabSessionId}`);
    const savedCheckoutSession = sessionStorage.getItem(`checkoutSession_${tabSessionId}`);
    const savedOrder = sessionStorage.getItem(`order_${tabSessionId}`);
    const savedReservation = sessionStorage.getItem(`reservation_${tabSessionId}`);
    
    // Restore reservation if it exists
    if (savedReservation) {
      try {
        const reservationData: Reservation = JSON.parse(savedReservation);
        setReservation(reservationData);
      } catch (err) {
        // Invalid JSON, clear it
        sessionStorage.removeItem(`reservation_${tabSessionId}`);
      }
    }
    
    // Restore checkout session if it exists
    if (savedCheckoutSession) {
      try {
        const checkoutSessionData: CheckoutSession = JSON.parse(savedCheckoutSession);
        setCheckoutSession(checkoutSessionData);
      } catch (err) {
        // Invalid JSON, clear it
        sessionStorage.removeItem(`checkoutSession_${tabSessionId}`);
      }
    }

    // Restore order if it exists
    if (savedOrder) {
      try {
        const orderData: Order = JSON.parse(savedOrder);
        setOrder(orderData);
      } catch (err) {
        // Invalid JSON, clear it
        sessionStorage.removeItem(`order_${tabSessionId}`);
      }
    }

    // Restore tickets if they exist
    const savedTickets = sessionStorage.getItem(`tickets_${tabSessionId}`);
    if (savedTickets) {
      try {
        const ticketsData: Ticket[] = JSON.parse(savedTickets);
        setTickets(ticketsData);
      } catch (err) {
        // Invalid JSON, clear it
        sessionStorage.removeItem(`tickets_${tabSessionId}`);
      }
    }
    
    if (savedToken && savedEventId) {
      setWaitingRoomToken(savedToken);
      // Fetch event details to restore selectedEvent
      fetchEventDetails(savedEventId).then((event) => {
        if (event) {
          // Automatically check status after restoring
          setTimeout(() => {
            checkStatusForToken(savedEventId, savedToken).then((status) => {
              // If user can enter and we have a checkout session, fetch the reservation
              if (status?.canEnter && savedCheckoutSession) {
                // Fetch reservation to validate checkout session
                fetchReservation(savedEventId, savedToken);
              }
            });
          }, 500);
        }
      });
    }
  }, []);

  // Save token and event to sessionStorage when they change (per-tab)
  useEffect(() => {
    const tabSessionId = sessionStorage.getItem('tabSessionId');
    if (!tabSessionId) return; // Session ID should exist by now
    
    if (waitingRoomToken && selectedEvent) {
      sessionStorage.setItem(`waitingRoomToken_${tabSessionId}`, waitingRoomToken);
      sessionStorage.setItem(`waitingRoomEventId_${tabSessionId}`, selectedEvent.id);
    } else if (!waitingRoomToken) {
      // Clear sessionStorage if token is cleared
      if (tabSessionId) {
        sessionStorage.removeItem(`waitingRoomToken_${tabSessionId}`);
        sessionStorage.removeItem(`waitingRoomEventId_${tabSessionId}`);
      }
    }
  }, [waitingRoomToken, selectedEvent]);

  // Fetch public events
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE}/events`);
        if (response.ok) {
          const data: Event[] = await response.json();
          setEvents(data);
          if (data.length === 0) {
            setError('No events available. Make sure the database is seeded.');
          }
        } else {
          setError(`API returned error: ${response.status} ${response.statusText}`);
        }
      } catch (err: any) {
        console.error('Failed to fetch events:', err);
        setError(`Cannot connect to API at ${API_BASE}. Make sure the API server is running (npm run dev in the api folder).`);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch event details with tiers
  const fetchEventDetails = async (eventId: string) => {
    try {
      const response = await fetch(`${API_BASE}/events/${eventId}`);
      if (response.ok) {
        const event: Event = await response.json();
        setSelectedEvent(event);
        setError(null);
        
        // Also fetch availability
        fetchAvailability(eventId);
        
        return event;
      } else {
        setError('Failed to load event details');
        return null;
      }
    } catch (err) {
      setError('Failed to load event details');
      return null;
    }
  };

  // Fetch availability for an event
  const fetchAvailability = async (eventId: string) => {
    try {
      const response = await fetch(`${API_BASE}/events/${eventId}/availability`);
      if (response.ok) {
        const data: AvailabilityResponse = await response.json();
        setAvailability(data);
      }
    } catch (err) {
      // Silently fail - availability is nice to have but not critical
    }
  };

  // Poll waiting room status and availability
  useEffect(() => {
    if (waitingRoomToken && selectedEvent) {
      const pollStatus = async () => {
        try {
          const response = await fetch(
            `${API_BASE}/events/${selectedEvent.id}/waiting-room/status?token=${waitingRoomToken}`
          );
          if (response.ok) {
            const status: WaitingRoomStatus = await response.json();
            // Ensure position and total are numbers if they exist
            if (status.position !== undefined && status.position !== null) {
              status.position = typeof status.position === 'string' ? parseInt(status.position, 10) : status.position;
            }
            if (status.total !== undefined && status.total !== null) {
              status.total = typeof status.total === 'string' ? parseInt(status.total, 10) : status.total;
            }
            setWaitingRoomStatus(status);
            setError(null);
          } else {
            const errorData = await response.json();
            setError(errorData.error || 'Failed to get status');
          }
        } catch (err) {
          setError('Failed to check status');
        }
      };

      pollStatus();
      const interval = setInterval(pollStatus, 2000); // Poll every 2 seconds
      return () => clearInterval(interval);
    }
  }, [waitingRoomToken, selectedEvent]);

  // Poll availability when event is selected (every 5 seconds)
  useEffect(() => {
    if (selectedEvent) {
      fetchAvailability(selectedEvent.id);
      const interval = setInterval(() => {
        fetchAvailability(selectedEvent.id);
      }, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [selectedEvent]);

  // Fetch active reservation when user can enter
  const fetchReservation = async (eventId: string, token: string) => {
    try {
      const response = await fetch(`${API_BASE}/events/${eventId}/reservations?token=${token}`, {
        headers: getHeaders(),
      });
      if (response.ok) {
        const data: Reservation = await response.json();
        setReservation(data);
        
        // Update sessionStorage with latest reservation data
        const tabSessionId = sessionStorage.getItem('tabSessionId');
        if (tabSessionId) {
          sessionStorage.setItem(`reservation_${tabSessionId}`, JSON.stringify(data));
        }
      } else if (response.status === 404) {
        // Only clear reservation if we don't have an order
        // If we have an order, the reservation was converted, so keep it for display
        if (!order) {
          setReservation(null);
          // Clear from sessionStorage
          const tabSessionId = sessionStorage.getItem('tabSessionId');
          if (tabSessionId) {
            sessionStorage.removeItem(`reservation_${tabSessionId}`);
          }
        }
      }
    } catch (err) {
      // Silently fail - don't clear reservation on network errors
      // The reservation might still be valid, just couldn't fetch it
    }
  };

  // Poll reservation when user can enter OR when we have a reservation (to keep expiration timer updated)
  // Stop polling if we have an order (reservation is converted)
  useEffect(() => {
    // Don't poll if we already have an order (reservation is converted)
    if (order) {
      return;
    }
    
    // Poll if user can enter OR if we have a reservation (to keep expiration timer updated)
    if ((waitingRoomStatus?.canEnter || reservation) && selectedEvent && waitingRoomToken) {
      fetchReservation(selectedEvent.id, waitingRoomToken);
      const interval = setInterval(() => {
        fetchReservation(selectedEvent.id, waitingRoomToken);
      }, 2000); // Poll every 2 seconds to update expiration
      return () => clearInterval(interval);
    }
  }, [waitingRoomStatus?.canEnter, reservation, selectedEvent, waitingRoomToken, order]);

  // Keep confirmed orders in sync with the server. This helps when an admin clears
  // orders/tickets so the UI doesn't keep showing stale confirmation state.
  useEffect(() => {
    if (!order) {
      return;
    }

    let isMounted = true;

    const tabSessionId = sessionStorage.getItem('tabSessionId');
    const tokenFromStorage = (() => {
      if (waitingRoomToken) {
        return waitingRoomToken;
      }
      if (!tabSessionId) {
        return '';
      }
      return sessionStorage.getItem(`waitingRoomToken_${tabSessionId}`) || '';
    })();

    if (!tokenFromStorage) {
      return;
    }

    const syncOrderWithServer = async () => {
      try {
        const params = new URLSearchParams({ token: tokenFromStorage });
        if (selectedEvent?.id) {
          params.append('event_id', selectedEvent.id);
        }

        const response = await fetch(`${API_BASE}/me/order?${params.toString()}`);

        if (response.status === 404) {
          if (!isMounted) return;
          clearPersistedOrderState();
          setReservation(null);
          return;
        }

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!isMounted) return;

        if (data.order) {
          setOrder(data.order);
          if (tabSessionId) {
            sessionStorage.setItem(`order_${tabSessionId}`, JSON.stringify(data.order));
          }
        }

        if (Array.isArray(data.tickets)) {
          setTickets(data.tickets);
          if (tabSessionId) {
            sessionStorage.setItem(`tickets_${tabSessionId}`, JSON.stringify(data.tickets));
          }
        }
      } catch (err) {
        // Ignore sync errors; we'll try again on next interval
      }
    };

    syncOrderWithServer();
    const interval = setInterval(syncOrderWithServer, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [order?.id, waitingRoomToken, selectedEvent?.id]);

  // Validate checkout session matches current reservation
  // Only validate if we have both - don't clear if reservation is still loading
  // Don't validate if we have an order (reservation is converted)
  useEffect(() => {
    // If we have an order, don't validate - the reservation was converted
    if (order) {
      return;
    }
    
    if (checkoutSession && reservation) {
      // If checkout session's reservation_id doesn't match current reservation, clear it
      if (checkoutSession.reservation_id !== reservation.id) {
        setCheckoutSession(null);
        const tabSessionId = sessionStorage.getItem('tabSessionId');
        if (tabSessionId) {
          sessionStorage.removeItem(`checkoutSession_${tabSessionId}`);
        }
      }
    }
    // Don't clear checkout session if reservation is null - it might still be loading
    // Only clear if we explicitly know the reservation doesn't exist (handled elsewhere)
  }, [checkoutSession, reservation, order]);

  // Create reservation
  const handleCreateReservation = async () => {
    if (!selectedEvent || !waitingRoomToken || !selectedTierId || reservationQuantity < 1) {
      setError('Please select a tier and quantity');
      return;
    }

    try {
      setReserving(true);
      setError(null);

      const response = await fetch(`${API_BASE}/events/${selectedEvent.id}/reservations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          tier_id: selectedTierId,
          quantity: reservationQuantity,
          token: waitingRoomToken,
        }),
      });

      if (!response.ok) {
        const errorMessage = await handleApiError(response, 'Failed to create reservation');
        throw new Error(errorMessage);
      }

      const data: Reservation = await response.json();
      setReservation(data);
      
      // Persist reservation to sessionStorage
      const tabSessionId = sessionStorage.getItem('tabSessionId');
      if (tabSessionId) {
        sessionStorage.setItem(`reservation_${tabSessionId}`, JSON.stringify(data));
      }
      
      // Clear any existing checkout session and order since we have a new reservation
      clearPersistedOrderState();
      setSelectedTierId('');
      setReservationQuantity(1);
      
      // Refresh availability
      if (selectedEvent) {
        fetchAvailability(selectedEvent.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create reservation');
    } finally {
      setReserving(false);
    }
  };

  // Generate idempotency key (UUID)
  const generateIdempotencyKey = () => {
    return `checkout-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  };

  // Create checkout session
  const handleCreateCheckout = async () => {
    if (!reservation || !waitingRoomToken) {
      setError('No reservation found');
      return;
    }

    try {
      setCreatingCheckout(true);
      setError(null);

      const idempotencyKey = generateIdempotencyKey();

      const response = await fetch(`${API_BASE}/checkout/sessions`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          reservation_id: reservation.id,
        }),
      });

      if (!response.ok) {
        const errorMessage = await handleApiError(response, 'Failed to create checkout session');
        throw new Error(errorMessage);
      }

      const data: CheckoutSession = await response.json();
      setCheckoutSession(data);
      
      // Save checkout session to sessionStorage
      const tabSessionId = sessionStorage.getItem('tabSessionId');
      if (tabSessionId) {
        sessionStorage.setItem(`checkoutSession_${tabSessionId}`, JSON.stringify(data));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create checkout session');
    } finally {
      setCreatingCheckout(false);
    }
  };

  // Confirm payment
  const handleConfirmPayment = async () => {
    if (!checkoutSession) {
      setError('No checkout session found');
      return;
    }

    try {
      setConfirmingPayment(true);
      setError(null);

      const response = await fetch(`${API_BASE}/checkout/confirm`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          checkout_id: checkoutSession.id,
          simulate: 'success', // Simulate successful payment
        }),
      });

      if (!response.ok) {
        const errorMessage = await handleApiError(response, 'Failed to confirm payment');
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Update checkout session status
      if (data.checkout_session) {
        setCheckoutSession({
          ...checkoutSession,
          status: data.checkout_session.status,
        });
        
        // Save updated checkout session to sessionStorage
        const tabSessionId = sessionStorage.getItem('tabSessionId');
        if (tabSessionId) {
          sessionStorage.setItem(`checkoutSession_${tabSessionId}`, JSON.stringify({
            ...checkoutSession,
            status: data.checkout_session.status,
          }));
        }
      }

      // Set order and tickets if payment was successful
      if (data.order) {
        setOrder(data.order);
        
        // Save order to sessionStorage
        const tabSessionId = sessionStorage.getItem('tabSessionId');
        if (tabSessionId) {
          sessionStorage.setItem(`order_${tabSessionId}`, JSON.stringify(data.order));
        }
      }

      // Set tickets if they were generated
      if (data.tickets && Array.isArray(data.tickets)) {
        setTickets(data.tickets);
        
        // Save tickets to sessionStorage
        const tabSessionId = sessionStorage.getItem('tabSessionId');
        if (tabSessionId) {
          sessionStorage.setItem(`tickets_${tabSessionId}`, JSON.stringify(data.tickets));
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to confirm payment');
    } finally {
      setConfirmingPayment(false);
    }
  };

  const handleResetCheckoutFlow = () => {
    setWaitingRoomToken('');
    setWaitingRoomStatus(null);
    setSelectedTierId('');
    setReservation(null);
    setCheckoutSession(null);
    setOrder(null);
    setTickets([]);
    setReservationQuantity(1);

    const tabSessionId = sessionStorage.getItem('tabSessionId');
    if (tabSessionId) {
      sessionStorage.removeItem(`waitingRoomToken_${tabSessionId}`);
      sessionStorage.removeItem(`waitingRoomEventId_${tabSessionId}`);
      sessionStorage.removeItem(`checkoutSession_${tabSessionId}`);
      sessionStorage.removeItem(`order_${tabSessionId}`);
      sessionStorage.removeItem(`tickets_${tabSessionId}`);
    }
  };

  // Fetch all tickets for the user
  const fetchAllTickets = async () => {
    // Try to get token from state or sessionStorage
    let token = waitingRoomToken;
    if (!token) {
      const tabSessionId = sessionStorage.getItem('tabSessionId');
      if (tabSessionId) {
        token = sessionStorage.getItem(`waitingRoomToken_${tabSessionId}`) || '';
      }
    }

    if (!token) {
      setError('No token found. Please join a waiting room first.');
      return;
    }

    try {
      setError(null);
      const response = await fetch(`${API_BASE}/me/tickets`, {
        headers: getHeaders(),
      });
      
      if (!response.ok) {
        const errorMessage = await handleApiError(response, 'Failed to fetch tickets');
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setAllTickets(data.tickets || []);
      setShowMyTickets(true);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tickets');
    }
  };

  const handleJoinWaitingRoom = async () => {
    if (!selectedEvent) return;

    try {
      setJoining(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/events/${selectedEvent.id}/waiting-room/join`,
        {
          method: 'POST',
          headers: getHeaders(),
        }
      );

      if (!response.ok) {
        const errorMessage = await handleApiError(response, 'Failed to join waiting room');
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setWaitingRoomToken(data.token);
      // Token will be saved to localStorage via useEffect
    } catch (err: any) {
      setError(err.message || 'Failed to join waiting room');
    } finally {
      setJoining(false);
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
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

  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  if (showMyTickets) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.8rem', margin: 0 }}>My Tickets</h2>
          <button
            onClick={() => setShowMyTickets(false)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Back to Events
          </button>
        </div>
        
        {allTickets.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
            <p style={{ fontSize: '1.1rem' }}>No tickets found.</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Purchase tickets to see them here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {allTickets.map((ticket: any) => (
              <div key={ticket.id} style={{
                padding: '1.5rem',
                backgroundColor: 'white',
                border: '1px solid #dee2e6',
                borderRadius: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.3rem', margin: '0 0 0.5rem 0' }}>{ticket.event.name}</h3>
                    <p style={{ fontSize: '0.9rem', color: '#666', margin: '0.25rem 0' }}>
                      📍 {ticket.event.venue}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: '#666', margin: '0.25rem 0' }}>
                      📅 {formatDate(ticket.event.starts_at)}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#28a745', margin: '0 0 0.5rem 0' }}>
                      {formatPrice(ticket.tier.price_cents)}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>
                      {ticket.tier.name}
                    </p>
                  </div>
                </div>
                <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', marginTop: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Ticket Code:</p>
                  <p style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#333', margin: '0.5rem 0' }}>
                    {ticket.code}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.5rem' }}>
                    QR Signature: {ticket.qr_sig.substring(0, 32)}...
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Determine current step for demo guide
  const getCurrentStep = (): number => {
    if (order) return 5; // Completed
    if (checkoutSession) return 4; // Checkout
    if (reservation) return 3; // Reservation
    if (waitingRoomStatus?.canEnter) return 2; // Can enter
    if (waitingRoomToken) return 1; // Joined waiting room
    return 0; // Not started
  };

  const currentStep = getCurrentStep();
  const demoSteps = [
    { num: 1, label: 'Pick an event', done: selectedEvent !== null },
    { num: 2, label: 'Join the waiting room', done: waitingRoomToken !== '' },
    { num: 3, label: 'Wait until admitted', done: waitingRoomStatus?.canEnter === true },
    { num: 4, label: 'Reserve tickets', done: reservation !== null },
    { num: 5, label: 'Checkout and view "My Tickets"', done: order !== null },
  ];

  if (selectedEvent) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
        {/* Demo Guide Banner */}
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          backgroundColor: '#e7f3ff',
          borderRadius: '8px',
          border: '1px solid #007bff',
        }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.1rem', color: '#007bff' }}>
            📋 Demo Guide
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {demoSteps.map((step) => (
              <div
                key={step.num}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  backgroundColor: step.done ? '#28a745' : currentStep === step.num ? '#ffc107' : '#e9ecef',
                  color: step.done ? 'white' : currentStep === step.num ? '#333' : '#666',
                  fontWeight: currentStep === step.num ? 'bold' : 'normal',
                  fontSize: '0.9rem',
                  border: currentStep === step.num ? '2px solid #ffc107' : 'none',
                }}
              >
                {step.done ? '✓' : step.num}. {step.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <button
            onClick={() => {
              setSelectedEvent(null);
              setWaitingRoomToken('');
              setWaitingRoomStatus(null);
              setError(null);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            ← Back to Events
          </button>
          <button
            onClick={fetchAllTickets}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            My Tickets
          </button>
        </div>

        <div style={{
          background: 'white',
          borderRadius: '8px',
          padding: '2rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <h1 style={{ marginTop: 0, fontSize: '2rem' }}>{selectedEvent.name}</h1>
          <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: '1rem' }}>
            📍 {selectedEvent.venue}
          </p>
          
          {selectedEvent.description && (
            <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
              {selectedEvent.description}
            </p>
          )}

          <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
            <p><strong>Event Date:</strong> {formatDate(selectedEvent.starts_at)}</p>
            <p><strong>On Sale:</strong> {formatDate(selectedEvent.on_sale_at)}</p>
          </div>

          {selectedEvent.tiers && selectedEvent.tiers.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Ticket Options</h2>
                {availability && (
                  <span style={{ fontSize: '0.85rem', color: '#666' }}>
                    Updated: {new Date(availability.last_updated).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {selectedEvent.tiers.map((tier) => {
                  // Find availability for this tier
                  const tierAvailability = availability?.availability.find(a => a.tier_id === tier.id);
                  const available = tierAvailability?.available ?? tier.capacity;
                  const reserved = tierAvailability?.reserved ?? 0;
                  const sold = tierAvailability?.sold ?? 0;
                  const isLowStock = available > 0 && available <= 10;
                  const isSoldOut = available === 0;
                  
                  return (
                    <div
                      key={tier.id}
                      style={{
                        padding: '1rem',
                        border: `1px solid ${isSoldOut ? '#dc3545' : isLowStock ? '#ffc107' : '#dee2e6'}`,
                        borderRadius: '4px',
                        backgroundColor: isSoldOut ? '#f8d7da' : isLowStock ? '#fff3cd' : 'white',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <strong style={{ fontSize: '1.1rem' }}>{tier.name}</strong>
                            {isSoldOut && (
                              <span style={{ 
                                padding: '2px 8px', 
                                backgroundColor: '#dc3545', 
                                color: 'white', 
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold'
                              }}>
                                SOLD OUT
                              </span>
                            )}
                            {isLowStock && !isSoldOut && (
                              <span style={{ 
                                padding: '2px 8px', 
                                backgroundColor: '#ffc107', 
                                color: '#333', 
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold'
                              }}>
                                LOW STOCK
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.9rem', color: '#666' }}>
                            <div>
                              <strong>Available:</strong> {available} of {tier.capacity}
                              {availability && (reserved > 0 || sold > 0) && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                                  ({reserved} reserved, {sold} sold)
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: '2px', fontSize: '0.85rem' }}>
                              Max {tierAvailability?.per_user_limit ?? 4} per person
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#28a745', marginLeft: '1rem' }}>
                          {formatPrice(tier.price_cents)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!waitingRoomToken ? (
            <div>
              <button
                onClick={handleJoinWaitingRoom}
                disabled={joining}
                style={{
                  width: '100%',
                  padding: '1rem',
                  fontSize: '1.1rem',
                  backgroundColor: joining ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: joining ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                }}
              >
                {joining ? 'Joining...' : 'Join Waiting Room'}
              </button>
            </div>
          ) : (
            <div style={{
              padding: '1.5rem',
              backgroundColor: waitingRoomStatus?.state === 'sale_open' ? '#d4edda' : '#fff3cd',
              borderRadius: '8px',
              border: `2px solid ${waitingRoomStatus?.state === 'sale_open' ? '#28a745' : '#ffc107'}`,
            }}>
              <h2 style={{ marginTop: 0, fontSize: '1.5rem' }}>
                {waitingRoomStatus?.paused
                  ? '⛔ Sales Are Paused'
                  : waitingRoomStatus?.state === 'sale_open'
                    ? '🟢 Sale is Open!'
                    : '⏳ You\'re in the Waiting Room'}
              </h2>
              
              {waitingRoomStatus && (
                <>
                  {!waitingRoomStatus.paused && waitingRoomStatus.state === 'waiting' && (
                    <div style={{ marginTop: '1rem' }}>
                      <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        <strong>Time until sale opens:</strong>
                      </p>
                      <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ffc107', margin: '0.5rem 0' }}>
                        {formatTimeRemaining(waitingRoomStatus.secondsUntilOnSale)}
                      </p>
                      <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
                        Sale opens at: {formatDate(waitingRoomStatus.onSaleAt)}
                      </p>
                      <p style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.5rem', fontStyle: 'italic' }}>
                        Your queue position will be assigned when the sale opens.
                      </p>
                    </div>
                  )}
                  
                  {!waitingRoomStatus.paused && waitingRoomStatus.state === 'sale_open' && (
                    <div style={{ marginTop: '1rem' }}>
                      {/* Display position if we have it (checking for number type, not just truthy) */}
                      {(typeof waitingRoomStatus.position === 'number' && waitingRoomStatus.position > 0) ? (
                        <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: '4px' }}>
                          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                            <strong>Your Position in Queue:</strong>
                          </p>
                          <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#007bff', margin: '0.5rem 0' }}>
                            #{waitingRoomStatus.position}
                            {typeof waitingRoomStatus.total === 'number' && waitingRoomStatus.total > 0 && (
                              <span style={{ fontSize: '1rem', color: '#666', fontWeight: 'normal' }}>
                                {' '}of {waitingRoomStatus.total}
                              </span>
                            )}
                          </p>
                        </div>
                      ) : (
                        <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: '4px' }}>
                          <p style={{ fontSize: '1rem', color: '#666' }}>
                            Calculating your queue position...
                            {waitingRoomStatus.total && (
                              <span style={{ display: 'block', fontSize: '0.85rem', marginTop: '0.5rem', color: '#999' }}>
                                (Total in queue: {waitingRoomStatus.total})
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      
                      {waitingRoomStatus.canEnter ? (
                        <div style={{ padding: '1rem', backgroundColor: '#28a745', color: 'white', borderRadius: '4px', marginTop: '0.5rem' }}>
                          <p style={{ fontSize: '1.1rem', margin: 0, fontWeight: 'bold', marginBottom: '0.5rem' }}>
                            ✅ You can enter now! Reserve your tickets below.
                          </p>
                        </div>
                      ) : waitingRoomStatus.etaSeconds !== undefined && waitingRoomStatus.etaSeconds > 0 ? (
                        <div style={{ padding: '1rem', backgroundColor: '#ffc107', color: '#333', borderRadius: '4px', marginTop: '0.5rem' }}>
                          <p style={{ fontSize: '1rem', margin: 0 }}>
                            <strong>Estimated wait time:</strong> {formatTimeRemaining(waitingRoomStatus.etaSeconds)}
                          </p>
                          <p style={{ fontSize: '0.85rem', margin: '0.5rem 0 0 0' }}>
                            You'll be admitted in the next wave. Please wait...
                          </p>
                        </div>
                      ) : (
                        <div style={{ padding: '1rem', backgroundColor: '#17a2b8', color: 'white', borderRadius: '4px', marginTop: '0.5rem' }}>
                          <p style={{ fontSize: '1rem', margin: 0 }}>
                            Tickets are now available! Your position is being calculated...
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {waitingRoomStatus.paused && (
                    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8d7da', borderRadius: '4px', border: '1px solid #dc3545', color: '#721c24' }}>
                      <p style={{ fontSize: '1rem', margin: 0 }}>
                        Sales are currently paused by the organizer. Please check back later.
                      </p>
                    </div>
                  )}
                </>
              )}

              <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '1rem', fontStyle: 'italic' }}>
                Status updates automatically every 2 seconds
              </p>
            </div>
          )}

          {/* Reservation/Order Section - Show when user can enter, has a reservation, or has an order */}
          {(waitingRoomStatus?.canEnter || reservation || order) && selectedEvent && (
            <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
              {order ? (
                <div>
                  <h3 style={{ marginTop: 0, fontSize: '1.3rem', marginBottom: '1rem' }}>
                    🎉 Order Confirmed
                  </h3>
                  <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '4px', marginBottom: '1rem' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      <strong>Order #{order.id.substring(0, 8)}</strong>
                    </p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#28a745', marginBottom: '0.5rem' }}>
                      Total Paid: {formatPrice(order.total_price_cents)}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: '#666' }}>
                      Status: <strong>{order.status}</strong>
                    </p>
                    {tickets.length > 0 && (
                      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #dee2e6' }}>
                        <p style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                          Your Tickets ({tickets.length}):
                        </p>
                        {tickets.map((ticket, index) => (
                          <div key={ticket.id} style={{ 
                            padding: '0.75rem', 
                            backgroundColor: '#f8f9fa', 
                            borderRadius: '4px', 
                            marginBottom: '0.5rem',
                            fontSize: '0.85rem'
                          }}>
                            <p style={{ margin: '0.25rem 0', fontWeight: 'bold' }}>
                              Ticket #{index + 1}
                            </p>
                            <p style={{ margin: '0.25rem 0', fontFamily: 'monospace', fontSize: '0.8rem', color: '#666' }}>
                              Code: {ticket.code}
                            </p>
                            <p style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#999' }}>
                              QR Signature: {ticket.qr_sig.substring(0, 16)}...
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {tickets.length === 0 && (
                      <p style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.5rem', fontStyle: 'italic' }}>
                        Your tickets will be issued shortly
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                      <button
                        onClick={fetchAllTickets}
                        style={{
                          padding: '0.6rem 1rem',
                          backgroundColor: '#007bff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          fontWeight: 'bold',
                        }}
                      >
                        Open My Tickets
                      </button>
                      <button
                        onClick={handleResetCheckoutFlow}
                        style={{
                          padding: '0.6rem 1rem',
                          backgroundColor: '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                        }}
                      >
                        Start New Checkout
                      </button>
                    </div>
                  </div>
                </div>
              ) : reservation ? (
                <div>
                  <h3 style={{ marginTop: 0, fontSize: '1.3rem', marginBottom: '1rem' }}>
                    🎫 Your Reservation
                  </h3>
                  <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '4px', marginBottom: '1rem' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      <strong>{reservation.tier_name}</strong> × {reservation.quantity}
                    </p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#28a745', marginBottom: '0.5rem' }}>
                      Total: {formatPrice(reservation.total_price_cents)}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: '#666' }}>
                      Expires in: {formatTimeRemaining(reservation.expires_in_seconds)}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.5rem', fontStyle: 'italic' }}>
                      Reservation expires at: {formatDate(reservation.expires_at)}
                    </p>
                  </div>

                  {/* Checkout Section */}
                  {checkoutSession && !order ? (
                    <div style={{ padding: '1rem', backgroundColor: '#e7f3ff', borderRadius: '4px', marginTop: '1rem' }}>
                      {checkoutSession.status === 'completed' ? (
                        <div>
                          <h4 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                            ✅ Payment Completed
                          </h4>
                          <p style={{ fontSize: '0.9rem', color: '#666' }}>
                            Your order is being processed...
                          </p>
                        </div>
                      ) : checkoutSession.status === 'failed' ? (
                        <div>
                          <h4 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.5rem', color: '#dc3545' }}>
                            ❌ Payment Failed
                          </h4>
                          <p style={{ fontSize: '0.9rem', color: '#666' }}>
                            Your reservation has been canceled. Please try again.
                          </p>
                        </div>
                      ) : (
                        <div>
                          <h4 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                            ✅ Checkout Session Created
                          </h4>
                          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
                            Status: <strong>{checkoutSession.status}</strong>
                          </p>
                          <p style={{ fontSize: '0.85rem', color: '#999', marginBottom: '1rem' }}>
                            Session ID: {checkoutSession.id.substring(0, 8)}...
                          </p>
                          <button
                            onClick={handleConfirmPayment}
                            disabled={confirmingPayment}
                            style={{
                              width: '100%',
                              padding: '1rem',
                              fontSize: '1.1rem',
                              backgroundColor: confirmingPayment ? '#6c757d' : '#28a745',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: confirmingPayment ? 'not-allowed' : 'pointer',
                              fontWeight: 'bold',
                            }}
                          >
                            {confirmingPayment ? 'Processing Payment...' : 'Confirm Payment'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={handleCreateCheckout}
                      disabled={creatingCheckout || reservation.expires_in_seconds <= 0}
                      style={{
                        width: '100%',
                        padding: '1rem',
                        fontSize: '1.1rem',
                        backgroundColor: creatingCheckout || reservation.expires_in_seconds <= 0 ? '#6c757d' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: creatingCheckout || reservation.expires_in_seconds <= 0 ? 'not-allowed' : 'pointer',
                        fontWeight: 'bold',
                        marginTop: '1rem',
                      }}
                    >
                      {creatingCheckout ? 'Creating Checkout...' : reservation.expires_in_seconds <= 0 ? 'Reservation Expired' : 'Proceed to Checkout'}
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <h3 style={{ marginTop: 0, fontSize: '1.3rem', marginBottom: '1rem' }}>
                    Reserve Tickets
                  </h3>
                  {selectedEvent.tiers && selectedEvent.tiers.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        Select Tier:
                      </label>
                      <select
                        value={selectedTierId}
                        onChange={(e) => {
                          setSelectedTierId(e.target.value);
                          const tier = selectedEvent.tiers?.find(t => t.id === e.target.value);
                          if (tier) {
                            const tierAvailability = availability?.availability.find(a => a.tier_id === tier.id);
                            const maxQuantity = Math.min(
                              tierAvailability?.per_user_limit ?? 4,
                              tierAvailability?.available ?? tier.capacity
                            );
                            if (reservationQuantity > maxQuantity) {
                              setReservationQuantity(maxQuantity);
                            }
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          fontSize: '1rem',
                          borderRadius: '4px',
                          border: '1px solid #dee2e6',
                        }}
                      >
                        <option value="">-- Select a tier --</option>
                        {selectedEvent.tiers.map((tier) => {
                          const tierAvailability = availability?.availability.find(a => a.tier_id === tier.id);
                          const available = tierAvailability?.available ?? tier.capacity;
                          const isSoldOut = available === 0;
                          
                          return (
                            <option
                              key={tier.id}
                              value={tier.id}
                              disabled={isSoldOut}
                            >
                              {tier.name} - {formatPrice(tier.price_cents)} {isSoldOut ? '(Sold Out)' : `(${available} available)`}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {selectedTierId && (
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                        Quantity:
                      </label>
                      {(() => {
                        const tier = selectedEvent.tiers?.find(t => t.id === selectedTierId);
                        const tierAvailability = availability?.availability.find(a => a.tier_id === selectedTierId);
                        const maxQuantity = tier ? Math.min(
                          tierAvailability?.per_user_limit ?? 4,
                          tierAvailability?.available ?? tier.capacity
                        ) : 1;
                        
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <input
                              type="number"
                              min="1"
                              max={maxQuantity}
                              value={reservationQuantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val >= 1 && val <= maxQuantity) {
                                  setReservationQuantity(val);
                                }
                              }}
                              style={{
                                width: '80px',
                                padding: '0.5rem',
                                fontSize: '1rem',
                                borderRadius: '4px',
                                border: '1px solid #dee2e6',
                              }}
                            />
                            <span style={{ fontSize: '0.9rem', color: '#666' }}>
                              (Max: {maxQuantity})
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <button
                    onClick={handleCreateReservation}
                    disabled={!selectedTierId || reservationQuantity < 1 || reserving}
                    style={{
                      width: '100%',
                      padding: '1rem',
                      fontSize: '1.1rem',
                      backgroundColor: reserving || !selectedTierId ? '#6c757d' : '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: reserving || !selectedTierId ? 'not-allowed' : 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    {reserving ? 'Reserving...' : 'Reserve Tickets (3 min hold)'}
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '4px',
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ textAlign: 'center', marginBottom: '3rem', position: 'relative' }}>
        <div style={{
          position: 'absolute',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
        }}>
          <a
            href="http://localhost:4000/metrics"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#17a2b8',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              fontSize: '0.85rem',
            }}
          >
            📊 Metrics
          </a>
          <button
            onClick={fetchAllTickets}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            My Tickets
          </button>
        </div>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎫 TicketDrop</h1>
        <p style={{ fontSize: '1.2rem', color: '#666' }}>Find and join waiting rooms for upcoming events</p>
      </header>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <p>Loading events...</p>
        </div>
      ) : error ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <p style={{ fontSize: '1.2rem', color: '#dc3545', marginBottom: '1rem' }}>
            ⚠️ {error}
          </p>
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px', textAlign: 'left', maxWidth: '500px', margin: '0 auto' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>To fix this:</p>
            <ol style={{ textAlign: 'left', paddingLeft: '1.5rem' }}>
              <li>Make sure Docker is running: <code>docker compose up -d</code></li>
              <li>Start the API server: <code>cd api && npm run dev</code></li>
              <li>Seed the database: <code>cd api && npm run db:seed</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <p style={{ fontSize: '1.2rem', color: '#666' }}>
            No events available at the moment.
          </p>
          <p style={{ marginTop: '0.5rem', color: '#999' }}>
            Run <code>cd api && npm run db:seed</code> to create sample events.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1.5rem',
        }}>
          {events.map((event) => (
            <div
              key={event.id}
              onClick={() => fetchEventDetails(event.id)}
              style={{
                background: 'white',
                borderRadius: '8px',
                padding: '1.5rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                {event.name}
              </h2>
              <p style={{ color: '#666', marginBottom: '0.75rem' }}>
                📍 {event.venue}
              </p>
              <p style={{ fontSize: '0.9rem', color: '#999', marginBottom: '0.5rem' }}>
                <strong>Event:</strong> {formatDate(event.starts_at)}
              </p>
              <p style={{ fontSize: '0.9rem', color: '#999' }}>
                <strong>On Sale:</strong> {formatDate(event.on_sale_at)}
              </p>
              <div style={{
                marginTop: '1rem',
                padding: '0.5rem',
                backgroundColor: '#e7f3ff',
                borderRadius: '4px',
                textAlign: 'center',
                color: '#0066cc',
                fontWeight: '500',
              }}>
                View Details →
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

