import { useState, useEffect, useRef } from 'react';
import { createEvent, EventCreationParams, TicketTier } from '../services/ticketService';
import { createClient } from '@supabase/supabase-js';
import { TicketPreview } from './TicketPreview';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
);

interface CreateEventProps {
  lucid: any;
  walletAddress: string;
}

interface Venue {
  name: string;
  address: string;
  city: string;
  country: string;
  capacity?: number;
}

const KNOWN_VENUES: Venue[] = [
  { name: 'Madison Square Garden', address: '4 Pennsylvania Plaza', city: 'New York, NY', country: 'USA', capacity: 20789 },
  { name: 'Budweiser Stage', address: '909 Lake Shore Blvd W', city: 'Toronto, ON', country: 'Canada', capacity: 16000 },
  { name: 'Red Rocks Amphitheatre', address: '18300 W Alameda Pkwy', city: 'Morrison, CO', country: 'USA', capacity: 9525 },
  { name: 'The O2 Arena', address: 'Peninsula Square', city: 'London', country: 'UK', capacity: 20000 },
  { name: 'Staples Center', address: '1111 S Figueroa St', city: 'Los Angeles, CA', country: 'USA', capacity: 20000 },
  { name: 'Wembley Stadium', address: 'Wembley', city: 'London', country: 'UK', capacity: 90000 },
  { name: 'Rogers Centre', address: '1 Blue Jays Way', city: 'Toronto, ON', country: 'Canada', capacity: 49282 },
  { name: 'Scotiabank Arena', address: '40 Bay St', city: 'Toronto, ON', country: 'Canada', capacity: 19800 },
  { name: 'Hollywood Bowl', address: '2301 N Highland Ave', city: 'Los Angeles, CA', country: 'USA', capacity: 17500 },
  { name: 'Sydney Opera House', address: 'Bennelong Point', city: 'Sydney, NSW', country: 'Australia', capacity: 5738 },
  { name: 'Royal Albert Hall', address: 'Kensington Gore', city: 'London', country: 'UK', capacity: 5272 },
  { name: 'Radio City Music Hall', address: '1260 6th Ave', city: 'New York, NY', country: 'USA', capacity: 5960 },
  { name: 'Barclays Center', address: '620 Atlantic Ave', city: 'Brooklyn, NY', country: 'USA', capacity: 19000 },
  { name: 'United Center', address: '1901 W Madison St', city: 'Chicago, IL', country: 'USA', capacity: 20917 },
  { name: 'TD Garden', address: '100 Legends Way', city: 'Boston, MA', country: 'USA', capacity: 19580 },
  { name: 'Chase Center', address: '1 Warriors Way', city: 'San Francisco, CA', country: 'USA', capacity: 18064 },
  { name: 'Climate Pledge Arena', address: '334 1st Ave N', city: 'Seattle, WA', country: 'USA', capacity: 17100 },
  { name: 'Crypto.com Arena', address: '1111 S Figueroa St', city: 'Los Angeles, CA', country: 'USA', capacity: 19079 },
  { name: 'Ball Arena', address: '1000 Chopper Cir', city: 'Denver, CO', country: 'USA', capacity: 19520 },
  { name: 'Bridgestone Arena', address: '501 Broadway', city: 'Nashville, TN', country: 'USA', capacity: 19691 },
];

type TxStatus = 'idle' | 'validating' | 'building' | 'awaiting_signature' | 'submitting' | 'confirming' | 'complete' | 'error';

const TX_STATUS_MESSAGES: Record<TxStatus, string> = {
  idle: '',
  validating: 'Validating event details...',
  building: 'Building transaction...',
  awaiting_signature: 'Please sign the transaction in your wallet...',
  submitting: 'Submitting to blockchain...',
  confirming: 'Waiting for confirmation (this may take 20-60 seconds)...',
  complete: 'Event created successfully!',
  error: 'Transaction failed',
};

const getMinDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

