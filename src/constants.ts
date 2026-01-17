// src/constants.ts
export const BRAND = {
  name: 'Working Title', // Change this when ready
  tagline: 'Cardano Blockchain Ticketing Platform',
  domain: 'seatmint.io',
};

// Authorized organizers - add wallet addresses here
// Set to empty array and add addresses to restrict access
// Leave empty to allow all users (development mode)
export const AUTHORIZED_ORGANIZERS: string[] = [];

// Helper to check if an address is an authorized organizer
export const isAuthorizedOrganizer = (address: string | undefined): boolean => {
  if (!address) return false;
  // If AUTHORIZED_ORGANIZERS is empty, everyone is authorized (dev mode)
  if (AUTHORIZED_ORGANIZERS.length === 0) return true;
  return AUTHORIZED_ORGANIZERS.includes(address);
};