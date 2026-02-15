import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// Use service role key if available (server-side), fall back to anon key
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'Missing required Supabase environment variables. ' +
            'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).'
        )
    }
    console.warn(
        'Missing Supabase environment variables - database operations will fail. ' +
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
    )
}

// In dev, create client with empty strings so the app boots (DB ops will fail gracefully).
// In prod, the throw above prevents reaching this line without valid credentials.
export const supabase = createClient(supabaseUrl || '', supabaseKey || '')
