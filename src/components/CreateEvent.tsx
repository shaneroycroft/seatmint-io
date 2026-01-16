import { useState } from 'react';
import { createEvent, EventCreationParams, TicketTier } from '../services/ticketService';

interface CreateEventProps {
  lucid: any; // LucidInstance
  walletAddress: string;
}

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

    try {
      // Convert eventDate string to Date object
      const eventParams: EventCreationParams = {
        eventName: formData.eventName!,
        eventDescription: formData.eventDescription || '',
        eventDate: formData.eventDate ? new Date(formData.eventDate) : new Date(),
        venue: formData.venue!,
        location: formData.location!,
        bannerImageUrl: formData.bannerImageUrl,
        category: formData.category as 'concert' | 'sports' | 'theater' | 'conference' | 'other',
        ticketTiers,
      };

      const result = await createEvent(lucid, eventParams);

      console.log('✅ Event created:', result);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
      console.error('Event creation error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{ padding: '40px', backgroundColor: '#1a4d2e', borderRadius: '8px', border: '1px solid #4CAF50' }}>
        <h2 style={{ color: '#4CAF50', marginTop: 0 }}>🎉 Event Created Successfully!</h2>
        <p style={{ color: '#a5d6a7', marginBottom: '20px' }}>
          Your event has been saved. Next steps: Deploy your minting policy and publish the event.
        </p>
        <button
          onClick={() => setSuccess(false)}
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
    );
  }

  return (
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

          <label style={{ display: 'block', marginBottom: '15px', marginTop: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Venue Name *</span>
            <input
              type="text"
              required
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
              placeholder="Madison Square Garden"
            />
          </label>

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Location *</span>
            <input
              type="text"
              required
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
              placeholder="New York, NY"
            />
          </label>

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
              placeholder="https://..."
            />
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
      </form>
    </div>
  );
};