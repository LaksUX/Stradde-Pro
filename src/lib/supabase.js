import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    'Supabase env vars missing. Copy .env.example to .env.local and fill in your project URL + anon key.'
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '')