export const CreateEvent: React.FC<CreateEventProps> = ({ lucid, walletAddress: _walletAddress }) => {
  const [formData, setFormData] = useState({
    eventName: '',
    eventDescription: '',
    eventDate: '',
    location: '',
    venue: '',
    bannerImageUrl: '',
    category: 'concert' as EventCreationParams['category'],
  });

  const [ticketTiers, setTicketTiers] = useState<TicketTier[]>([
    { tierName: 'General Admission', tierDescription: 'Standard entry', priceAda: 50, totalSupply: 100, maxPerWallet: 4 },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [createdPolicyId, setCreatedPolicyId] = useState<string | null>(null);

  // Venue autocomplete
  const [venueQuery, setVenueQuery] = useState('');
  const [venueSuggestions, setVenueSuggestions] = useState<Venue[]>([]);
  const [showVenueSuggestions, setShowVenueSuggestions] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);

  // Duplicate warning
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  useEffect(() => {
    if (venueQuery.length >= 2) {
      const query = venueQuery.toLowerCase();
      const matches = KNOWN_VENUES.filter(
        venue => venue.name.toLowerCase().includes(query) || venue.city.toLowerCase().includes(query)
      ).slice(0, 5);
      setVenueSuggestions(matches);
      setShowVenueSuggestions(matches.length > 0);
    } else {
      setVenueSuggestions([]);
      setShowVenueSuggestions(false);
    }
  }, [venueQuery]);

  useEffect(() => {
    const checkDuplicate = async () => {
      if (!formData.eventName || !formData.venue || !formData.eventDate) {
        setDuplicateWarning(null);
        return;
      }

      setIsCheckingDuplicate(true);
      try {
        const eventDate = new Date(formData.eventDate);
        const dateStart = new Date(eventDate);
        dateStart.setHours(0, 0, 0, 0);
        const dateEnd = new Date(eventDate);
        dateEnd.setHours(23, 59, 59, 999);

        const { data: existingEvents } = await supabase
          .from('events')
          .select('event_name, venue_name, event_date')
          .ilike('venue_name', `%${formData.venue}%`)
          .gte('event_date', dateStart.toISOString())
          .lte('event_date', dateEnd.toISOString());

        if (existingEvents && existingEvents.length > 0) {
          const similarEvent = existingEvents.find(event => {
            const nameSimilarity = calculateSimilarity(formData.eventName.toLowerCase(), event.event_name.toLowerCase());
            return nameSimilarity > 0.6;
          });

          if (similarEvent) {
            setDuplicateWarning(`A similar event "${similarEvent.event_name}" already exists at this venue on this date.`);
          } else {
            setDuplicateWarning(null);
          }
        } else {
          setDuplicateWarning(null);
        }
      } catch (err) {
        console.error('Error checking for duplicates:', err);
      } finally {
        setIsCheckingDuplicate(false);
      }
    };

    const timeout = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timeout);
  }, [formData.eventName, formData.venue, formData.eventDate]);

  const calculateSimilarity = (str1: string, str2: string): number => {
    if (str1 === str2) return 1;
    if (str1.length < 2 || str2.length < 2) return 0;

    const bigrams1 = new Set<string>();
    for (let i = 0; i < str1.length - 1; i++) {
      bigrams1.add(str1.substring(i, i + 2));
    }

    let matches = 0;
    for (let i = 0; i < str2.length - 1; i++) {
      if (bigrams1.has(str2.substring(i, i + 2))) matches++;
    }

    return (2 * matches) / (str1.length + str2.length - 2);
  };

  const selectVenue = (venue: Venue) => {
    setSelectedVenue(venue);
    setFormData({
      ...formData,
      venue: venue.name,
      location: `${venue.address}, ${venue.city}, ${venue.country}`,
    });
    setVenueQuery(venue.name);
    setShowVenueSuggestions(false);
  };

  const handleVenueChange = (value: string) => {
    setVenueQuery(value);
    setFormData({ ...formData, venue: value });
    setSelectedVenue(null);
  };

  const addTicketTier = () => {
    setTicketTiers([...ticketTiers, { tierName: '', tierDescription: '', priceAda: 0, totalSupply: 1, maxPerWallet: 1 }]);
  };

  const removeTicketTier = (index: number) => {
    setTicketTiers(ticketTiers.filter((_, i) => i !== index));
  };

  const updateTicketTier = (index: number, field: keyof TicketTier, value: string) => {
    const updatedTiers = [...ticketTiers];
    if (field === 'priceAda' || field === 'totalSupply' || field === 'maxPerWallet') {
      updatedTiers[index] = { ...updatedTiers[index], [field]: Number(value) };
    } else {
      updatedTiers[index] = { ...updatedTiers[index], [field]: value };
    }
    setTicketTiers(updatedTiers);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setTxStatus('validating');

    try {
      const eventDate = formData.eventDate ? new Date(formData.eventDate) : null;
      if (!eventDate || eventDate <= new Date()) {
        throw new Error('Event date must be in the future');
      }

      if (ticketTiers.length === 0 || !ticketTiers[0].tierName) {
        throw new Error('At least one ticket tier is required');
      }

      for (const tier of ticketTiers) {
        if (tier.priceAda < 0) throw new Error('Ticket prices cannot be negative');
        if (tier.totalSupply < 1) throw new Error('Total supply must be at least 1');
      }

      setTxStatus('building');

      const eventParams: EventCreationParams = {
        eventName: formData.eventName!,
        eventDescription: formData.eventDescription || '',
        eventDate: eventDate,
        venue: formData.venue!,
        location: formData.location!,
        bannerImageUrl: formData.bannerImageUrl,
        category: formData.category as 'concert' | 'sports' | 'theater' | 'conference' | 'other',
        ticketTiers,
      };

      setTxStatus('awaiting_signature');
      const result = await createEvent(lucid, eventParams);

      setTxStatus('complete');
      setCreatedEventId(result.eventId);
      setCreatedPolicyId(result.policyId);
      console.log('Event created:', result);
      setSuccess(true);
    } catch (err) {
      setTxStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to create event');
      console.error('Event creation error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2 className="text-2xl font-black text-slate-900 text-center mb-2">Event Created!</h2>
          <p className="text-slate-500 text-center mb-6">Your event is now live on the blockchain.</p>

          <div className="bg-slate-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Event ID</p>
            <p className="text-xs font-mono text-slate-700 break-all">{createdEventId}</p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-6">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Policy ID</p>
            <p className="text-xs font-mono text-slate-700 break-all">{createdPolicyId}</p>
          </div>

          <button
            onClick={() => {
              setSuccess(false);
              setTxStatus('idle');
              setCreatedEventId(null);
              setCreatedPolicyId(null);
              setFormData({
                eventName: '', eventDescription: '', eventDate: '', location: '', venue: '', bannerImageUrl: '', category: 'concert',
              });
            }}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
          >
            Create Another Event
          </button>
        </div>
      </div>
    );
  }

  const getTierType = (name: string): 'general' | 'vip' | 'backstage' => {
    const lower = name.toLowerCase();
    if (lower.includes('vip')) return 'vip';
    if (lower.includes('backstage') || lower.includes('premium')) return 'backstage';
    return 'general';
  };

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white overflow-hidden">
      {/* Main Form */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <p className="text-blue-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">Organizer Portal</p>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Create Event</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {/* Event Details Section */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-400 mb-4">Event Details</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Event Name *</label>
                <input
                  type="text"
                  required
                  value={formData.eventName}
                  onChange={(e) => setFormData({ ...formData, eventName: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Summer Music Festival 2026"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                <textarea
                  value={formData.eventDescription}
                  onChange={(e) => setFormData({ ...formData, eventDescription: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  placeholder="Describe your event..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Date & Time *</label>
                  <input
                    type="datetime-local"
                    required
                    min={getMinDateTime()}
                    value={formData.eventDate}
                    onChange={(e) => setFormData({ ...formData, eventDate: e.target.value as string })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-1">Must be a future date</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Category *</label>
                  <select
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as EventCreationParams['category'] })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="concert">Concert</option>
                    <option value="sports">Sports</option>
                    <option value="theater">Theater</option>
                    <option value="conference">Conference</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Venue Autocomplete */}
              <div className="relative">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Venue Name *</label>
                <input
                  ref={venueInputRef}
                  type="text"
                  required
                  value={venueQuery || formData.venue}
                  onChange={(e) => handleVenueChange(e.target.value)}
                  onFocus={() => venueQuery.length >= 2 && setShowVenueSuggestions(venueSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowVenueSuggestions(false), 200)}
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    selectedVenue ? 'border-green-500' : 'border-slate-200'
                  }`}
                  placeholder="Start typing venue name..."
                  autoComplete="off"
                />
                {selectedVenue && (
                  <p className="text-xs text-green-600 mt-1 font-medium">Known venue - address auto-filled</p>
                )}

                {showVenueSuggestions && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    {venueSuggestions.map((venue, index) => (
                      <div
                        key={index}
                        onClick={() => selectVenue(venue)}
                        className="px-4 py-3 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <p className="font-semibold text-slate-900">{venue.name}</p>
                        <p className="text-xs text-slate-500">{venue.city}, {venue.country} {venue.capacity && `• ${venue.capacity.toLocaleString()} capacity`}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Location / Address *
                  {selectedVenue && <span className="text-green-600 ml-2 text-xs">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  required
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className={`w-full px-4 py-3 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    selectedVenue ? 'bg-green-50 border-green-500' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="123 Main St, New York, NY, USA"
                />
              </div>

              {/* Duplicate Warning */}
              {duplicateWarning && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-amber-800 font-semibold text-sm">Possible Duplicate</p>
                  <p className="text-amber-700 text-sm mt-1">{duplicateWarning}</p>
                </div>
              )}
              {isCheckingDuplicate && <p className="text-xs text-slate-400">Checking for similar events...</p>}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Banner Image URL</label>
                <input
                  type="url"
                  value={formData.bannerImageUrl}
                  onChange={(e) => setFormData({ ...formData, bannerImageUrl: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://... or ipfs://..."
                />
                <p className="text-xs text-slate-400 mt-1">Recommended: 1200x630px, max 5MB. Formats: JPG, PNG, GIF, WebP</p>
              </div>
            </div>
          </div>

          {/* Ticket Tiers Section */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-400 mb-4">Ticket Tiers</h3>

            <div className="space-y-4">
              {ticketTiers.map((tier, index) => (
                <div key={index} className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-slate-700">Tier {index + 1}</h4>
                    {ticketTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTicketTier(index)}
                        className="text-red-500 hover:text-red-700 text-sm font-medium"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={tier.tierName}
                        onChange={(e) => updateTicketTier(index, 'tierName', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VIP, General, etc."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Price (ADA) *</label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={tier.priceAda}
                        onChange={(e) => updateTicketTier(index, 'priceAda', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Supply *</label>
                      <input
                        type="number"
                        required
                        min="1"
                        value={tier.totalSupply}
                        onChange={(e) => updateTicketTier(index, 'totalSupply', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Max/Wallet *</label>
                      <input
                        type="number"
                        required
                        min="1"
                        value={tier.maxPerWallet}
                        onChange={(e) => updateTicketTier(index, 'maxPerWallet', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                    <input
                      type="text"
                      value={tier.tierDescription}
                      onChange={(e) => updateTicketTier(index, 'tierDescription', e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Tier benefits..."
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addTicketTier}
                className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-semibold hover:border-blue-500 hover:text-blue-500 transition-colors"
              >
                + Add Another Tier
              </button>
            </div>
          </div>

          {/* Transaction Status */}
          {isSubmitting && txStatus !== 'idle' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-center gap-4">
                <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
                <div>
                  <p className="font-bold text-blue-900">{TX_STATUS_MESSAGES[txStatus]}</p>
                  {txStatus === 'awaiting_signature' && (
                    <p className="text-sm text-blue-700 mt-1">Check your wallet extension</p>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-4 flex gap-1">
                {(['validating', 'building', 'awaiting_signature', 'submitting', 'confirming'] as TxStatus[]).map((step, index) => {
                  const currentIndex = ['validating', 'building', 'awaiting_signature', 'submitting', 'confirming'].indexOf(txStatus);
                  const isComplete = index < currentIndex;
                  const isCurrent = index === currentIndex;

                  return (
                    <div
                      key={step}
                      className={`flex-1 h-1 rounded ${isComplete ? 'bg-green-500' : isCurrent ? 'bg-blue-500' : 'bg-slate-200'}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-700 font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-5 bg-slate-900 hover:bg-black text-white font-black text-lg rounded-2xl shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating Event...' : 'Create Event'}
          </button>
        </form>
      </div>

      {/* Preview Sidebar */}
      <aside className="w-full lg:w-[400px] bg-slate-50 p-8 border-l border-slate-100 shrink-0 overflow-y-auto">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Ticket Preview</h3>

        <TicketPreview
          eventName={formData.eventName}
          venue={formData.venue}
          eventDate={formData.eventDate}
          tierName={ticketTiers[0]?.tierName || 'General Admission'}
          tierType={getTierType(ticketTiers[0]?.tierName || '')}
          priceAda={ticketTiers[0]?.priceAda || 0}
          bannerImageUrl={formData.bannerImageUrl}
          organizerName="You (Organizer)"
        />

        <div className="mt-6 p-4 bg-white rounded-xl border border-dashed border-slate-200">
          <p className="text-slate-500 text-xs leading-relaxed">
            This preview updates live as you fill in the form. The final ticket will include blockchain verification.
          </p>
        </div>

        {ticketTiers.length > 1 && (
          <div className="mt-6">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Other Tiers</p>
            <div className="flex flex-wrap gap-2">
              {ticketTiers.slice(1).map((tier, index) => (
                <span
                  key={index}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600"
                >
                  {tier.tierName || `Tier ${index + 2}`} - ₳{tier.priceAda}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
