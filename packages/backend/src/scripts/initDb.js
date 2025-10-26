import supabase from '../db/supabase.js';

async function initDb() {
  try {
    // Create users table
    await supabase.rpc('sql', {
      query: `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_address TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('organizer', 'buyer')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `
    });
    console.log('Users table created.');

    // Create events table
    await supabase.rpc('sql', {
      query: `
        CREATE TABLE IF NOT EXISTS events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organizer_id UUID REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          date TIMESTAMP WITH TIME ZONE NOT NULL,
          venue TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `
    });
    console.log('Events table created.');

    // Create tickets table
    await supabase.rpc('sql', {
      query: `
        CREATE TABLE IF NOT EXISTS tickets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id UUID REFERENCES events(id),
          owner_id UUID REFERENCES users(id),
          ticket_token_name TEXT UNIQUE NOT NULL,
          seat_number TEXT,
          price BIGINT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'sold', 'resold', 'canceled')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `
    });
    console.log('Tickets table created.');
  } catch (error) {
    console.error('Error initializing database:', error.message);
  }
}

initDb();