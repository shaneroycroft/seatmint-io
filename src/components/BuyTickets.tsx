import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { purchaseTickets } from '../services/ticketService';

interface TicketTier {
  id: string;
  tier_name: string;
  tier_description: string;
  price_lovelace: number;
  total_supply: number;
  remaining_supply: number;
  max_per_wallet: number;
}

interface Event {
  id: string;
  event_name: string;
  event_description: string;
  event_date: string;
  venue_name: string;
  event_location: string;
  banner_image_url: string | null;
  category: string;
  organizer_wallet_address: string;
  event_policy_id: string;
  ticket_tiers: TicketTier[];
}

interface BuyTicketsProps {
  lucid: any;
  userAddress: string;
}

// Color scheme based on tier type
const TIER_COLORS: Record<string, string> = {
  vip: 'from-sand-500 to-sand-700',
  backstage: 'from-terracotta-500 to-terracotta-700',
  premium: 'from-sand-400 to-sand-600',
  general: 'from-forest-500 to-forest-700',
  standard: 'from-warm-500 to-warm-700',
  default: 'from-forest-500 to-forest-700',
};

const getTierGradient = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_COLORS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_COLORS.default;
};

export const BuyTickets: React.FC<BuyTicketsProps> = ({ lucid, userAddress: _userAddress }) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedTier, setSelectedTier] = useState<TicketTier | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          ticket_tiers (*)
        `)
        .eq('status', 'published')
        .order('event_date', { ascending: true });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Failed to load events:', err);
      setError('Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedEvent || !selectedTier) return;

    setError(null);
    setSuccess(null);
    setIsPurchasing(true);

    try {
      const result = await purchaseTickets(lucid, {
        eventId: selectedEvent.id,
        tierId: selectedTier.id,
        quantity,
      });

      setSuccess(`Successfully purchased ${quantity} ticket(s)! TX: ${result.txHash.slice(0, 16)}...`);
      setSelectedEvent(null);
      setSelectedTier(null);
      setQuantity(1);
      loadEvents(); // Refresh to update remaining supply
    } catch (err) {
      console.error('Purchase failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to purchase tickets');
    } finally {
      setIsPurchasing(false);
    }
  };

  const filteredEvents = events.filter(event =>
    event.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    event.venue_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    event.event_location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatPrice = (lovelace: number) => {
    return (lovelace / 1_000_000).toFixed(2);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-warm-500">Loading events...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content - Event List */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-forest-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">
                Primary Market
              </p>
              <h2 className="text-3xl font-black text-warm-900 tracking-tight">
                Buy Tickets
              </h2>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full md:w-80 px-4 py-2 pl-10 bg-warm-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Events Grid */}
        {filteredEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-16">
            <div className="border-4 border-dashed border-warm-200 rounded-[32px] p-10 bg-white/50">
              <h4 className="text-lg font-bold text-warm-800 mb-2">
                {searchQuery ? 'No matching events' : 'No events available'}
              </h4>
              <p className="text-warm-400 text-sm">
                {searchQuery ? 'Try a different search term' : 'Check back later for upcoming events'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 p-6">
            {filteredEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                isSelected={selectedEvent?.id === event.id}
                onClick={() => {
                  setSelectedEvent(event);
                  setSelectedTier(event.ticket_tiers[0] || null);
                  setQuantity(1);
                  setError(null);
                  setSuccess(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar - Purchase Panel */}
      <aside className="w-full lg:w-[420px] bg-warm-50 p-8 flex flex-col shrink-0 border-l border-warm-100">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-warm-400 mb-6">
          Purchase Details
        </h3>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-4 bg-terracotta-50 border border-terracotta-200 rounded-xl">
            <div className="flex justify-between items-start">
              <p className="text-sm text-terracotta-700">{error}</p>
              <button onClick={() => setError(null)} className="text-terracotta-400 hover:text-terracotta-600 ml-2">×</button>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-forest-50 border border-forest-200 rounded-xl">
            <div className="flex justify-between items-start">
              <p className="text-sm text-forest-700">{success}</p>
              <button onClick={() => setSuccess(null)} className="text-forest-400 hover:text-forest-600 ml-2">×</button>
            </div>
          </div>
        )}

        {!selectedEvent ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-4 border-dashed border-warm-200 rounded-[32px] p-10 bg-white/50">
            <h4 className="text-lg font-bold text-warm-800 mb-2">Select an event</h4>
            <p className="text-warm-400 text-sm">
              Choose an event to view ticket options and purchase.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Event Summary */}
            <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
              <h4 className="font-black text-xl text-warm-900 mb-2">{selectedEvent.event_name}</h4>
              <p className="text-warm-500 text-sm mb-1">{selectedEvent.venue_name}</p>
              <p className="text-warm-400 text-sm">{formatDate(selectedEvent.event_date)}</p>
            </div>

            {/* Tier Selection */}
            <div className="mb-6">
              <label className="text-xs font-bold uppercase tracking-wider text-warm-500 mb-3 block">
                Select Tier
              </label>
              <div className="space-y-2">
                {selectedEvent.ticket_tiers.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => {
                      setSelectedTier(tier);
                      setQuantity(1);
                    }}
                    disabled={tier.remaining_supply === 0}
                    className={`w-full p-4 rounded-xl text-left transition-all ${
                      selectedTier?.id === tier.id
                        ? 'bg-forest-700 text-white shadow-lg'
                        : tier.remaining_supply === 0
                        ? 'bg-warm-100 text-warm-400 cursor-not-allowed'
                        : 'bg-white hover:bg-warm-50 text-warm-900 border border-warm-200'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold">{tier.tier_name}</p>
                        <p className={`text-xs ${selectedTier?.id === tier.id ? 'text-forest-200' : 'text-warm-400'}`}>
                          {tier.remaining_supply} of {tier.total_supply} remaining
                        </p>
                      </div>
                      <p className="font-black text-lg">
                        ₳{formatPrice(tier.price_lovelace)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity Selection */}
            {selectedTier && selectedTier.remaining_supply > 0 && (
              <div className="mb-6">
                <label className="text-xs font-bold uppercase tracking-wider text-warm-500 mb-3 block">
                  Quantity
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-12 h-12 bg-warm-200 hover:bg-warm-300 rounded-xl font-bold text-xl transition-colors"
                  >
                    -
                  </button>
                  <span className="text-2xl font-black w-12 text-center">{quantity}</span>
                  <button
                    onClick={() => setQuantity(Math.min(selectedTier.max_per_wallet, selectedTier.remaining_supply, quantity + 1))}
                    className="w-12 h-12 bg-warm-200 hover:bg-warm-300 rounded-xl font-bold text-xl transition-colors"
                  >
                    +
                  </button>
                  <span className="text-sm text-warm-400">
                    Max {Math.min(selectedTier.max_per_wallet, selectedTier.remaining_supply)}
                  </span>
                </div>
              </div>
            )}

            {/* Price Summary */}
            {selectedTier && (
              <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-warm-500">Price per ticket</span>
                  <span className="font-mono font-bold">₳{formatPrice(selectedTier.price_lovelace)}</span>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-warm-500">Quantity</span>
                  <span className="font-bold">×{quantity}</span>
                </div>
                <div className="pt-4 border-t-2 border-dashed border-warm-100 flex justify-between items-end">
                  <span className="text-xs font-black uppercase text-warm-400 tracking-widest">Total</span>
                  <span className="text-3xl font-black text-warm-900 tracking-tighter">
                    ₳{formatPrice(selectedTier.price_lovelace * quantity)}
                  </span>
                </div>
              </div>
            )}

            {/* Purchase Button */}
            {selectedTier && selectedTier.remaining_supply > 0 && (
              <button
                onClick={handlePurchase}
                disabled={isPurchasing}
                className="w-full bg-forest-700 text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:bg-forest-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                {isPurchasing ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Buy ${quantity} Ticket${quantity > 1 ? 's' : ''}`
                )}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

// Event Card Component
interface EventCardProps {
  event: Event;
  isSelected: boolean;
  onClick: () => void;
}

const EventCard: React.FC<EventCardProps> = ({ event, isSelected, onClick }) => {
  const lowestPrice = Math.min(...event.ticket_tiers.map(t => t.price_lovelace));
  const totalRemaining = event.ticket_tiers.reduce((sum, t) => sum + t.remaining_supply, 0);
  const isSoldOut = totalRemaining === 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate(),
    };
  };

  const dateInfo = formatDate(event.event_date);

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all cursor-pointer ${
        isSelected ? 'ring-2 ring-forest-600' : ''
      } ${isSoldOut ? 'opacity-60' : ''}`}
    >
      {/* Event Header with Gradient */}
      <div className={`h-32 bg-gradient-to-br ${getTierGradient(event.ticket_tiers[0]?.tier_name || 'general')} p-4 flex justify-between items-start relative overflow-hidden`}>
        {/* Watermark */}
        <div className="absolute -right-4 -bottom-4 opacity-10 text-8xl font-black text-white rotate-12">
          LIVE
        </div>

        {/* Date Badge */}
        <div className="bg-white/20 backdrop-blur-md px-3 py-2 rounded-lg text-white text-center">
          <p className="text-[10px] font-bold tracking-wider">{dateInfo.month}</p>
          <p className="text-2xl font-black leading-none">{dateInfo.day}</p>
        </div>

        {/* Status Badge */}
        {isSoldOut ? (
          <div className="bg-terracotta-500 px-3 py-1 rounded-lg text-white text-xs font-bold uppercase">
            Sold Out
          </div>
        ) : (
          <div className="bg-forest-600 px-3 py-1 rounded-lg text-white text-xs font-bold uppercase">
            {totalRemaining} Left
          </div>
        )}
      </div>

      {/* Event Details */}
      <div className="p-5">
        <h3 className="font-black text-lg text-warm-900 mb-1 truncate">{event.event_name}</h3>
        <p className="text-warm-500 text-sm mb-3 truncate">{event.venue_name}</p>

        <div className="flex justify-between items-end">
          <div>
            <p className="text-[10px] font-bold text-warm-400 uppercase tracking-wider">From</p>
            <p className="text-xl font-black text-warm-900">₳{(lowestPrice / 1_000_000).toFixed(0)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-warm-400 uppercase tracking-wider">Tiers</p>
            <p className="text-sm font-bold text-warm-600">{event.ticket_tiers.length} available</p>
          </div>
        </div>
      </div>
    </div>
  );
};
