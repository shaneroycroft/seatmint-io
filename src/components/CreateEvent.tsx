import { useState, useEffect, useRef } from 'react';
import { createEvent, EventCreationParams, TicketTier } from '../services/ticketService';
import { createClient } from '@supabase/supabase-js';
import { TicketPreview } from './TicketPreview';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
);

interface CreateEventProps {
  lucid: any; // LucidInstance
  walletAddress: string;
}

// Known venues database - can be expanded or moved to Supabase later
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

// Transaction status steps
type TxStatus =
  | 'idle'
  | 'validating'
  | 'building'
  | 'awaiting_signature'
  | 'submitting'
  | 'confirming'
  | 'complete'
  | 'error';

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

// Get minimum datetime (now) for the date picker
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
    {
      tierName: 'General Admission',
      tierDescription: 'Standard entry',
      priceAda: 50,
      totalSupply: 100,
      maxPerWallet: 4,
    },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [createdPolicyId, setCreatedPolicyId] = useState<string | null>(null);

  // Venue autocomplete state
  const [venueQuery, setVenueQuery] = useState('');
  const [venueSuggestions, setVenueSuggestions] = useState<Venue[]>([]);
  const [showVenueSuggestions, setShowVenueSuggestions] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);

  // Duplicate event warning
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Filter venues based on query
  useEffect(() => {
    if (venueQuery.length >= 2) {
      const query = venueQuery.toLowerCase();
      const matches = KNOWN_VENUES.filter(
        venue =>
          venue.name.toLowerCase().includes(query) ||
          venue.city.toLowerCase().includes(query)
      ).slice(0, 5); // Limit to 5 suggestions
      setVenueSuggestions(matches);
      setShowVenueSuggestions(matches.length > 0);
    } else {
      setVenueSuggestions([]);
      setShowVenueSuggestions(false);
    }
  }, [venueQuery]);

  // Check for duplicate events when name, venue, and date are set
  useEffect(() => {
    const checkDuplicate = async () => {
      if (!formData.eventName || !formData.venue || !formData.eventDate) {
        setDuplicateWarning(null);
        return;
      }

      setIsCheckingDuplicate(true);
      try {
        // Check for events with similar name at same venue on same date
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
          // Check for similar event names using simple similarity
          const similarEvent = existingEvents.find(event => {
            const nameSimilarity = calculateSimilarity(
              formData.eventName.toLowerCase(),
              event.event_name.toLowerCase()
            );
            return nameSimilarity > 0.6; // 60% similarity threshold
          });

          if (similarEvent) {
            setDuplicateWarning(
              `A similar event "${similarEvent.event_name}" already exists at this venue on this date. Please verify this is not a duplicate.`
            );
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

    // Debounce the check
    const timeout = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timeout);
  }, [formData.eventName, formData.venue, formData.eventDate]);

  // Simple string similarity function (Dice coefficient)
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

  // Handle venue selection
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

  // Handle venue input change
  const handleVenueChange = (value: string) => {
    setVenueQuery(value);
    setFormData({ ...formData, venue: value });
    setSelectedVenue(null); // Clear selected venue if user types
  };

  const addTicketTier = () => {
    setTicketTiers([
      ...ticketTiers,
      {
        tierName: '',
        tierDescription: '',
        priceAda: 0,
        totalSupply: 1,
        maxPerWallet: 1,
      },
    ]);
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
      // Validate event date is in the future
      const eventDate = formData.eventDate ? new Date(formData.eventDate) : null;
      if (!eventDate || eventDate <= new Date()) {
        throw new Error('Event date must be in the future');
      }

      // Validate at least one ticket tier
      if (ticketTiers.length === 0 || !ticketTiers[0].tierName) {
        throw new Error('At least one ticket tier is required');
      }

      // Validate ticket tier prices
      for (const tier of ticketTiers) {
        if (tier.priceAda < 0) {
          throw new Error('Ticket prices cannot be negative');
        }
        if (tier.totalSupply < 1) {
          throw new Error('Total supply must be at least 1');
        }
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

      // Note: The actual signing happens inside createEvent
      // We update status here for UX, but the wallet prompt will appear
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
      <div style={{ padding: '40px', backgroundColor: '#1a4d2e', borderRadius: '8px', border: '1px solid #4CAF50' }}>
        <h2 style={{ color: '#4CAF50', marginTop: 0 }}>Event Created Successfully!</h2>
        <p style={{ color: '#a5d6a7', marginBottom: '20px' }}>
          Your event has been saved to the blockchain. Tickets are now available for sale.
        </p>

        {/* Event Details */}
        <div style={{ backgroundColor: '#0d2818', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
          <p style={{ color: '#a5d6a7', margin: '0 0 10px 0', fontSize: '14px' }}>
            <strong>Event ID:</strong>
          </p>
          <code style={{ color: '#4CAF50', fontSize: '12px', wordBreak: 'break-all' }}>
            {createdEventId}
          </code>

          <p style={{ color: '#a5d6a7', margin: '15px 0 10px 0', fontSize: '14px' }}>
            <strong>Minting Policy ID:</strong>
          </p>
          <code style={{ color: '#4CAF50', fontSize: '12px', wordBreak: 'break-all' }}>
            {createdPolicyId}
          </code>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => {
              setSuccess(false);
              setTxStatus('idle');
              setCreatedEventId(null);
              setCreatedPolicyId(null);
              setFormData({
                eventName: '',
                eventDescription: '',
                eventDate: '',
                location: '',
                venue: '',
                bannerImageUrl: '',
                category: 'concert',
              });
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Create Another Event
          </button>
        </div>
      </div>
    );
  }

  // Determine tier type for preview color
  const getTierType = (name: string): 'general' | 'vip' | 'backstage' => {
    const lower = name.toLowerCase();
    if (lower.includes('vip')) return 'vip';
    if (lower.includes('backstage') || lower.includes('premium')) return 'backstage';
    return 'general';
  };

  return (
    <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
      {/* Main Form */}
      <div style={{ flex: '1 1 600px', minWidth: '300px' }}>
        <div style={{ padding: '40px', backgroundColor: '#2a2a2a', borderRadius: '8px', border: '1px solid #444' }}>
          <h2 style={{ color: '#fff', marginTop: 0 }}>Create New Event</h2>

          <form onSubmit={handleSubmit}>
            {/* Event Details */}
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ color: '#fff', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
                Event Details
              </h3>

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Event Name *</span>
            <input
              type="text"
              required
              value={formData.eventName}
              onChange={(e) => setFormData({ ...formData, eventName: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
              placeholder="Summer Music Festival 2026"
            />
          </label>

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Description</span>
            <textarea
              value={formData.eventDescription}
              onChange={(e) => setFormData({ ...formData, eventDescription: e.target.value })}
              rows={4}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
                fontFamily: 'inherit',
              }}
              placeholder="Describe your event..."
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <label style={{ display: 'block' }}>
              <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Date & Time *</span>
              <input
                type="datetime-local"
                required
                min={getMinDateTime()}
                value={formData.eventDate}
                onChange={(e) => setFormData({ ...formData, eventDate: e.target.value as string })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              />
              <span style={{ color: '#888', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                Must be a future date
              </span>
            </label>

            <label style={{ display: 'block' }}>
              <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Category *</span>
              <select
                required
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as EventCreationParams['category'] })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                <option value="concert">Concert</option>
                <option value="sports">Sports</option>
                <option value="theater">Theater</option>
                <option value="conference">Conference</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          {/* Venue Name with Autocomplete */}
          <div style={{ position: 'relative', marginBottom: '15px', marginTop: '15px' }}>
            <label style={{ display: 'block' }}>
              <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Venue Name *</span>
              <input
                ref={venueInputRef}
                type="text"
                required
                value={venueQuery || formData.venue}
                onChange={(e) => handleVenueChange(e.target.value)}
                onFocus={() => venueQuery.length >= 2 && setShowVenueSuggestions(venueSuggestions.length > 0)}
                onBlur={() => setTimeout(() => setShowVenueSuggestions(false), 200)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#1a1a1a',
                  border: selectedVenue ? '1px solid #4CAF50' : '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                }}
                placeholder="Start typing venue name..."
                autoComplete="off"
              />
              {selectedVenue && (
                <span style={{ color: '#4CAF50', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                  Known venue - address auto-filled
                </span>
              )}
            </label>

            {/* Autocomplete Suggestions Dropdown */}
            {showVenueSuggestions && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: '0 0 4px 4px',
                  zIndex: 1000,
                  maxHeight: '250px',
                  overflowY: 'auto',
                }}
              >
                {venueSuggestions.map((venue, index) => (
                  <div
                    key={index}
                    onClick={() => selectVenue(venue)}
                    style={{
                      padding: '12px 15px',
                      cursor: 'pointer',
                      borderBottom: index < venueSuggestions.length - 1 ? '1px solid #333' : 'none',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ color: '#fff', fontWeight: 'bold' }}>{venue.name}</div>
                    <div style={{ color: '#888', fontSize: '12px', marginTop: '2px' }}>
                      {venue.city}, {venue.country}
                      {venue.capacity && ` - Capacity: ${venue.capacity.toLocaleString()}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>
              Location / Address *
              {selectedVenue && <span style={{ color: '#4CAF50', marginLeft: '10px' }}>(auto-filled)</span>}
            </span>
            <input
              type="text"
              required
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: selectedVenue ? '#0d2818' : '#1a1a1a',
                border: selectedVenue ? '1px solid #4CAF50' : '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
              placeholder="123 Main St, New York, NY, USA"
            />
          </label>

          {/* Duplicate Event Warning */}
          {duplicateWarning && (
            <div
              style={{
                padding: '15px',
                backgroundColor: '#4d3a1a',
                border: '1px solid #ffa726',
                borderRadius: '4px',
                marginBottom: '15px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>Warning</span>
                <div>
                  <p style={{ color: '#ffa726', margin: 0, fontWeight: 'bold' }}>Possible Duplicate Event</p>
                  <p style={{ color: '#ffcc80', margin: '5px 0 0 0', fontSize: '14px' }}>{duplicateWarning}</p>
                </div>
              </div>
            </div>
          )}
          {isCheckingDuplicate && (
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '15px' }}>
              Checking for similar events...
            </p>
          )}

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Banner Image URL</span>
            <input
              type="url"
              value={formData.bannerImageUrl}
              onChange={(e) => setFormData({ ...formData, bannerImageUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
              placeholder="https://... or ipfs://..."
            />
            <span style={{ color: '#888', fontSize: '12px', marginTop: '4px', display: 'block' }}>
              Supported: HTTPS URLs or IPFS (ipfs://...). Formats: JPG, PNG, GIF, WebP. Recommended: 1200x630px, max 5MB.
            </span>
          </label>
        </div>

        {/* Ticket Tiers */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ color: '#fff', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
            Ticket Tiers
          </h3>

          {ticketTiers.map((tier, index) => (
            <div
              key={index}
              style={{
                backgroundColor: '#1a1a1a',
                padding: '15px',
                borderRadius: '4px',
                marginBottom: '15px',
                border: '1px solid #444',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h4 style={{ color: '#4CAF50', margin: 0 }}>Tier {index + 1}</h4>
                {ticketTiers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTicketTier(index)}
                    style={{
                      padding: '5px 10px',
                      backgroundColor: '#ff6b6b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label style={{ display: 'block' }}>
                  <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Tier Name *</span>
                  <input
                    type="text"
                    required
                    value={tier.tierName}
                    onChange={(e) => updateTicketTier(index, 'tierName', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                    placeholder="VIP, General, etc."
                  />
                </label>

                <label style={{ display: 'block' }}>
                  <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Price (ADA) *</span>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={tier.priceAda}
                    onChange={(e) => updateTicketTier(index, 'priceAda', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                  />
                </label>

                <label style={{ display: 'block' }}>
                  <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Total Supply *</span>
                  <input
                    type="number"
                    required
                    min="1"
                    value={tier.totalSupply}
                    onChange={(e) => updateTicketTier(index, 'totalSupply', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                  />
                </label>

                <label style={{ display: 'block' }}>
                  <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Max Per Wallet *</span>
                  <input
                    type="number"
                    required
                    min="1"
                    value={tier.maxPerWallet}
                    onChange={(e) => updateTicketTier(index, 'maxPerWallet', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                  />
                </label>
              </div>

              <label style={{ display: 'block', marginTop: '10px' }}>
                <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Description</span>
                <input
                  type="text"
                  value={tier.tierDescription}
                  onChange={(e) => updateTicketTier(index, 'tierDescription', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    color: '#fff',
                  }}
                  placeholder="Tier benefits..."
                />
              </label>
            </div>
          ))}

          <button
            type="button"
            onClick={addTicketTier}
            style={{
              padding: '10px 20px',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            + Add Another Tier
          </button>
        </div>

        {/* Transaction Status Indicator */}
        {isSubmitting && txStatus !== 'idle' && (
          <div
            style={{
              padding: '20px',
              backgroundColor: '#1a3d5c',
              border: '1px solid #2196F3',
              borderRadius: '4px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              {/* Spinner */}
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid #1a1a1a',
                  borderTop: '3px solid #2196F3',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <div>
                <p style={{ color: '#2196F3', margin: 0, fontWeight: 'bold' }}>
                  {TX_STATUS_MESSAGES[txStatus]}
                </p>
                {txStatus === 'awaiting_signature' && (
                  <p style={{ color: '#90caf9', margin: '5px 0 0 0', fontSize: '13px' }}>
                    Check your wallet extension for the signature request
                  </p>
                )}
                {txStatus === 'confirming' && (
                  <p style={{ color: '#90caf9', margin: '5px 0 0 0', fontSize: '13px' }}>
                    Transaction submitted. Waiting for blockchain confirmation...
                  </p>
                )}
              </div>
            </div>

            {/* Progress Steps */}
            <div style={{ marginTop: '15px', display: 'flex', gap: '5px' }}>
              {(['validating', 'building', 'awaiting_signature', 'submitting', 'confirming'] as TxStatus[]).map((step, index) => {
                const currentIndex = ['validating', 'building', 'awaiting_signature', 'submitting', 'confirming'].indexOf(txStatus);
                const stepIndex = index;
                const isComplete = stepIndex < currentIndex;
                const isCurrent = stepIndex === currentIndex;

                return (
                  <div
                    key={step}
                    style={{
                      flex: 1,
                      height: '4px',
                      backgroundColor: isComplete ? '#4CAF50' : isCurrent ? '#2196F3' : '#333',
                      borderRadius: '2px',
                      transition: 'background-color 0.3s',
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '15px',
              backgroundColor: '#4d1a1a',
              border: '1px solid #ff6b6b',
              borderRadius: '4px',
              marginBottom: '20px',
            }}
          >
            <p style={{ color: '#ff6b6b', margin: 0 }}>{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            padding: '12px 30px',
            backgroundColor: isSubmitting ? '#666' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {isSubmitting ? 'Creating Event...' : 'Create Event'}
        </button>

        {/* CSS for spinner animation */}
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
          </form>
        </div>
      </div>

      {/* Ticket Preview Panel */}
      <div style={{ flex: '0 0 320px', minWidth: '280px' }}>
        <div
          style={{
            position: 'sticky',
            top: '20px',
            backgroundColor: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #444',
            padding: '24px',
          }}
        >
          <h3
            style={{
              color: '#94a3b8',
              fontSize: '11px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              marginTop: 0,
              marginBottom: '20px',
            }}
          >
            Ticket Preview
          </h3>

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

          {/* Preview Info */}
          <div
            style={{
              marginTop: '20px',
              padding: '16px',
              backgroundColor: '#0f172a',
              borderRadius: '8px',
              border: '1px dashed #334155',
            }}
          >
            <p style={{ color: '#64748b', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
              This is how your ticket will appear to buyers. The design updates as you fill in the form.
            </p>
          </div>

          {/* Multiple Tiers Info */}
          {ticketTiers.length > 1 && (
            <div style={{ marginTop: '16px' }}>
              <p
                style={{
                  color: '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginBottom: '8px',
                }}
              >
                Other Tiers:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {ticketTiers.slice(1).map((tier, index) => (
                  <span
                    key={index}
                    style={{
                      backgroundColor: '#1e293b',
                      color: '#cbd5e1',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 500,
                    }}
                  >
                    {tier.tierName || `Tier ${index + 2}`} - ₳{tier.priceAda}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};