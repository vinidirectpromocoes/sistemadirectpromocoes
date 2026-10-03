import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createSignupHandler } from './handler.mjs';
// Sem JWT prévio: o convite criptográfico é a autenticação para criar a conta.
Deno.serve(createSignupHandler(Deno.env.toObject(), createClient));
